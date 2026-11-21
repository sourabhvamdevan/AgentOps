# Demo guide

## Walkthrough (about 3 minutes)

1. **Overview**: note the mode badge ("Demo mode (deterministic rules)") and that all data is synthetic.
2. **Workflow Explorer**: the graph comes from the backend. Click Request Agent, then Human Review, to show schemas, tools and the interrupt.
3. **Execution Monitor**: press **Run** with the prefilled request. Watch the pipeline and timeline fill in live; it pauses at **Human approval required** (₹6,85,000 is above the ₹5,00,000 threshold).
4. Refresh the page. The state and timeline come back from the backend.
5. Click an event or an agent chip to inspect its JSON. Approve or reject with a comment. The final report appears.
6. Try the other samples: *Finance monitors* (auto-approved), *20 laptops* (over department budget), *Marketing laptops* (no vendor within max), *Vague request* (failed validation).
7. **Reset demo** clears executions when you are done.

## Deployment

### Backend on Render (Docker)

- New Web Service → this repo → Root directory `backend`, environment **Docker** (uses `backend/Dockerfile`).
- Env vars: `EXECUTION_MODE=demo`, `CORS_ORIGINS=https://<your-vercel-app>.vercel.app`, `DEMO_RESET_ENABLED=true`, `RATE_LIMIT_EXECUTIONS_PER_HOUR=10`. `PORT` is provided by Render.
- Health check path: `/api/v1/health`.
- No API keys are needed in demo mode.

### Frontend on Vercel

- Import the repo, Root directory `frontend`, framework preset **Vite**.
- Env var: `VITE_API_BASE_URL=https://<your-render-service>.onrender.com/api/v1` (build time).
- `frontend/vercel.json` rewrites all paths to `index.html` so `/monitor/<id>` links work on refresh.

## Honest limitations

- Free hosts sleep, time out and wipe local disk. SQLite and checkpoint files on ephemeral storage are not permanent. The backend migrates and re-seeds on every start, and **Reset demo** recovers a messy state, so the demo is usable after any restart; past executions may be gone.
- A cold-started free backend can take a while to answer the first request.
- The deployed backend cannot reach a laptop's Ollama, so the public deployment runs `demo` mode. The UI says so.
- One process: the event bus and rate limiter are in memory. Running several replicas would break live streaming and limits.
- No authentication. Anyone with the URL can approve or reset; reviewers are recorded as `demo_user`.
- This is a demo, not a production service. No availability or concurrency guarantees.

## LLM mode locally

1. Install Ollama and `ollama pull llama3.1:8b`.
2. Start the backend with `EXECUTION_MODE=llm` (optionally `OLLAMA_MODEL`, `OLLAMA_BASE_URL`).
3. The badge reads "LLM mode (model: llama3.1:8b)". The model parses the request and writes explanation text; all numbers and decisions remain deterministic. If Ollama is down or slow, the Request Agent fails with `LLMTimeoutError` after 2 retries and the UI shows the error.
