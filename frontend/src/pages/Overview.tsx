import { Activity, ArrowRight, Boxes, Bot, GitBranch } from "lucide-react";
import { Link } from "react-router";

import { ModeBadge } from "../components/ModeBadge";
import { ErrorBanner, Loading } from "../components/PageState";
import { OutcomeBadge, StatusBadge } from "../components/StatusBadge";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { useApi } from "../hooks/useApi";
import { useHealth } from "../hooks/useHealth";
import { formatDateTime } from "../lib/utils";
import { api } from "../services/api";

export function Overview() {
  const health = useHealth();
  const workflows = useApi(api.workflows);
  const agents = useApi(api.agents);
  const latest = useApi(() => api.executions(1, 0));

  const anyError = health.error || workflows.error || agents.error || latest.error;
  const wf = workflows.data?.items[0];
  const last = latest.data?.items[0];

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {health.data && <ModeBadge mode={health.data.execution_mode} model={health.data.llm_model} />}
          <Badge>Data source: synthetic</Badge>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">AgentOps <span className="text-accent">· Multi-Agent Workflow Operations</span></h1>
        <p className="max-w-3xl text-sm leading-relaxed text-muted">
          A LangGraph orchestrator coordinates four specialised agents over a shared, typed state to automate a purchase
          request: parse it, compare vendors, check budget, apply approval policy, and pause for a human when policy
          requires it. Every number comes from deterministic Python; every event you see is persisted by the backend.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link to="/monitor">
            <Button>
              Explore Demo <ArrowRight size={16} />
            </Button>
          </Link>
          <Link to="/workflow-monitor">
            <Button variant="outline">
              <Activity size={16} /> Workflow Monitor
            </Button>
          </Link>
          <Link to="/architecture">
            <Button variant="outline">View Architecture</Button>
          </Link>
        </div>
      </section>

      {anyError && <ErrorBanner title="Could not load overview" message={anyError.message} />}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitBranch size={16} className="text-accent" /> Workflow
            </CardTitle>
            <Link to="/workflow" className="text-xs text-accent hover:underline">
              Explore graph
            </Link>
          </CardHeader>
          <CardContent>
            {workflows.loading ? (
              <Loading />
            ) : wf ? (
              <div className="space-y-1">
                <div className="font-medium">{wf.name}</div>
                <p className="text-sm text-muted">{wf.description}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot size={16} className="text-accent" /> Agents
            </CardTitle>
          </CardHeader>
          <CardContent>
            {agents.loading ? (
              <Loading />
            ) : (
              <>
                <div className="text-3xl font-semibold" data-testid="agent-count">
                  {agents.data?.items.length ?? "—"}
                </div>
                <ul className="mt-2 space-y-0.5 text-sm text-muted">
                  {agents.data?.items.map((a) => <li key={a.id}>{a.name}</li>)}
                </ul>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Boxes size={16} className="text-accent" /> Most recent execution
          </CardTitle>
        </CardHeader>
        <CardContent>
          {latest.loading ? (
            <Loading />
          ) : last ? (
            <Link to={`/monitor/${last.id}`} className="block space-y-2 rounded-md p-1 hover:bg-surface">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={last.status} />
                <OutcomeBadge outcome={last.outcome} />
                <ModeBadge mode={last.execution_mode} model={health.data?.llm_model} />
                <span className="text-xs text-muted">{formatDateTime(last.created_at)}</span>
              </div>
              <p className="text-sm text-fg">“{last.raw_request}”</p>
            </Link>
          ) : (
            <p className="text-sm text-muted">No executions yet. Open the Execution Monitor to run one.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
