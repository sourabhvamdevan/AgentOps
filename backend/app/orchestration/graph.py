"""The procurement LangGraph (Section 5.1)."""
from dataclasses import dataclass
from typing import Any, Callable

from langchain_core.runnables import RunnableConfig
from langchain_core.runnables.config import var_child_runnable_config
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from app.agents.base import AgentContext, execute_agent
from app.agents.registry import AGENT_ORDER, AGENTS
from app.config.settings import Settings
from app.database import repositories as repo
from app.database.database import Database
from app.database.models import utcnow
from app.events.publisher import EventPublisher
from app.orchestration.routing import (
    decide_outcome,
    explain_after_approval,
    explain_after_request,
    route_after_approval,
    route_after_request,
)
from app.orchestration.state import WorkflowState
from app.schemas.domain import HumanDecision
from app.services.llm_client import OllamaClient
from app.tools.report_tools import build_report

WORKFLOW_ID = "procurement"

# Display metadata for graph nodes; the nodes and edges themselves come from the compiled graph.
NODE_META: dict[str, dict[str, Any]] = {
    "__start__": {"label": "Start", "kind": "start"},
    "init": {"label": "Orchestrator", "kind": "orchestrator", "description": "Initializes shared state and emits workflow_initialized."},
    "request_agent": {"label": "Request Agent", "kind": "agent", "agent_id": "request_agent"},
    "vendor_agent": {"label": "Vendor Agent", "kind": "agent", "agent_id": "vendor_agent"},
    "budget_agent": {"label": "Budget Agent", "kind": "agent", "agent_id": "budget_agent"},
    "approval_agent": {"label": "Approval Agent", "kind": "agent", "agent_id": "approval_agent"},
    "human_review": {"label": "Human Review", "kind": "human", "description": "Pauses the graph with interrupt() until a person approves or rejects."},
    "finalize": {"label": "Final Report", "kind": "report", "description": "Decides the outcome and builds the deterministic procurement report."},
    "__end__": {"label": "End", "kind": "end"},
}


def _interrupt(value: Any, config: RunnableConfig) -> Any:
    """interrupt() reads the run config from a context var that Python < 3.11 does not propagate into
    async nodes. Setting it from the node's explicit config makes the same code work on 3.10+."""
    token = var_child_runnable_config.set(config) if var_child_runnable_config.get() is None else None
    try:
        return interrupt(value)
    finally:
        if token is not None:
            var_child_runnable_config.reset(token)


@dataclass
class Runtime:
    settings: Settings
    db: Database
    publisher: EventPublisher
    llm: OllamaClient | None


def approval_summary(state: dict[str, Any]) -> dict[str, Any]:
    parsed = state["parsed_request"]
    vendor = state["vendor_evaluation"]
    budget = state["budget_validation"]
    assessment = state["approval_assessment"]
    quote = next(c for c in vendor["candidates"] if c["vendor_id"] == vendor["recommended_vendor_id"])
    return {
        "department": parsed["department"],
        "product": parsed["product"],
        "quantity": parsed["quantity"],
        "maximum_budget": parsed["maximum_budget"],
        "vendor": {k: quote[k] for k in ("vendor_id", "name", "unit_price", "total_price", "delivery_days", "rating")},
        "vendor_explanation": vendor["explanation"],
        "requested_amount": budget["requested_amount"],
        "available_budget": budget["available_budget"],
        "remaining_budget": budget["remaining_budget"],
        "recommendation": assessment["recommendation"],
        "triggered_rules": assessment["triggered_rules"],
        "assessment_summary": assessment["summary"],
    }


