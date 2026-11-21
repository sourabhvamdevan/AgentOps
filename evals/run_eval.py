"""Compare the demo rule parser with the Ollama parser on labeled purchase requests.

Usage (from the repo root, with the backend's dependencies installed):
    python evals/run_eval.py                 # rule parser only
    python evals/run_eval.py --llm           # also call Ollama (OLLAMA_BASE_URL / OLLAMA_MODEL)
    python evals/run_eval.py --llm --write   # and overwrite docs/evals.md with the measured table

Field-level accuracy compares department, product, quantity and maximum_budget with the labels
(null labels mean "not stated"). Only measured numbers are reported.
"""
import argparse
import asyncio
import json
import os
import platform
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.agents.request_agent import LLM_SCHEMA, SYSTEM_PROMPT  # noqa: E402
from app.database.seed import BUDGETS, VENDORS  # noqa: E402
from app.errors import WorkflowError  # noqa: E402
from app.services.llm_client import OllamaClient  # noqa: E402
from app.tools.request_parser import normalize_department, normalize_product, parse_request  # noqa: E402

FIELDS = ["department", "product", "quantity", "maximum_budget"]
DEPARTMENTS = sorted(d for _, d, _ in BUDGETS)
PRODUCTS = sorted({p for _, _, p, *_ in VENDORS})


def rule_extract(text: str) -> dict:
    r = parse_request(text, DEPARTMENTS, PRODUCTS)
    return {f: getattr(r, f) for f in FIELDS}


async def llm_extract(client: OllamaClient, text: str) -> dict:
    data = await client.chat_json(SYSTEM_PROMPT, f"<user_request>\n{text}\n</user_request>", LLM_SCHEMA)
    return {
        "department": normalize_department(data.get("department"), DEPARTMENTS),
        "product": normalize_product(data.get("product"), PRODUCTS),
        "quantity": data.get("quantity"),
        "maximum_budget": data.get("maximum_budget"),
    }


def score(cases: list[dict], preds: list[dict | None]) -> dict:
    per_field = {f: 0 for f in FIELDS}
    exact = 0
    for case, pred in zip(cases, preds):
        if pred is None:
            continue
        ok = [pred.get(f) == case[f] for f in FIELDS]
        for f, good in zip(FIELDS, ok):
            per_field[f] += good
        exact += all(ok)
    n = len(cases)
    return {"per_field": {f: per_field[f] / n for f in FIELDS}, "exact": exact / n}


async def run(use_llm: bool) -> dict:
    cases = json.loads((ROOT / "evals" / "requests.json").read_text(encoding="utf-8"))
    results = {}

    preds, latencies = [], []
    for c in cases:
        t = time.perf_counter()
        preds.append(rule_extract(c["text"]))
        latencies.append((time.perf_counter() - t) * 1000)
    results["rule"] = {**score(cases, preds), "failures": 0, "latency_ms": latencies, "preds": preds}

    if use_llm:
        client = OllamaClient(
            os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
            os.getenv("OLLAMA_MODEL", "llama3.1:8b"),
            float(os.getenv("LLM_TIMEOUT_SECONDS", "60")),
        )
        if not await client.ping():
            sys.exit(f"Ollama not reachable at {client.base_url}")
        preds, latencies, failures = [], [], 0
        for c in cases:
            t = time.perf_counter()
            try:
                preds.append(await llm_extract(client, c["text"]))
            except WorkflowError:
                preds.append(None)
                failures += 1
            latencies.append((time.perf_counter() - t) * 1000)
        results["llm"] = {**score(cases, preds), "failures": failures, "latency_ms": latencies, "preds": preds, "model": client.model}
    results["cases"] = cases
    return results


def table(results: dict) -> str:
    rows = ["| Parser | Exact match | Department | Product | Quantity | Max budget | Failures | Median latency |", "|---|---|---|---|---|---|---|---|"]
    for key, label in (("rule", "Rule parser (demo)"), ("llm", f"Ollama ({results.get('llm', {}).get('model', '')})")):
        if key not in results:
            continue
        r = results[key]
        pf = r["per_field"]
        rows.append(
            f"| {label} | {r['exact']:.0%} | {pf['department']:.0%} | {pf['product']:.0%} | {pf['quantity']:.0%} | "
            f"{pf['maximum_budget']:.0%} | {r['failures']}/{len(results['cases'])} | {statistics.median(r['latency_ms']):.2f} ms |"
        )
    return "\n".join(rows)


def misses(results: dict, key: str) -> list[str]:
    out = []
    for case, pred in zip(results["cases"], results[key]["preds"]):
        if pred is None:
            out.append(f"- `{case['text']}` → call failed")
            continue
        wrong = [f"{f}={pred.get(f)!r} (expected {case[f]!r})" for f in FIELDS if pred.get(f) != case[f]]
        if wrong:
            out.append(f"- `{case['text']}` → " + ", ".join(wrong))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--llm", action="store_true")
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()
    results = asyncio.run(run(args.llm))
    print(table(results))
    for key in ("rule", "llm"):
        if key in results:
            print(f"\n{key} misses:")
            print("\n".join(misses(results, key)) or "- none")
    if args.write:
        hw = f"{platform.system()} {platform.release()} · {platform.machine()} · {os.cpu_count()} CPUs · Python {platform.python_version()}"
        body = [
            "# Extraction eval",
            "",
            f"{len(results['cases'])} labeled requests in `evals/requests.json`. Generated by `python evals/run_eval.py"
            + (" --llm" if args.llm else "") + " --write`.",
            "",
            f"Hardware: {hw}",
            "",
            table(results),
        ]
        if not args.llm:
            body += ["", "The Ollama parser was not measured in this run (no Ollama server was available). "
                     "Run `python evals/run_eval.py --llm --write` on a machine with Ollama to add it."]
        for key in ("rule", "llm"):
            if key in results:
                body += ["", f"## Misses: {key}", "", *(misses(results, key) or ["- none"])]
        (ROOT / "docs" / "evals.md").write_text("\n".join(body) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
