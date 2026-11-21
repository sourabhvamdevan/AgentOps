import { Activity, Boxes, GitBranch, LayoutDashboard, Menu, MonitorPlay, X } from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet } from "react-router";

import { useConnection } from "../hooks/useConnection";
import { useHealth } from "../hooks/useHealth";
import { cn } from "../lib/utils";
import { ConnectionBanner, ConnectionPill } from "./ConnectionBanner";
import { ModeBadge } from "./ModeBadge";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/workflow-monitor", label: "Workflow Monitor", icon: Activity, end: false },
  { to: "/workflow", label: "Workflow Explorer", icon: GitBranch, end: false },
  { to: "/monitor", label: "Execution Monitor", icon: MonitorPlay, end: false },
  { to: "/architecture", label: "Architecture", icon: Boxes, end: false },
];

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="space-y-0.5 px-3">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
              isActive
                ? "bg-accent font-medium text-white"
                : "text-sidebar-fg/80 hover:bg-white/10 hover:text-sidebar-fg",
            )
          }
        >
          <Icon size={16} aria-hidden /> {label}
        </NavLink>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-5 py-4">
      <img src="/favicon.svg" alt="" className="h-7 w-7" />
      <div className="leading-tight">
        <div className="text-base font-semibold tracking-tight text-sidebar-fg">AgentOps</div>
        <div className="text-xs text-sidebar-muted">Multi-agent workflow operations</div>
      </div>
    </div>
  );
}

function Footer() {
  const { data: health, error } = useHealth();
  const conn = useConnection();
  return (
    <div className="space-y-2 border-t border-sidebar-border px-5 py-4 text-xs text-sidebar-muted">
      <ConnectionPill />
      {health && conn.mode !== "synthetic" && <ModeBadge mode={health.execution_mode} model={health.llm_model} />}
      {error && conn.mode !== "synthetic" && <div className="text-red-300">Backend unreachable</div>}
      <div>All data is synthetic. No real purchases.</div>
    </div>
  );
}

export function Layout() {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-full md:pl-60">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col bg-sidebar md:flex">
        <Brand />
        <div className="flex-1">
          <Nav />
        </div>
        <Footer />
      </aside>

      <header className="sticky top-0 z-20 flex items-center justify-between bg-sidebar px-3 md:hidden">
        <Brand />
        <button
          type="button"
          className="rounded-md p-2 text-sidebar-fg hover:bg-white/10"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </header>
      {open && (
        <div className="fixed inset-x-0 top-[65px] bottom-0 z-10 flex flex-col bg-sidebar md:hidden">
          <div className="flex-1 pt-2">
            <Nav onNavigate={() => setOpen(false)} />
          </div>
          <Footer />
        </div>
      )}

      <main className="mx-auto max-w-6xl space-y-4 px-4 py-6 md:px-8">
        <ConnectionBanner />
        <Outlet />
      </main>
    </div>
  );
}
