from app.agents.approval_agent import ApprovalAgent
from app.agents.base import BaseAgent
from app.agents.budget_agent import BudgetAgent
from app.agents.request_agent import RequestAgent
from app.agents.vendor_agent import VendorAgent

AGENTS: dict[str, BaseAgent] = {a.id: a for a in (RequestAgent(), VendorAgent(), BudgetAgent(), ApprovalAgent())}
AGENT_ORDER = list(AGENTS)
