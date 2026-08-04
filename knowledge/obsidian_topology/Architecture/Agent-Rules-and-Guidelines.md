> [!WARNING] Archived — Original Design Spec
> This note is from the project's original planning phase (`.agents/` in the repo root, migrated 2026-07-19). It describes **intended** architecture and may not match what was actually implemented — e.g. this document set originally specified FAISS + Neo4j for the data layer, but the live system uses Qdrant, and the Neo4j graph-sync path was removed as dead code. Treat this as historical design rationale, not current-state documentation. For what's actually running, see the `Devices/`, `Protocols/`, `Monitoring/` etc. folders (live, auto-generated) or `CLAUDE.md` in the repo root.

---

# NETAct AI Network Agent Rules & Guidelines

This document defines the strict operational rules, validation constraints, and safety checkpoints that the AI Network Agent must follow during reasoning, troubleshooting, and execution.

---

## 1. Safety Gating & Validation Rules
- **Pre-Execution Backup Check**: Before proposing or executing any write actions or configuration changes, the agent must check if a configuration backup was successfully completed within the last 6 hours.
- **Rollback script validation**: For every planned configuration command, the agent must define and validate a rollback counterpart command. If no rollback is possible, the agent must warn the operator and require explicit approval.
- **No Command Hallucinations**: Do not guess CLI commands. The agent must verify CLI command parameters against the known vendor matrices:
  - Cisco IOS-XE/XR: `show` prefix
  - Huawei VRP: `display` prefix
  - Juniper JunOS: `show` prefix

---

## 2. NOC Troubleshooting Protocol
When responding to network errors or unreachable devices:
1. **Analyze Jump Host Reachability**: Always check if the tunnel transport through `192.0.2.38` is functional.
2. **Retrieve Adjacencies**: If an interface or element is reported down, retrieve OSPF adjacencies and LLDP neighbors to identify adjacent nodes.
3. **Calculate Blast Radius**: Perform OSPF route audit to check if traffic is converging to redundant paths.
4. **Isolate Authentication Errors**: If connection fails with authentication rejected, check the environment credentials status immediately without executing repeated login attempts.

---

## 3. Formatting & Report Guidelines
- **NOC-Compliant Reports**: Every diagnostic final response must contain:
  - **Health Status Score (0-100)**: Calculate a score based on down interfaces (each counts -15), failed peerings (-25), and backup failures (-20).
  - **Anomalies & Warnings**: Highlight errors using standard GitHub alert blocks (`> [!CRITICAL]` or `> [!WARNING]`).
  - **Proof of Verification**: Cite the specific CLI command and include the exact output snippet or line reference from the logs.
- **Conciseness**: Keep synthesis reports brief (under 5 sentences of descriptive text) followed by clean Markdown tables.
