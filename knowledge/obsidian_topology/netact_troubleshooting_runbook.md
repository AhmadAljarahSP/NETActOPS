# NETAct Network Operations Center (NOC) Troubleshooting Runbook

This runbook outlines standard operating procedures for diagnosing network element failures, calculating blast radius, and troubleshooting connectivity issues.

---

## 1. Multi-Vendor CLI Diagnostic Reference
NOC engineers and AI agents must use the following vendor-specific command matrix to gather telemetry:

| Diagnostic Metric | Cisco IOS-XE/XR | Juniper JunOS | Huawei VRP |
| :--- | :--- | :--- | :--- |
| **System Info & Uptime** | `show version` | `show version` | `display version` |
| **Interface Status** | `show ip interface brief` | `show interfaces terse` | `display ip interface brief` |
| **LLDP Neighbors** | `show lldp neighbors` | `show lldp neighbors` | `display lldp neighbor brief` |
| **OSPF Adjacencies** | `show ip ospf neighbor` | `show ospf neighbor` | `display ospf peer brief` |
| **BGP Peer Status** | `show ip bgp summary` | `show bgp summary` | `display bgp peer` |
| **Routing Table** | `show ip route` | `show route` | `display ip routing-table` |

---

## 2. Blast Radius Analysis Protocol
When a network element experiences a link down event or interface flap, analyze the impact scope using these steps:

1. **Adjacency Check**: Run `show lldp neighbors` or `display lldp neighbor brief` on the affected element. Compile all connected neighbor hostnames and local interface names.
2. **Routing Convergence Check**: Run `show ip ospf neighbor` or `display ospf peer brief` to verify if OSPF adjacencies have dropped to `Down` or `Init` state.
3. **Traffic Impact Check**: Query the interfaces status (`show interfaces`) to check for CRC error counts, input/output packet drop rates, and packet flow statistics.
4. **Identify Backup Paths**: Audit the routing table (`show ip route`) for the target subnets to check if traffic has successfully converged to a secondary backup path (e.g. redundant OSPF paths).

---

## 3. Telnet/SSH Connectivity & Authentication Troubleshooting

### A. Failure Mode 1: Telnet Connection Refused / Timed Out
- **Indication**: Log output shows `[ERROR] Telnet connection failed` or `Connection timed out`.
- **Root Cause**:
  1. The multi-hop SSH tunnel through the jump host (`192.0.2.38`) is down or misconfigured.
  2. Telnet service is disabled on the target network element.
- **Remediation**:
  1. Verify jump server reachability by executing a ping test from the backend shell.
  2. Limit the SSH connection socket timeout to `5.0 seconds` to fail fast and prevent thread hangs.

### B. Failure Mode 2: Authentication Rejection
- **Indication**: Log output shows `[ERROR] Login failed: Authentication rejected`.
- **Root Cause**: The login credentials (`DEVICE_USER` / `DEVICE_PASS`) stored in environment variables do not match the router's local database or AAA server.
- **Remediation**:
  1. Verify credentials against the encrypted credentials vault.
  2. Audit the TACACS+ or RADIUS server status on the network.
