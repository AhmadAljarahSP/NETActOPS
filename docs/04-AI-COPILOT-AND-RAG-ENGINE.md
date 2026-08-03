# NETAct — AI Copilot & RAG Vector Engine Manual

This document details the LangGraph agent state machine, Qdrant vector database synchronization (`vector_sync.py`), Model Context Protocol (MCP) tool integration, and security approval gates.

---

## 1. AI Copilot Architecture

The AI Copilot stack (`copilot-backend` at `:8010`) provides an autonomous, local RAG assistant powered by Ollama (`llama3.2`), Qdrant vector search (`netact_knowledgebase`), and LangGraph state machines.

```
                      +-----------------------------+
                      |   User Query (Web / Chat)   |
                      +-----------------------------+
                                     |
                                     v
                      +-----------------------------+
                      |  Intent Router (LangGraph)  |
                      +-----------------------------+
                                     |
         +---------------------------+---------------------------+
         |                           |                           |
         v                           v                           v
+------------------+        +------------------+        +------------------+
|  Vector RAG      |        |  MCP Tools       |        |  Human Approval  |
|  (Qdrant :6333)  |        |  (MCP Server)    |        |  Gate            |
+------------------+        +------------------+        +------------------+
         |                           |                           |
         +---------------------------+---------------------------+
                                     |
                                     v
                      +-----------------------------+
                      |   Ollama LLM (llama3.2)     |
                      +-----------------------------+
```

---

## 2. One-Way Cumulative Vector Synchronization (`vector_sync.py`)

Vector embeddings are generated using Ollama model `nomic-embed-text` (768-dimensional vectors) and stored in Qdrant collection `netact_knowledgebase`.

### Data Flow Direction:
- **Obsidian Vault** (`knowledge/obsidian_topology`): Pure Markdown storage. Never queries or reads from Qdrant.
- **Qdrant** (`netact_knowledgebase`): Populated strictly one-way by `copilot-backend` by reading Obsidian notes (written by `netact-brain` and users) and uploaded KB documents.

### Incremental / Cumulative SHA256 Hash Checking:
1. `vector_sync.py` loads `knowledgebase_registry.json`.
2. Computes SHA256 hashes for all notes in `/app/obsidian_topology` (ignoring volatile poll timestamps like `last_import:`).
3. If the hash matches the registry ➔ **SKIPPED INSTANTLY** (0 Ollama calls).
4. If a file is modified/new ➔ deletes old points for that file, embeds new chunks via `nomic-embed-text`, and uploads points to Qdrant.

---

## 3. LangGraph Agent State Machine & Security Gate

The AI Copilot operates as a LangGraph state machine with an explicit **Human Approval Gate**:

1. **`intent_router`**: Evaluates query intent (Device status query, Topology search, Workflow execution request, Vendor documentation lookup).
2. **`human_approval_gate`**: Intercepts any write/configuration actions (e.g. running an Ansible playbook, modifying device config, restarting a service).
3. **Execution**: Pauses execution until the operator explicitly clicks **Approve** in the web UI.

---

## 4. MCP (Model Context Protocol) Tools

NETAct connects to MCP servers over standard SSE (`http://NETAct_MCP_Server:5001/sse`).

### Tools Registered:
- `get_device_status(device_id)`: Fetches live ping, health check, and backup state.
- `execute_workflow(flow_id)`: Triggers a visual workflow.
- `search_knowledgebase(query)`: Executes hybrid vector/keyword search against Qdrant.
- `query_topology(src, dst)`: Computes shortest network paths between nodes.
