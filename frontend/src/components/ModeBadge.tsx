import { Cpu, ListChecks } from "lucide-react";

import type { ExecutionMode } from "../types";
import { Badge } from "./ui/badge";

/** Always tells the truth about how an execution was (or will be) produced. */
export function ModeBadge({ mode, model }: { mode: ExecutionMode | null | undefined; model?: string | null }) {
  if (!mode) return null;
  if (mode === "llm") {
    return (
      <Badge tone="accent" data-testid="mode-badge">
        <Cpu size={12} aria-hidden /> LLM mode (model: {model || "unknown"})
      </Badge>
    );
  }
  return (
    <Badge tone="neutral" data-testid="mode-badge">
      <ListChecks size={12} aria-hidden /> Demo mode (deterministic rules)
    </Badge>
  );
}
