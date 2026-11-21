import { useState } from "react";

import { formatINR, humanize } from "../lib/utils";
import type { Approval } from "../types";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Textarea } from "./ui/textarea";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium text-fg">{value}</dd>
    </div>
  );
}

export function ApprovalPanel({
  approval,
  onDecide,
}: {
  approval: Approval;
  onDecide: (decision: "approve" | "reject", comment: string) => Promise<void>;
}) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const s = approval.summary;

  const decide = async (decision: "approve" | "reject") => {
    setBusy(decision);
    setError(null);
    try {
      await onDecide(decision, comment.trim());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="border-warning/50" data-testid="approval-panel">
      <CardHeader className="bg-warning-soft">
        <CardTitle>Human approval required</CardTitle>
        <Badge tone="warning">Pending</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="divide-y divide-border">
          <Row label="Purchase" value={`${s.quantity} × ${humanize(s.product)} for ${s.department}`} />
          <Row label="Recommended vendor" value={`${s.vendor.name} (${s.vendor.delivery_days}-day delivery)`} />
          <Row label="Requested amount" value={formatINR(s.requested_amount)} />
          <Row label="Available budget" value={formatINR(s.available_budget)} />
          <Row label="Remaining after purchase" value={formatINR(s.remaining_budget)} />
          <Row label="Agent recommendation" value={humanize(s.recommendation)} />
        </dl>
        <div>
          <div className="mb-1 text-xs font-medium text-muted">Triggered policy rules</div>
          <div className="flex flex-wrap gap-1.5">
            {s.triggered_rules.map((r) => (
              <Badge key={r} tone="warning">
                {humanize(r)}
              </Badge>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted">{s.vendor_explanation}</p>
        <Textarea
          rows={2}
          placeholder="Optional comment"
          value={comment}
          maxLength={500}
          onChange={(e) => setComment(e.target.value)}
          aria-label="Decision comment"
        />
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button variant="success" disabled={busy !== null} onClick={() => decide("approve")}>
            {busy === "approve" ? "Approving…" : "Approve"}
          </Button>
          <Button variant="danger" disabled={busy !== null} onClick={() => decide("reject")}>
            {busy === "reject" ? "Rejecting…" : "Reject"}
          </Button>
        </div>
        <p className="text-xs text-muted">The agent only recommends. Your decision is final.</p>
      </CardContent>
    </Card>
  );
}
