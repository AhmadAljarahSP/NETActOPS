#!/usr/bin/env python3
"""NETAct dynamic Ansible inventory.

Pulls the live device list from core-backend's GET /devices (the same
source of truth every other NETAct component uses — the device YAML files
under core/backend/devices/) instead of duplicating device data into a
separate static inventory file that could drift out of sync.

Implements the standard Ansible dynamic inventory contract:
    dynamic_inventory.py --list   -> full inventory JSON
    dynamic_inventory.py --host X -> per-host vars (rarely called directly
                                      by modern Ansible, which prefers the
                                      _meta.hostvars block in --list)

No credentials are embedded here or in any committed file — ansible_user /
ansible_password are resolved at run time via environment variable lookups
in group_vars/all.yml (DEVICE_USER / DEVICE_PASS, the same env vars
core/backend and core/automation already use), matching how every other
part of this project handles secrets.
"""
import argparse
import json
import os
import sys
import urllib.request
import urllib.error

BACKEND_URL = os.getenv("NETACT_BACKEND_URL", "http://backend:8000")
APP_PASSWORD = os.getenv("APP_PASSWORD", "")

# Maps NETAct's vendor tag (core/backend/app.py load_initial_devices()
# entry["vendor"]) to an Ansible inventory group name. Each group's
# connection details (ansible_network_os, connection plugin, proxy) live in
# ../group_vars/<group>.yml, not here — this script only classifies hosts.
_VENDOR_GROUP_MAP = {
    "cisco_xr": "cisco_iosxr",
    "cisco": "cisco_ios",
    "juniper_junos": "junos",
    "huawei": "huawei",
    "arista": "arista_eos",
    "f5": "f5",
}


def fetch_devices() -> list:
    req = urllib.request.Request(f"{BACKEND_URL}/devices")
    if APP_PASSWORD:
        req.add_header("X-Api-Key", APP_PASSWORD)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError) as e:
        # A dynamic inventory that fails to reach the backend must still
        # emit valid (empty) inventory JSON — ansible-playbook treats a
        # non-JSON or non-zero-exit inventory script as fatal for every
        # command that uses it, including --syntax-check on an unrelated
        # playbook that doesn't even touch this inventory's hosts.
        sys.stderr.write(f"NETAct dynamic inventory: failed to reach {BACKEND_URL}: {e}\n")
        return []


def build_inventory() -> dict:
    devices = fetch_devices()
    inventory: dict = {"_meta": {"hostvars": {}}, "all": {"children": ["ungrouped"]}}

    for group in set(_VENDOR_GROUP_MAP.values()):
        inventory.setdefault(group, {"hosts": []})
        inventory["all"]["children"].append(group)

    # cisco_aci devices are vendor="cisco" but managed via the ACI REST API
    # (cisco.aci collection), not IOS CLI — split them into their own group
    # using the group_file NETAct's own registry already tags them with.
    inventory.setdefault("cisco_aci", {"hosts": []})
    inventory["all"]["children"].append("cisco_aci")

    for d in devices:
        hostname = d.get("hostname")
        ip_address = d.get("ip_address")
        vendor = (d.get("vendor") or "").lower()
        group_file = (d.get("group_file") or "").lower()
        if not hostname or not ip_address:
            continue

        target_group = "cisco_aci" if group_file == "cisco_aci" else _VENDOR_GROUP_MAP.get(vendor)
        if not target_group:
            continue  # unclassified vendor — not run against until a group_vars mapping exists

        inventory[target_group]["hosts"].append(hostname)
        inventory["_meta"]["hostvars"][hostname] = {
            "ansible_host": ip_address,
            "netact_device_id": d.get("id"),
            "netact_device_type": d.get("device_type"),
            "netact_group": d.get("group"),
        }

    return inventory


def main():
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--list", action="store_true")
    group.add_argument("--host")
    args = parser.parse_args()

    if args.list:
        print(json.dumps(build_inventory(), indent=2))
    else:
        # Modern ansible-core always reads hostvars from --list's _meta
        # block, so --host is effectively legacy — return empty per spec.
        print(json.dumps({}))


if __name__ == "__main__":
    main()
