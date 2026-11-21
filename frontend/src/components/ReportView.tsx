import { useState } from "react";

import { cn, formatDateTime, formatINR, humanize } from "../lib/utils";
import type { ProcurementReport } from "../types";
import { JsonViewer } from "./JsonViewer";
import { OutcomeBadge } from "./StatusBadge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="text-sm font-medium text-fg">{value ?? "—"}</div>
    </div>
  );
}

export function ReportView({ report }: { report: ProcurementReport }) {
  const [raw, setRaw] = useState(false);
  const r = report;
  return (
    <Card data-testid="report-view">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>Procurement report</CardTitle>
          <OutcomeBadge outcome={r.outcome} />
        </div>
        <Button size="sm" variant="outline" onClick={() => setRaw((v) => !v)}>
          {raw ? "Formatted" : "Raw JSON"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {raw ? (
          <JsonViewer value={r} />
        ) : (
          <>
            {r.reason && <p className="text-sm text-fg">{r.reason}</p>}
            {r.request_summary && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="Department" value={r.request_summary.department} />
                <Field label="Product" value={r.request_summary.product} />
                <Field label="Quantity" value={r.request_summary.quantity} />
                <Field label="Maximum budget" value={formatINR(r.request_summary.maximum_budget)} />
              </div>
            )}
            {r.recommended_vendor && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="Recommended vendor" value={r.recommended_vendor.name} />
                <Field label="Unit price" value={formatINR(r.recommended_vendor.unit_price)} />
                <Field label="Total price" value={formatINR(r.recommended_vendor.total_price)} />
                <Field label="Delivery" value={`${r.recommended_vendor.delivery_days} days`} />
              </div>
            )}
            {r.vendor_comparison && r.vendor_comparison.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-muted">
                    <tr className="border-b border-border">
                      <th className="py-1.5 pr-3 font-medium">Vendor</th>
                      <th className="py-1.5 pr-3 font-medium">Total</th>
                      <th className="py-1.5 pr-3 font-medium">Delivery</th>
                      <th className="py-1.5 pr-3 font-medium">Rating</th>
                      <th className="py-1.5 pr-3 font-medium">Score</th>
                      <th className="py-1.5 font-medium">Within max</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.vendor_comparison.map((q) => (
                      <tr
                        key={q.vendor_id}
                        className={cn(
                          "border-b border-border last:border-0",
                          q.vendor_id === r.recommended_vendor?.vendor_id && "bg-success-soft",
                        )}
                      >
                        <td className="py-1.5 pr-3">{q.name}</td>
                        <td className="py-1.5 pr-3 font-mono text-xs">{formatINR(q.total_price)}</td>
                        <td className="py-1.5 pr-3">{q.delivery_days}d</td>
                        <td className="py-1.5 pr-3">{q.rating}</td>
                        <td className="py-1.5 pr-3 font-mono text-xs">{q.score?.toFixed(2) ?? "—"}</td>
                        <td className="py-1.5">{q.within_budget ? "Yes" : "No"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {r.budget && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="Requested" value={formatINR(r.budget.requested_amount)} />
                <Field label="Available" value={formatINR(r.budget.available_budget)} />
                <Field label="Remaining" value={formatINR(r.budget.remaining_budget)} />
                <Field label="Budget check" value={humanize(r.budget.status)} />
              </div>
            )}
            {r.approval && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="Human review" value={r.approval.required ? "Required" : "Not required"} />
                <Field label="Decision" value={r.approval.decision ? humanize(r.approval.decision) : "—"} />
                <Field label="Decided by" value={r.approval.decided_by} />
                <Field label="Comment" value={r.approval.comment} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Started" value={formatDateTime(r.timeline_summary.started_at)} />
              <Field label="Completed" value={formatDateTime(r.timeline_summary.completed_at)} />
              <Field label="Agents run" value={r.timeline_summary.agents_run} />
              <Field label="Mode" value={r.execution_mode === "demo" ? "Demo (deterministic)" : "LLM"} />
            </div>
          </>
        )}
        <p className="border-t border-border pt-3 text-xs text-muted">
          {r.disclaimer} Data source: {r.data_source}.
        </p>
      </CardContent>
    </Card>
  );
}
