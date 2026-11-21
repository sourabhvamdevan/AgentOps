import { createBrowserRouter, RouterProvider } from "react-router";

import { Layout } from "./components/Layout";
import { Architecture } from "./pages/Architecture";
import { ExecutionMonitor } from "./pages/ExecutionMonitor";
import { Overview } from "./pages/Overview";
import { WorkflowExplorer } from "./pages/WorkflowExplorer";
import { WorkflowMonitor } from "./pages/WorkflowMonitor";

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Overview /> },
      { path: "/workflow-monitor", element: <WorkflowMonitor /> },
      { path: "/workflow", element: <WorkflowExplorer /> },
      { path: "/monitor", element: <ExecutionMonitor /> },
      { path: "/monitor/:executionId", element: <ExecutionMonitor /> },
      { path: "/architecture", element: <Architecture /> },
      { path: "*", element: <div className="text-sm text-muted">Page not found.</div> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
