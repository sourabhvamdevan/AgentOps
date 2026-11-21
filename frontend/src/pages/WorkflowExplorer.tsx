import { Background, type Edge, MarkerType, type Node, ReactFlow } from "@xyflow/react";
import { useMemo, useState } from "react";

import { type FlowNodeData, nodeTypes } from "../components/FlowNode";
import { JsonViewer } from "../components/JsonViewer";
import { ErrorBanner, Loading } from "../components/PageState";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { useApi } from "../hooks/useApi";
import { api } from "../services/api";
import type { WorkflowDefinition, WorkflowNode } from "../types";

// Layout only. Which nodes and edges exist comes from GET /workflows/procurement.
const POSITIONS: Record<string, { x: number; y: number }> = {
  __start__: { x: 210, y: 0 },
  init: { x: 195, y: 80 },
  request_agent: { x: 195, y: 170 },
  vendor_agent: { x: 60, y: 270 },
  budget_agent: { x: 60, y: 360 },
  approval_agent: { x: 60, y: 450 },
  human_review: { x: 60, y: 550 },
  finalize: { x: 330, y: 640 },
  __end__: { x: 345, y: 730 },
};

function toFlow(def: WorkflowDefinition, selected: string | null): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  const nodes = def.nodes.map((n, i) => ({
    id: n.id,
    type: "flow",
    position: POSITIONS[n.id] ?? { x: 500, y: i * 90 },
    data: {
      label: n.label,
      kind: n.kind,
      subtitle: n.kind === "agent" ? "agent" : n.kind === "human" ? "interrupt()" : undefined,
      selected: n.id === selected,
    },
  }));
  const edges = def.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label ?? undefined,
    animated: false,
    style: { stroke: e.conditional ? "#C8102E" : "#6F5E60", strokeDasharray: e.conditional ? "5 4" : undefined },
    labelStyle: { fontSize: 10, fill: "#6F5E60" },
    labelBgStyle: { fill: "#FFFFFF" },
    markerEnd: { type: MarkerType.ArrowClosed, color: e.conditional ? "#C8102E" : "#6F5E60" },
  }));
  return { nodes, edges };
}

function AgentPanel({ node }: { node: WorkflowNode }) {
  const agent = useApi(() => api.agent(node.agent_id!), [node.agent_id]);
  if (agent.loading) return <Loading />;
  if (agent.error) return <ErrorBanner message={agent.error.message} />;
  const a = agent.data!;
  return (
    <div className="space-y-4 text-sm">
      <p className="text-fg">{a.description}</p>
      <div>
        <div className="mb-1 text-xs font-medium text-muted">Responsibilities</div>
        <ul className="list-disc space-y-0.5 pl-5">
          {a.responsibilities.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>
      <div>
        <div className="mb-1 text-xs font-medium text-muted">Tools (allowlist)</div>
        {a.tools.length ? (
          <ul className="space-y-1">
            {a.tools.map((t) => (
              <li key={t.name}>
                <code className="rounded bg-surface px-1 py-0.5 text-xs">{t.name}</code>{" "}
                <span className="text-muted">{t.description}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-muted">None</span>
        )}
      </div>
      <div>
        <div className="mb-1 text-xs font-medium text-muted">LLM usage</div>
        <p>{a.llm_usage}</p>
      </div>
      <JsonViewer label="Input schema" value={a.input_schema} />
      <JsonViewer label="Output schema" value={a.output_schema} />
    </div>
  );
}

export function WorkflowExplorer() {
  const wf = useApi(() => api.workflow("procurement"));
  const [selected, setSelected] = useState<string | null>("request_agent");
  const flow = useMemo(() => (wf.data ? toFlow(wf.data, selected) : null), [wf.data, selected]);
  const node = wf.data?.nodes.find((n) => n.id === selected) ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Workflow Explorer</h1>
        <p className="text-sm text-muted">
          Generated from the backend's compiled LangGraph definition. Dashed red edges are conditional routes. Click a
          node to inspect it.
        </p>
      </div>
      {wf.error && <ErrorBanner title="Could not load workflow" message={wf.error.message} />}
      {wf.loading && <Loading />}
      {flow && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <Card className="h-[560px] overflow-hidden lg:h-[800px]" data-testid="workflow-graph">
            <ReactFlow
              nodes={flow.nodes}
              edges={flow.edges}
              nodeTypes={nodeTypes}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable
              onNodeClick={(_, n) => setSelected(n.id)}
              fitView
              proOptions={{ hideAttribution: false }}
            >
              <Background gap={16} color="#EFDFE0" />
            </ReactFlow>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{node?.label ?? "Select a node"}</CardTitle>
              {node && <Badge>{node.kind}</Badge>}
            </CardHeader>
            <CardContent>
              {!node ? (
                <p className="text-sm text-muted">Click a node in the graph.</p>
              ) : node.agent_id ? (
                <AgentPanel node={node} />
              ) : (
                <p className="text-sm text-fg">{node.description ?? "Graph boundary node."}</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
