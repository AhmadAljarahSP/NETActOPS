# NETAct — Automation & Visual Workflow Engine Manual

This document details the visual drag-and-drop workflow designer, execution graph engine, rollback mechanisms, built-in Ansible Collection (`netact.solidserver`), and EfficientIP SOLIDserver IPAM/DNS integration.

---

## 1. Visual Workflow Designer Overview

The automation stack (`automation` service at `:8003`) powers the visual workflow designer located in the web UI at `/automation`. 

Workflows consist of directed acyclic graph (DAG) nodes:
- **Trigger Nodes**: Manual execution, scheduled timer, API webhook, or device state change.
- **Action Nodes**: Push CLI configuration, execute Ansible playbook, reserve IPAM IP, register DNS record.
- **Condition Nodes**: If-Else evaluation on CLI output regex or ping response status.
- **Rollback Nodes**: Automated state recovery if any downstream action fails.

---

## 2. Built-in Ansible Playbooks

NETAct ships pre-installed playbooks located in `core/automation/ansible/playbooks/`:

### Playbook 1: BGP Configuration Push (`push_bgp_config.yml`)
Pushes BGP neighbor definitions, route-maps, and AS configuration across Cisco/Huawei routers.

```yaml
- name: Push BGP Configuration
  hosts: all
  gather_facts: no
  tasks:
    - name: Configure BGP Neighbor
      cisco.ios.ios_bgp:
        bgp_as: "{{ local_as }}"
        neighbors:
          - neighbor: "{{ neighbor_ip }}"
            remote_as: "{{ remote_as }}"
            description: "{{ neighbor_desc }}"
```

### Playbook 2: OSPF Area Deployment (`push_ospf_config.yml`)
Deploys OSPF area interfaces, authentication keys, and cost metrics.

### Playbook 3: SOLIDserver IPAM Write (`solidserver_ipam_write.yml`)
Reserves IP addresses and creates subnets in EfficientIP SOLIDserver.

---

## 3. EfficientIP SOLIDserver (IPAM & DNS) Integration

NETAct includes a custom Ansible collection: `netact.solidserver` (`core/automation/ansible/collections_src/netact/solidserver/`).

### Environment Credentials (`.env`):
```bash
SOLIDSERVER_HOST=10.1.1.50
SOLIDSERVER_USER=admin
SOLIDSERVER_PASSWORD=SecretSolidPassword123
```

### Collection Modules:

#### 1. `ipam_write` Module:
Reserves or updates IP addresses in SOLIDserver IPAM.

```yaml
- name: Reserve IP Address in SOLIDserver IPAM
  netact.solidserver.ipam_write:
    host: "{{ lookup('env', 'SOLIDSERVER_HOST') }}"
    user: "{{ lookup('env', 'SOLIDSERVER_USER') }}"
    password: "{{ lookup('env', 'SOLIDSERVER_PASSWORD') }}"
    ip_address: "10.1.1.60"
    name: "CORE-RTR-01-Loopback"
    space_name: "Production-Space"
    state: present
```

#### 2. `dns_write` Module:
Creates or deletes A/AAAA/TXT/CNAME DNS resource records.

```yaml
- name: Create DNS A Record in SOLIDserver
  netact.solidserver.dns_write:
    host: "{{ lookup('env', 'SOLIDSERVER_HOST') }}"
    user: "{{ lookup('env', 'SOLIDSERVER_USER') }}"
    password: "{{ lookup('env', 'SOLIDSERVER_PASSWORD') }}"
    dns_zone: "example.com"
    rr_name: "router01.example.com"
    rr_type: "A"
    rr_value: "10.1.1.60"
    state: present
```

#### 3. `dns_manage` Module:
Manages DNS ACLs, zone parameters, and DNSSEC keys.

---

## 4. Rollback & State Recovery Engine

When a workflow runs, NETAct takes an automated snapshot of the device's running configuration before applying changes.

If any playbook task or validation step fails:
1. The execution graph halts immediately.
2. The rollback engine issue commands to restore the baseline snapshot.
3. The event log records the failure reason and displays a visual diff on the execution timeline.
