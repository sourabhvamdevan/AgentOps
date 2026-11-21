import { cn } from "../lib/utils";

export function JsonViewer({ value, className, label }: { value: unknown; className?: string; label?: string }) {
  return (
    <div className={className}>
      {label && <div className="mb-1 text-xs font-medium text-muted">{label}</div>}
      <pre
        className={cn(
          "max-h-96 overflow-auto rounded-md border border-border bg-surface p-3 font-mono text-xs leading-relaxed text-fg",
        )}
      >
        {value === undefined ? "—" : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
