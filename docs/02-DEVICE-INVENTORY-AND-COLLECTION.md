# NETAct — Device Inventory & Backup Collection Manual

This document details device inventory schemas, supported network vendors, SSH connection pooling, credential management, and automated backup collection mechanics.

---

## 1. Supported Network Vendor OS Types

NETAct supports unified configuration management, health checking, and automation across seven primary multi-vendor platforms:

| Vendor | Platform / OS | Device Types | Connection Protocol |
|---|---|---|---|
| **Cisco** | IOS / IOS-XE | `router`, `switch`, `firewall` | SSH / Telnet |
| **Cisco XR** | IOS-XR | `core-router`, `border-gateway` | SSH (XR CLI / NETCONF) |
| **Huawei** | VRP (NE40E, NE9000, S5331, CE16804) | `core-router`, `tor-switch`, `eor-switch` | SSH |
| **Juniper** | JunOS | `gateway`, `switch`, `router` | SSH |
| **Arista** | EOS | `leaf-switch`, `spine-switch` | SSH |
| **Nokia** | SR-OS (7750 SR, 7250 IXR) | `service-router` | SSH |
| **F5** | BIG-IP (TMOS) | `load-balancer` | SSH (tmsh CLI) |

---

## 2. Device Inventory YAML Schema

Managed devices are defined in YAML files inside `core/backend/devices/`. Each file specifies device connection parameters, authentication profiles, jump hosts, and metadata.

### Example Schema (`core/backend/devices/routers.yaml`):

```yaml
devices:
  - id: CORE-RTR-01
    name: CORE-RTR-01
    host: 10.0.1.1
    port: 22
    vendor: cisco
    device_type: router
    auth_profile: default
    jump_host: test-jump.example.com
    tags:
      - core
      - backbone
      - bgp
    location: DC-MAIN
    local_as: 65001

  - id: BNG-RTR-01
    name: BNG-RTR-01
    host: 10.0.1.2
    port: 22
    vendor: huawei
    device_type: router
    auth_profile: huawei_prod
    tags:
      - subscriber
      - bng
    location: POP-01
```

### Schema Field Reference:
- **`id`** *(string, required)*: Unique slug identifier for the device.
- **`host`** *(string, required)*: IP address or FQDN of the managed device.
- **`vendor`** *(enum, required)*: One of `cisco`, `cisco_xr`, `huawei`, `juniper`, `arista`, `nokia`, `f5`.
- **`auth_profile`** *(string, optional)*: Overrides default credentials specified in `.env`.
- **`jump_host`** *(string, optional)*: Bastion/jump host required to reach this device.

---

## 3. Credential & Environment Encryption

Credentials and encryption keys are configured in `.env` (gitignored for security):

```bash
# Bastion / Jump Host credentials
JUMP_HOST=jump.example.com
JUMP_USER=admin
JUMP_PASSWORD=SecretJumpPassword123

# Default Device credentials
DEVICE_USER=admin
DEVICE_PASS=SecretDevicePassword123

# Fernet encryption key used to encrypt backups at rest
ENCRYPTION_KEY=49Lb9yLZw9Jm4sIXWNggrqLDhx7J4zrtUaJ5-L1ASa0=
```

---

## 4. Excel Import / Export Specification

Users can bulk-import devices via the web UI at `/import` or via API (`POST /devices/import-excel`).

### Excel Columns Required:
1. `Device Name` (e.g. `SW-AGG-01`)
2. `IP Address` (e.g. `10.0.2.15`)
3. `Vendor` (`cisco`, `huawei`, `juniper`, etc.)
4. `Device Type` (`switch`, `router`, `firewall`)
5. `Location` (`POP-01`, `DC-MAIN`)
6. `Tags` (comma-separated, e.g. `access, vlan10`)

---

## 5. Automated Backup Collection Pipeline

The `backend` container executes scheduled or on-demand backups via the following pipeline:

1. **Trigger**: Scheduled cron job or manual trigger (`POST /devices/{device_id}/backup`).
2. **SSH Connection**: Establishes SSH connection (routed via `JUMP_HOST` if specified).
3. **CLI Execution**: Sends vendor-specific command (`show running-config`, `display current-configuration`, `show configuration`).
4. **Encryption & Git Commit**: Writes output to `netact_git-repo` volume, encrypts at rest via Fernet key, and issues a Git commit with timestamp & diff log.
