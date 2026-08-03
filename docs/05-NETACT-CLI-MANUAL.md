# NETAct — Command Line Interface (`netact`) Manual

The `netact` command-line interface provides full management, operational monitoring, and automation control over all NETAct services.

---

## 1. Installation

Install the CLI in editable mode using `pip`:

```bash
cd NETActgit/cli
pip install -e .
```

Verify installation:
```bash
netact version
```

---

## 2. Platform Management Commands

### `netact status`
Health-checks all 5 Docker Compose stacks and service `/health` endpoints.

```bash
netact status
```

### `netact doctor`
Aggregates health checks including Qdrant vector DB, Ollama LLM models, and backend databases. Returns non-zero exit code if any critical service is down.

```bash
netact doctor
```

### `netact ps`
Executes `docker ps` filtered for all active `NETAct_*` containers.

```bash
netact ps
```

### `netact logs <service> [-f] [--tail N]`
Tails container logs for a specific service (e.g. `backend`, `copilot-backend`, `automation`, `netact-brain`).

```bash
netact logs copilot-backend -f --tail 100
```

### `netact upgrade`
Rebuilds and restarts all 5 Compose stacks in strict dependency order.

```bash
netact upgrade
```

### `netact config show`
Prints resolved service registry, port mappings, and `.env` settings (secrets masked).

```bash
netact config show
```

---

## 3. Inventory Commands (`netact inventory`)

### `netact inventory sync`
Triggers an immediate reload of device inventory from disk (`POST /devices/reload`).

```bash
netact inventory sync
```

### `netact inventory list [--group G]`
Lists all managed devices, IP addresses, vendor types, and online status.

```bash
netact inventory list --group backbone
```

### `netact inventory import <file.xlsx>`
Imports device inventory from an Excel spreadsheet.

```bash
netact inventory import ./my_network_devices.xlsx
```

---

## 4. Healthcheck & Topology Commands

### `netact healthcheck <device_id>`
Triggers an instant SSH health check for a specific device via the core backend.

```bash
netact healthcheck CORE-RTR-01
```

### `netact topology show`
Queries the live network graph (`GET /topology`) and prints nodes and neighbor links.

```bash
netact topology show
```

### `netact graph rebuild`
Runs the `graphify` job against the Obsidian vault to re-parse wikilinks and update community clusters.

```bash
netact graph rebuild
```

---

## 5. Workflow Automation Commands (`netact workflow`)

### `netact workflow list`
Lists all visual workflows and Ansible playbooks registered in the system.

```bash
netact workflow list
```

### `netact workflow run <flow_id>`
Executes a visual workflow by ID.

```bash
netact workflow run bgp-neighbor-push
```

### `netact workflow status <task_id>`
Queries the status, progress, and logs of a running workflow execution.

```bash
netact workflow status task-98231
```

---

## 6. AI & Qdrant Status Commands

### `netact qdrant status`
Queries Qdrant (`http://localhost:6333/collections/netact_knowledgebase`) directly and prints collection status, vector dimensions, and total point count.

```bash
netact qdrant status
```

### `netact ollama status`
Queries local Ollama (`http://localhost:11434/api/tags`) and prints downloaded models and memory allocation.

```bash
netact ollama status
```
