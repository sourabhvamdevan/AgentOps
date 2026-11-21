import { AlertTriangle, Inbox, Loader2 } from "lucide-react";
import type { ReactNode } from "react";

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-muted" role="status">
      <Loader2 size={16} className="animate-spin" aria-hidden /> {label}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted">
      <Inbox size={16} aria-hidden /> {children}
    </div>
  );
}

export function ErrorBanner({ title = "Something went wrong", message, errorClass }: { title?: string; message: string; errorClass?: string }) {
  return (
    <div role="alert" className="flex gap-3 rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
      <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden />
      <div>
        <div className="font-semibold">
          {title}
          {errorClass && <span className="ml-2 rounded bg-danger/10 px-1.5 py-0.5 font-mono text-xs">{errorClass}</span>}
        </div>
        <div className="mt-0.5 text-fg">{message}</div>
      </div>
    </div>
  );
}
