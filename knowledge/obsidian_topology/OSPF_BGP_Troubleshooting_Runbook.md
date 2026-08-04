# OSPF & BGP Troubleshooting Runbook

This guide covers OSPF and BGP peering troubleshooting steps for the NETAct core network.

## 1. OSPF Adjacency Troubleshooting

If OSPF adjacency is stuck in a non-FULL state:
- **Down**: Check physical cabling and interface statuses using `run_device_diagnostic` with command `show ip interface brief`.
- **Init**: Hello packets are being received but bidirectional communication is not established. Verify MTU matches on both sides.
- **ExStart / Exchange**: Check for MTU mismatches on the link. Run `show ip ospf interface`.

### Action Checklist:
1. Run `show ip ospf neighbor` to check neighbor state.
2. Run `show ip ospf interface` to check area config, hello timer (default 10s), and dead timer (default 40s).
3. If timers mismatch, adjust configuration.

---

## 2. BGP Peering Issues

If BGP state is not ESTABLISHED:
- **Idle**: The routing engine is searching routing table for a path to neighbor. Check ping to peer IP.
- **Active**: TCP connection failed. Verify TCP port 179 is not blocked by ACLs on either side.
- **Connect**: BGP is waiting for TCP connection to complete.

### Core Commands:
- `show ip bgp summary` (Cisco IOS)
- `display bgp peer` (Huawei VRP)
- `show bgp neighbor` (Juniper Junos)
