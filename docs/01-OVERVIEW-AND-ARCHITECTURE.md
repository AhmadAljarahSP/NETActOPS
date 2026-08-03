# NETAct — System Architecture & Stack Reference

NETAct is an enterprise-grade network configuration management, visual workflow automation, and RAG AI Copilot platform built for multi-vendor network environments (Cisco IOS, Cisco IOS-XR, Huawei VRP, Juniper JunOS, Arista EOS, Nokia SR-OS, F5 BIG-IP).

---

## 1. System Overview

NETAct is modularized into **five independent Docker Compose stacks** that communicate over a unified Docker bridge network (`netact_config-net`) and share version-controlled persistent storage volumes.

```
                      +-------------------------------------------------+
                      |              Web UI (React / Nginx)              |
                      |            https://localhost:3000               |
                      +-------------------------------------------------+
                                               |
         +--------------------+----------------+--------------------+
         |                    |                |                    |
         v                    v                v                    v
+------------------+ +------------------+ +------------------+ +------------------+
|   Core Stack     | |    AI Stack      | |  Topology Stack  | | Knowledge Stack  |
|  (:8000 backend) | | (:8010 copilot)  | | (:8001 topology) | | (:8085 obsidian) |
|  (:8003 auto)    | | (:6333 qdrant)   | +------------------+ | (netact-brain)   |
|  (:8002 git)     | | (:11434 ollama)  |                      +------------------+
|  (:5001 mcp)     | +------------------+                                |
+------------------+           |                                         |
         |                     v                                         v
         |            +------------------+                     +------------------+
         +----------->|   netact_git     |<--------------------+| obsidian_topology|
                      |   (Git Repo)     |                     | (Obsidian Vault) |
                      +------------------+                     +------------------+
```

---

## 2. Docker Compose Stacks

### Stack 1: Core (`docker-compose.core.yml`)
- **`backend` (`:8000`)**: Python/FastAPI service. Manages device inventory (`core/backend/devices/*.yaml`), SSH connection pooling, background config backups, health checks, EOL tracking, and Git commits.
- **`automation` (`:8003`)**: Visual workflow engine & Ansible runner. Connects directly to network devices and runs playbooks for BGP, OSPF, and SOLIDserver IPAM/DNS operations.
- **`git` (`:8002`)**: Internal Git repository server managing version-controlled backups in `netact_git-repo`.
- **`frontend` (`:3000`)**: Primary web UI (React, Vite, Nginx reverse proxy).
- **`mcp-server` (`:5001`)**: Model Context Protocol (MCP) tool server providing AI agent tool definitions.

### Stack 2: AI (`docker-compose.ai.yml`)
- **`ollama` (`:11434`)**: Local LLM and vector embedding engine. Runs `llama3.2`, `nomic-embed-text`, `bge-m3`, `qwen2.5:0.5b-instruct`, and `qwen2.5-coder:0.5b-instruct`.
- **`qdrant` (`:6333`)**: High-performance vector database storing 768-dimensional embeddings in collection `netact_knowledgebase`.
- **`copilot-backend` (`:8010`)**: FastAPI RAG backend running LangGraph agent workflows, vector synchronization (`vector_sync.py`), and MCP tool dispatch.
- **`copilot-frontend` (`:8011`)**: Dedicated AI Chat Assistant web UI.

### Stack 3: Topology (`docker-compose.topology.yml`)
- **`topology-backend` (`:8001`)**: Parses OSPF and LLDP neighbor tables to compute real-time network graphs.
- **`topology-frontend` (`:3001`)**: Interactive Sankey and force-directed network topology visualizer.

### Stack 4: Knowledge (`docker-compose.knowledge.yml`)
- **`netact-brain`**: Event-driven container (`importer.py`) that reads device state from APIs/Git and generates interlinked Markdown notes inside `knowledge/obsidian_topology/`.
- **`obsidian-web` (`:8085`)**: Browser-accessible Obsidian Vault editor interface.

### Stack 5: Monitoring (`docker-compose.monitoring.yml`)
- **`prometheus` (`:9090`)**: Scrapes telemetry metrics from backend services and `ollama-exporter` (`:9110`).
- **`grafana` (`:3002`)**: Dashboard visualization for device availability, backup health, and LLM throughput.

---

## 3. Data Flow Pipelines

1. **Configuration Backup Flow**:
   `backend` → SSH/Telnet connection to managed device → Collect running config → Save to `netact_git-repo` volume → Create Git commit (`git commit -m "Auto-backup device X"`).

2. **Obsidian Vault Knowledge Import Flow**:
   `netact-brain` (`importer.py`) → Query `backend` (`:8000`) & `topology` (`:8001`) → Render Markdown notes → Write to `knowledge/obsidian_topology/` (`Devices/`, `HealthChecks/`, `Topology/`, `Inventory/`, `SOP/`).

3. **Vector Embedding & RAG Search Flow**:
   `copilot-backend` (`watch_obsidian_vault` / `trigger_vector_sync`) → Check SHA256 hashes in `knowledgebase_registry.json` → Extract modified text → Generate 768-dim embeddings via `nomic-embed-text` on Ollama (`:11434`) → Ingest vector points into Qdrant (`:6333`).
