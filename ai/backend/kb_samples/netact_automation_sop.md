# NETAct Network Automation Standard Operating Procedure (SOP)

This document defines the official procedures and architecture specifications for the NETAct GitOps and visual ReactFlow network automation systems.

---

## 1. Visual ReactFlow Orchestrator
The NETAct Automation Service (running on port 8003) executes visual workflows defined as JSON graphs.

### A. Graph Schema Structure
Every automation flow consists of a JSON object containing `nodes` and `edges`:
- **Nodes**: Represent individual execution steps. Each node has a `type` and `data`:
  - `CLI_Command`: Direct CLI command push (e.g. interface configuration).
  - `Ping_Test`: Connectivity check targeting a specific IP.
  - `Backup_Verify`: Verifies that a successful configuration backup exists in Git before pushing changes.
  - `Rollback_Trigger`: Triggered in case of execution failure to restore the state.
- **Edges**: Represent directed execution paths and conditionals.

### B. Trigger Endpoint
Workflows are executed by posting to `http://NETAct_Automation:8003/run-flow` with headers:
- `x-api-key`: System API Password
- `Content-Type`: `application/json`

Payload example:
```json
{
  "name": "IPTV",
  "nodes": [
    {"id": "node_1", "type": "Backup_Verify", "data": {"device": "demo-switch-01"}},
    {"id": "node_2", "type": "CLI_Command", "data": {"device": "demo-switch-01", "command": "interface GigabitEthernet0/1\nshutdown"}}
  ],
  "edges": [
    {"source": "node_1", "target": "node_2"}
  ]
}
```

---

## 2. GitOps Continuous Compliance
The NETAct system utilizes Git as the single source of truth for all network configuration backups.

### A. Configuration Drift Auditing
1. The backend automatically runs scheduled backups (every 6 hours).
2. It compares the retrieved live running configuration against the latest commit in the Git repository (`/git/repo/backups/<hostname>/`).
3. If differences are detected, a "drift alarm" is raised in the compliance log.
4. Unplanned or out-of-band changes that violate standard templates are flagged as non-compliant.

### B. Pre-Deployment Compliance Rules
Before any visual ReactFlow or CLI script is pushed to production:
1. **Human-in-the-Loop (HITL) Gate**: All write-action tool plans must be approved by the operator.
2. **Rollback Plan Validation**: Every configuration statement must have a corresponding rollback (undo) script. For example:
   - Target: `interface GigabitEthernet0/1 \n shutdown`
   - Rollback: `interface GigabitEthernet0/1 \n no shutdown`
3. **Dry-Run Adjacency Verification**: The pipeline simulates changes on mock topologies to calculate potential blast radius impact.
