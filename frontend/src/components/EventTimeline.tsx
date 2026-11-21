import { cn, formatTime, humanize } from "../lib/utils";
import type { ExecutionEvent } from "../types";
import { Empty } from "./PageState";
import { AGENT_LABELS, eventTone, summarizeEvent } from "./eventSummary";

const DOT: Record<ReturnType<typeof eventTone>, string> = {
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-border",
};

export function EventTimeline({
  events,
  selectedSequence,
  onSelect,
}: {
  events: ExecutionEvent[];
  selectedSequence?: number | null;
  onSelect?: (event: ExecutionEvent) => void;
}) {
  if (!events.length) return <Empty>No events yet. Run a request to see live execution events.</Empty>;
  return (
    <ol className="relative space-y-0.5" aria-label="Execution timeline">
      {events.map((e) => (
        <li key={e.sequence}>
          <button
            type="button"
            onClick={() => onSelect?.(e)}
            data-testid="timeline-event"
            data-event-type={e.event_type}
            className={cn(
              "grid w-full grid-cols-[auto_auto_minmax(0,1fr)_auto] items-start gap-x-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-surface",
              selectedSequence === e.sequence && "bg-accent-soft hover:bg-accent-soft",
            )}
          >
            <span className="w-6 pt-0.5 text-right font-mono text-xs text-muted">{e.sequence}</span>
            <span className={cn("mt-1.5 h-2 w-2 rounded-full", DOT[eventTone(e)])} aria-hidden />
            <span className="min-w-0">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium text-fg">{humanize(e.event_type)}</span>
                {e.agent_id && <span className="text-xs text-muted">{AGENT_LABELS[e.agent_id] ?? e.agent_id}</span>}
              </span>
              <span className="block truncate text-xs text-muted">{summarizeEvent(e)}</span>
            </span>
            <span className="pt-0.5 font-mono text-xs text-muted">{formatTime(e.timestamp)}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
