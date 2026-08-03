# NETAct Project Guide (CLAUDE.md)

## Setup

First run: `./start_all.sh` (Linux/macOS) or `start_all.bat` (Windows) — both bootstrap `.env` from `.env.example`, generate a self-signed TLS cert if missing, then start every stack. See `README.md` for details.

## Stacks

Five independent compose files, started in this order (`start_all.sh`/`start_all.bat` do this automatically):

1. `docker-compose.core.yml` — backend, automation, git, frontend, mcp-server
2. `docker-compose.ai.yml` — ollama, qdrant, copilot backend/frontend
3. `docker-compose.topology.yml` — topology backend/frontend
4. `docker-compose.knowledge.yml` — netact-brain, obsidian-web, graphify jobs
5. `docker-compose.monitoring.yml` — prometheus, grafana

## Development Commands
- **Start everything:** `./start_all.sh` / `start_all.bat`
- **Start core only:** `docker compose -f docker-compose.core.yml up -d --build`
- **Stop everything:** `./stop_all.sh` / `stop_all.bat`
- **Rebuild a stack:** `docker compose -f docker-compose.<name>.yml up -d --build`
- **List running containers:** `docker ps`

## Diagnostic & Test Commands
- **API Health Check:** `curl http://localhost:8000/health`
- **Test SSH/jump-host connectivity:** `python core/backend/test_connection.py`
- **Collect OSPF Neighbors:** `python collect_ospf_neighbors.py`
- **Rebuild the Obsidian knowledge graph (wikilinks, no LLM):** `docker compose -f docker-compose.knowledge.yml --profile manual run --rm graphify-update`
- **Rerun community clustering on the graph:** `docker compose -f docker-compose.knowledge.yml --profile manual run --rm graphify-cluster`

## Critical Rules & Guidelines
1. **Safety Gate:** Before executing any write changes, confirm a backup occurred in the last 6 hours (`/git/repo/backups/` inside the `netact_git-repo` volume — check via `docker exec NETAct_backend ls /git/repo/backups/<device>`).
2. **Rollback Validation:** Every proposed configuration CLI script MUST have an accompanying rollback script.
3. **No Guessing CLI:** Verify syntax against the vendor command prefix:
   - Cisco: Use `show`
   - Huawei: Use `display`
   - Juniper: Use `show`
4. **Transport Isolation:** Always check the jump host (`JUMP_HOST` in `.env`) status if a device is unreachable.
5. **Empty by default:** The device inventory (`core/backend/devices/`) ships empty — add devices from the UI or Excel import before expecting healthchecks/backups to have anything to act on.