def build_graph(rt: Runtime, checkpointer=None):
    def make_ctx(state: WorkflowState, agent_id: str) -> AgentContext:
        mode = state["execution_mode"]
        return AgentContext(
            execution_id=state["execution_id"],
            agent_id=agent_id,
            execution_mode=mode,
            publisher=rt.publisher,
            db=rt.db,
            llm=rt.llm if mode == "llm" else None,
            settings=rt.settings,
        )

    def set_stage(execution_id: str, stage: str) -> None:
        with rt.db.session() as s:
            repo.update_execution(s, execution_id, current_stage=stage)

    async def init(state: WorkflowState) -> dict[str, Any]:
        eid = state["execution_id"]
        set_stage(eid, "init")
        await rt.publisher.publish(
            eid,
            "workflow_initialized",
            None,
            {"workflow_id": WORKFLOW_ID, "raw_request": state["raw_request"], "execution_mode": state["execution_mode"], "agents": AGENT_ORDER},
        )
        return {"agent_statuses": {a: "pending" for a in AGENT_ORDER}, "current_stage": "init", "errors": []}

    def agent_node(
        agent_id: str,
        build_input: Callable[[WorkflowState], dict[str, Any]],
        state_key: str,
        branch: tuple[Callable, Callable] | None = None,
    ):
        async def node(state: WorkflowState) -> dict[str, Any]:
            eid = state["execution_id"]
            set_stage(eid, agent_id)
            output = await execute_agent(AGENTS[agent_id], build_input(state), make_ctx(state, agent_id))
            statuses = {**state["agent_statuses"], agent_id: "completed"}
            update = {state_key: output, "agent_statuses": statuses, "current_stage": agent_id}
            if branch:
                route, explain = branch
                merged = {**state, **update}
                await rt.publisher.publish(
                    eid, "branch_selected", None, {"from": agent_id, "branch": route(merged), "reason": explain(merged)}
                )
            return update

        node.__name__ = agent_id
        return node

    async def human_review(state: WorkflowState, config: RunnableConfig) -> dict[str, Any]:
        # This node re-runs from the top when resumed, so its side effects must be idempotent. The
        # waiting_for_approval status and approval_requested event are emitted by the execution service
        # only after the run has actually paused and the interrupt is checkpointed, so a fast decision
        # can never race a run that is still in flight.
        eid = state["execution_id"]
        summary = approval_summary(state)
        with rt.db.session() as s:
            approval = repo.get_approval_for_execution(s, eid) or repo.create_approval(s, eid, summary)
            approval_id = approval.id
        set_stage(eid, "human_review")
        decision = _interrupt({"approval_id": approval_id, "summary": summary}, config)
        validated = HumanDecision.model_validate(decision)
        return {"human_decision": validated.model_dump(mode="json"), "current_stage": "human_review"}

    async def finalize(state: WorkflowState) -> dict[str, Any]:
        eid = state["execution_id"]
        outcome = decide_outcome(state)
        statuses = {a: ("skipped" if s == "pending" else s) for a, s in state["agent_statuses"].items()}
        final_state = {**state, "agent_statuses": statuses}
        now = utcnow()
        with rt.db.session() as s:
            ex = repo.get_execution(s, eid)
            report = build_report(final_state, outcome, ex.created_at, now).model_dump(mode="json")
            repo.upsert_report(s, eid, report)
            repo.update_execution(s, eid, status="completed", outcome=outcome, current_stage="finalize", completed_at=now)
        await rt.publisher.publish(
            eid, "workflow_completed", None, {"outcome": outcome, "reason": report["reason"], "agent_statuses": statuses}
        )
        return {"outcome": outcome, "final_report": report, "agent_statuses": statuses, "current_stage": "finalize"}

    g = StateGraph(WorkflowState)
    g.add_node("init", init)
    g.add_node(
        "request_agent",
        agent_node(
            "request_agent",
            lambda s: {"raw_request": s["raw_request"]},
            "parsed_request",
            (route_after_request, explain_after_request),
        ),
    )
    g.add_node("vendor_agent", agent_node("vendor_agent", lambda s: {"parsed_request": s["parsed_request"]}, "vendor_evaluation"))
    g.add_node(
        "budget_agent",
        agent_node(
            "budget_agent",
            lambda s: {"parsed_request": s["parsed_request"], "vendor_evaluation": s["vendor_evaluation"]},
            "budget_validation",
        ),
    )
    g.add_node(
        "approval_agent",
        agent_node(
            "approval_agent",
            lambda s: {
                "parsed_request": s["parsed_request"],
                "vendor_evaluation": s["vendor_evaluation"],
                "budget_validation": s["budget_validation"],
            },
            "approval_assessment",
            (route_after_approval, explain_after_approval),
        ),
    )
    g.add_node("human_review", human_review)
    g.add_node("finalize", finalize)

    g.add_edge(START, "init")
    g.add_edge("init", "request_agent")
    g.add_conditional_edges("request_agent", route_after_request, {"vendor_agent": "vendor_agent", "finalize": "finalize"})
    g.add_edge("vendor_agent", "budget_agent")
    g.add_edge("budget_agent", "approval_agent")
    g.add_conditional_edges("approval_agent", route_after_approval, {"human_review": "human_review", "finalize": "finalize"})
    g.add_edge("human_review", "finalize")
    g.add_edge("finalize", END)
    return g.compile(checkpointer=checkpointer)


def describe_graph(compiled) -> dict[str, Any]:
    """Nodes and edges for the UI, generated from the compiled graph definition."""
    drawable = compiled.get_graph()
    nodes = []
    for node_id in drawable.nodes:
        meta = dict(NODE_META.get(node_id, {"label": node_id, "kind": "node"}))
        if meta.get("agent_id"):
            agent = AGENTS[meta["agent_id"]]
            meta["description"] = agent.description
        nodes.append({"id": node_id, **meta})
    edges = [
        {
            "id": f"{e.source}->{e.target}",
            "source": e.source,
            "target": e.target,
            "conditional": bool(e.conditional),
            "label": EDGE_LABELS.get((e.source, e.target)),
        }
        for e in drawable.edges
    ]
    return {"id": WORKFLOW_ID, "name": "Procurement approval", "nodes": nodes, "edges": edges}


EDGE_LABELS = {
    ("request_agent", "vendor_agent"): "valid",
    ("request_agent", "finalize"): "invalid",
    ("approval_agent", "human_review"): "approval required",
    ("approval_agent", "finalize"): "no approval required",
    ("human_review", "finalize"): "decision received",
}
