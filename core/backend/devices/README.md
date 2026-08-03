# Device inventory

This directory is loaded at startup by the backend (`load_initial_devices()` in `core/backend/app.py`) — every `*.yaml` file here is glob-loaded and merged into the running inventory. It ships empty; add your own devices from the UI (Inventory page), via the Excel import endpoint, or by dropping your own YAML files here following the schema below.

## Schema

```yaml
jump_server:
  ip: 203.0.113.10          # optional per-file override; normally leave this out and set JUMP_HOST in .env instead
  username: ${JUMP_USER}    # ${VAR} pulls from the environment — never hardcode credentials here

groups:
  <group_name>:
    vendor: cisco            # cisco | cisco_xr | huawei | juniper | juniper_junos | arista | f5 | ...
    connection: ssh          # ssh | telnet
    commands_source: /app/commands/SomeCommands.txt   # optional — healthcheck command list for this group

devices:
  - ip: "203.0.113.20"
    hostname: "demo-router-01"   # optional, cosmetic
    device_type: "CORE-ROUTER"   # optional, cosmetic
    group: <group_name>
```

Multiple files can be used to organize devices by site, vendor, or function — they're all merged together. A device only needs `ip` and `group`; everything else is optional or inherited from its group.
