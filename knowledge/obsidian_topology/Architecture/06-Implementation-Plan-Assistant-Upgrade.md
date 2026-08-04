> [!WARNING] Archived — Original Design Spec
> This note is from the project's original planning phase (`.agents/` in the repo root, migrated 2026-07-19). It describes **intended** architecture and may not match what was actually implemented — e.g. this document set originally specified FAISS + Neo4j for the data layer, but the live system uses Qdrant, and the Neo4j graph-sync path was removed as dead code. Treat this as historical design rationale, not current-state documentation. For what's actually running, see the `Devices/`, `Protocols/`, `Monitoring/` etc. folders (live, auto-generated) or `CLAUDE.md` in the repo root.

---

# Finalized NETAct AI Assistant Upgrade Plan (Proxy-Resilient)

This document details the finalized implementation plan to upgrade the **NETAct AI Assistant** into a stateful, intent-based network operations agent. 

The upgraded system leverages:
1. **PurePythonAgent**: A custom pure-Python orchestrator for conversation state, reasoning loops, and multi-turn human-in-the-loop (HITL) approval gates. It completely replaces `langgraph` to avoid proxy installation blocks.
2. **Qdrant REST API**: Queried directly using `httpx` REST scrolling to bypass heavy `qdrant-client` SDK installation failures.
3. **SQLite**: Used for persistent conversational checkpoint storage and topology facts, replacing Neo4j.
4. **MCP Server**: Mounted with the main `/backend` directory for connection helpers, executing command collection over secure SSH jump host tunnels.
5. **Lightweight LLM**: Configured to run `qwen2.5-coder:0.5b-instruct` on local CPU, avoiding timeouts and high load.

---

## Refinements & Architectural Decisions

### 1. Persistent Checkpointing
We use SQLite database checkpoints via a custom DB manager inside [agent.py](file:///d:/NetAct/copilot/backend/agent.py). This ensures thread states, checkpoints, and pending approvals survive container restarts.

### 2. direct Qdrant Integration
Instead of using `qdrant-client` which pulls in complex dependency trees blocked by the proxy, [pipelines.py](file:///d:/NetAct/copilot/backend/pipelines.py) uses standard HTTP requests to query the Qdrant server `/collections/.../points/scroll` endpoint.

### 3. CPU Inference optimization
To avoid high load and HTTP timeouts (>120s) on CPU, the stack is configured to run the `qwen2.5-coder:0.5b-instruct` model. Synthesis prompts are kept extremely concise to generate minimal tokens.

### 4. HITL Approval & Resume Mechanics
The FastAPI endpoint `/api/copilot/chat` manages pending states. When a write action is proposed, it halts. If the operator responds with approval (`"yes"`/`"approve"`), the backend updates the state to `approved` and resumes execution of the node loop.

---

## System Architecture

```
                         USER / API
                              │
                              ▼
                 ┌──────────────────────────┐
                 │  FastAPI (app.py)        │
                 └────────────┬─────────────┘
                              │
                              ▼
                 ┌──────────────────────────┐
                 │    PurePythonAgent       │  ← SQLite checkpoints table
                 │    (agent.py)            │  ← Human-in-the-loop Gate
                 └────────────┬─────────────┘
                              │
                              ▼
                 ┌──────────────────────────┐
                 │    Stateless Pipelines   │
                 │    (pipelines.py)        │
                 └──────┬────────────┬──────┘
                        │            │
                        ▼            ▼
                     Qdrant        SQLite
                     (REST)       (Topology)
                        │            │
                        └─────┬──────┘
                              │
                              ▼
                         MCP Client
                              │
                              ▼
                        MCP Server(s)  ← Mounted /backend (asyncssh / transport)
```

---

## Implemented Changes

### 1. Docker Compose & Environment
* **[docker-compose.copilot.yml](file:///d:/NetAct/copilot/docker-compose.copilot.yml)**:
  - Mounted `../backend:/backend:ro` under `mcp-server` to import SSH transport code.
  - Set `OLLAMA_MODEL` to `qwen2.5-coder:0.5b-instruct`.
  - Configured `DB_PATH` to `/app/db/copilot_history.db` for state storage.
  - Removed Neo4j container configurations.

### 2. Dependency Resolution
* **[copilot/backend/requirements.txt](file:///d:/NetAct/copilot/backend/requirements.txt)**:
  - Cleaned up to use only `fastapi`, `uvicorn[standard]`, `pydantic`, `httpx`, `python-multipart`, `pypdf`, `cryptography`, `mcp`, and `jinja2`.
* **[mcp_server/requirements.txt](file:///d:/NetAct/mcp_server/requirements.txt)**:
  - Stripped to core `mcp`, `gitpython`, `uvicorn`, and `requests`.

### 3. Agent Stateful Logic
* **[copilot/backend/agent.py](file:///d:/NetAct/copilot/backend/agent.py)**:
  - Implemented the `PurePythonAgent` class with SQLite checkpointer methods `aget_state`, `aupdate_state`, and generator `astream`.
  - Defined pipeline nodes: `intent_router`, `context_retriever`, `tool_planner`, `risk_classifier`, `human_approval_gate`, `tool_executor`, and `response_synthesizer`.

### 4. REST API Routing
* **[copilot/backend/app.py](file:///d:/NetAct/copilot/backend/app.py)**:
  - Refactored `/api/copilot/chat` to stream agent progress nodes and handle operator approvals natively.
