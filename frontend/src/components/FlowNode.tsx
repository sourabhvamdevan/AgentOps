import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";

import { cn } from "../lib/utils";

export type FlowNodeData = {
  label: string;
  kind: string;
  subtitle?: string;
  selected?: boolean;
};

const KIND_STYLE: Record<string, string> = {
  start: "rounded-full border-border bg-surface text-muted",
  end: "rounded-full border-border bg-surface text-muted",
  orchestrator: "border-accent bg-accent-soft text-accent",
  agent: "border-border bg-bg text-fg",
  human: "border-warning/60 bg-warning-soft text-warning",
  report: "border-success/50 bg-success-soft text-success",
  box: "border-border bg-bg text-fg",
  optional: "border-dashed border-border bg-surface text-muted",
};

export function FlowNode({ data }: NodeProps<Node<FlowNodeData>>) {
  return (
    <div
      className={cn(
        "min-w-[130px] rounded-md border px-3 py-2 text-center text-xs shadow-none",
        KIND_STYLE[data.kind] ?? KIND_STYLE.box,
        data.selected && "ring-2 ring-accent/50",
      )}
    >
      <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !border-0 !bg-border" />
      <div className="font-semibold">{data.label}</div>
      {data.subtitle && <div className="mt-0.5 text-[10px] font-normal text-muted">{data.subtitle}</div>}
      <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !border-0 !bg-border" />
    </div>
  );
}

export const nodeTypes = { flow: FlowNode };
