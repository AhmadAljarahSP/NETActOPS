#!/usr/bin/env python3
"""
NETAct Brain Importer — populates the existing Obsidian vault with NETAct data.

Reads from the NETAct Topology API, Backend API, and Automation API.
Writes interlinked Markdown notes into the EXISTING vault folders:
  /app/obsidian_topology/Devices/       — one note per network device (live state)
  /app/obsidian_topology/HealthChecks/  — per-device healthcheck summaries
  /app/obsidian_topology/Topology/      — physical/logical links
  /app/obsidian_topology/Sites/         — site/group groupings
  /app/obsidian_topology/Inventory/     — per-device CMDB record
  /app/obsidian_topology/EOL/           — per-device EOL/EOS compliance
  /app/obsidian_topology/Backups/       — per-device backup status & gold-standard compliance
  /app/obsidian_topology/Automation/    — automation flow definitions & execution history

Environment variables:
  TOPOLOGY_API        URL of NETAct topology backend   (default: http://NETAct_topology_backend:8001)
  BACKEND_API         URL of NETAct core backend        (default: http://NETAct_backend:8000)
  AUTOMATION_API      URL of NETAct automation backend  (default: http://NETAct_Automation:8003)
  API_KEY             APP_PASSWORD                      (default: empty)
  GIT_REPO_PATH       Path to git repo volume           (default: /git/repo)
  VAULT_PATH          Path to Obsidian vault            (default: /app/obsidian_topology)
  DEVICES_YAML_PATH   Path to backend/devices/ folder   (default: /backend/devices)

Pure event-driven: imports run on startup (bootstrap) and whenever
POST /api/brain/import is called by a data-changing action elsewhere in the
stack. There is no periodic timer.
"""

import os, re, sys, time, logging, argparse, glob, json, hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from collections import defaultdict

import threading

import requests
import yaml
from prometheus_client import (
    Counter, Gauge, Histogram, start_http_server,
    REGISTRY, PROCESS_COLLECTOR, PLATFORM_COLLECTOR
)

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("brain")

TOPOLOGY_API      = os.getenv("TOPOLOGY_API",      "http://NETAct_topology_backend:8001")
BACKEND_API       = os.getenv("BACKEND_API",        "http://NETAct_backend:8000")
AUTOMATION_API    = os.getenv("AUTOMATION_API",     "http://NETAct_Automation:8003")
COPILOT_API       = os.getenv("COPILOT_API",        "http://NETAct_copilot_backend:8002")
OLLAMA_API        = os.getenv("OLLAMA_API",         "http://NETAct_ollama:11434")
OLLAMA_MODEL      = os.getenv("OLLAMA_MODEL",       "llama3.2")
API_KEY           = os.getenv("API_KEY", "") or os.getenv("APP_PASSWORD", "")
GIT_REPO_PATH     = os.getenv("GIT_REPO_PATH",     "/git/repo")
VAULT             = Path(os.getenv("VAULT_PATH",    "/app/obsidian_topology"))
DEVICES_YAML_PATH = os.getenv("DEVICES_YAML_PATH",  "/backend/devices")
HEADERS           = {"X-Api-Key": API_KEY} if API_KEY else {}
METRICS_PORT      = int(os.getenv("METRICS_PORT", "9092"))

# ── Prometheus metrics ────────────────────────────────────────────────────────
BRAIN_IMPORT_TOTAL = Counter(
    "netact_brain_import_total",
    "Total number of completed brain import cycles"
)
BRAIN_IMPORT_DURATION = Histogram(
    "netact_brain_import_duration_seconds",
    "Duration of each brain import cycle in seconds",
    buckets=[10, 30, 60, 90, 120, 180, 300, 600]
)
BRAIN_LAST_IMPORT = Gauge(
    "netact_brain_last_import_timestamp",
    "Unix timestamp of the last completed import cycle"
)
BRAIN_NOTES_WRITTEN = Counter(
    "netact_brain_notes_written_total",
    "Notes written per type in the Obsidian vault",
    ["note_type"]
)
BRAIN_NOTES_PRUNED = Counter(
    "netact_brain_notes_pruned_total",
    "Stale notes pruned per type (entity no longer present in its source of truth)",
    ["note_type"]
)
BRAIN_DEVICES_TOTAL = Gauge("netact_brain_devices_total", "Total devices in topology")
BRAIN_DEVICES_UP    = Gauge("netact_brain_devices_up",    "Devices with UP status")
BRAIN_DEVICES_DOWN  = Gauge("netact_brain_devices_down",  "Devices with DOWN status")
BRAIN_API_ERRORS    = Counter(
    "netact_brain_api_errors_total",
    "API call failures during import",
    ["api"]
)
BRAIN_AI_SUMMARIES  = Counter(
    "netact_brain_ai_summaries_total",
    "AI health summaries successfully generated"
)

# Vault sub-folders (matching EXISTING vault capitalisation)
DEVICES_DIR     = VAULT / "Devices"
HEALTHCHECK_DIR = VAULT / "HealthChecks"
TOPOLOGY_DIR    = VAULT / "Topology"
SITES_DIR       = VAULT / "Sites"
INVENTORY_DIR   = VAULT / "Inventory"
EOL_DIR         = VAULT / "EOL"
BACKUPS_DIR     = VAULT / "Backups"
AUTOMATION_DIR  = VAULT / "Automation"
VENDORS_DIR     = VAULT / "Vendors"
PROTOCOLS_DIR   = VAULT / "Protocols"
BGP_PEERS_DIR   = VAULT / "Protocols" / "BGP-Peers"
MONITORING_DIR  = VAULT / "Monitoring"
CHANGES_DIR     = VAULT / "Changes"
LOGS_DIR        = VAULT / "Logs"
AI_DIR          = VAULT / "AI"


def safe_slug(name: str) -> str:
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', str(name).strip())

def ts_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

def write_note(path: Path, content: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")

def wl(name: str) -> str:
    """Make an Obsidian wiki-link."""
    return f"[[{name}]]"


def prune_stale_notes(folder: Path, valid_stems: set, note_type: str, prefix: str = "", allow_empty: bool = False) -> int:
    """Delete .md notes in `folder` whose stem (minus `prefix`) is no longer in
    `valid_stems`. The write_*_notes() functions only ever create/overwrite —
    an entity removed from its source of truth (topology, device registry,
    backups API) would otherwise leave its note behind in the vault forever,
    and Qdrant's own orphan-purge in vector_sync.py only fires once the file
    actually disappears from disk, so it never gets cleaned up there either.

    Refuses to prune when `valid_stems` is empty UNLESS `allow_empty=True`.
    Pass allow_empty=True only when `valid_stems` was derived from the same
    topology payload run_import() already confirmed non-null before this
    point (device/healthcheck/topology/site/vendor/bgp_peer) — there, zero
    really does mean zero. Leave it False (default) for sets sourced from a
    separate REST call (inventory, EOL, backups, changes) that can silently
    return {} on failure, indistinguishable from a genuine empty state —
    wiping a whole note category on that ambiguity would be a false positive
    with no way back short of another healthy import cycle.
    """
    if not folder.exists():
        return 0
    if not valid_stems and not allow_empty:
        log.warning("Prune skipped for %s: empty valid-set (treated as a fetch failure, not a real zero)", note_type)
        return 0
    pruned = 0
    for f in folder.glob("*.md"):
        stem = f.stem
        if prefix:
            if not stem.startswith(prefix):
                continue
            stem = stem[len(prefix):]
        if stem not in valid_stems:
            try:
                f.unlink()
                pruned += 1
                log.info("Pruned stale %s note: %s", note_type, f.name)
            except Exception as e:
                log.error("Failed to prune %s: %s", f, e)
    if pruned:
        BRAIN_NOTES_PRUNED.labels(note_type=note_type).inc(pruned)
    return pruned


# ── API calls ──────────────────────────────────────────────────────────────────

def fetch_topology() -> Optional[dict]:
    try:
        r = requests.get(f"{TOPOLOGY_API}/topology", headers=HEADERS, timeout=30)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        log.warning("Topology API unavailable: %s", e)
        return None

def fetch_healthcheck(device: str) -> Optional[dict]:
    try:
        r = requests.get(f"{TOPOLOGY_API}/healthchecks/{device}", headers=HEADERS, timeout=15)
        if r.status_code == 200:
            return r.json()
    except Exception:
        pass
    return None

def fetch_eoleos_compliance() -> dict:
    """Fetch per-device EOL/EOS compliance from the backend API.
    Returns {hostname: compliance_dict} with pre-computed status, version, EOS dates."""
    try:
        r = requests.get(f"{BACKEND_API}/eoleos-compliance", headers=HEADERS, timeout=30)
        r.raise_for_status()
        records = r.json()
        result = {rec["hostname"]: rec for rec in records if rec.get("hostname")}
        log.info("EOL/EOS compliance: %d devices loaded from backend API", len(result))
        return result
    except Exception as e:
        log.warning("EOL/EOS compliance API unavailable: %s", e)
        return {}


def fetch_backups_summary() -> dict:
    """Fetch per-device backup summary from the backend API.
    Returns {hostname: device_with_backup_summary}."""
    try:
        r = requests.get(f"{BACKEND_API}/devices/backups-summary", headers=HEADERS, timeout=30)
        r.raise_for_status()
        records = r.json()
        result = {rec["hostname"]: rec for rec in records if rec.get("hostname")}
        log.info("Backups summary: %d devices loaded from backend API", len(result))
        return result
    except Exception as e:
        log.warning("Backups summary API unavailable: %s", e)
        return {}


def fetch_device_change_history(device_id, limit: int = 10) -> list:
    """Fetch config change history for one device from the backend API."""
    try:
        r = requests.get(
            f"{BACKEND_API}/backups/{device_id}/history?limit={limit}",
            headers=HEADERS, timeout=15)
        if r.status_code == 200:
            return r.json()
    except Exception:
        pass
    return []


def fetch_automation_data() -> tuple:
    """Fetch automation flows and recent executions from the automation backend.
    Returns (flows_list, executions_list)."""
    flows, executions = [], []
    try:
        r = requests.get(f"{AUTOMATION_API}/flows", timeout=15)
        if r.status_code == 200:
            flows = r.json()
            log.info("Automation: %d flows loaded", len(flows))
    except Exception as e:
        log.warning("Automation flows API unavailable: %s", e)
    try:
        r = requests.get(f"{AUTOMATION_API}/executions", timeout=15)
        if r.status_code == 200:
            executions = r.json()
            log.info("Automation: %d executions loaded", len(executions))
    except Exception as e:
        log.warning("Automation executions API unavailable: %s", e)
    return flows, executions


def load_device_registry() -> list:
    """Read all backend/devices/*.yaml and return a flat device list for Inventory/ notes."""
    result = []
    search_paths = [
        DEVICES_YAML_PATH,
        str(Path(GIT_REPO_PATH) / "devices"),
    ]
    for base in search_paths:
        yaml_files = glob.glob(os.path.join(base, "*.yaml"))
        if not yaml_files:
            continue
        for yaml_path in sorted(yaml_files):
            try:
                with open(yaml_path, "r", encoding="utf-8") as f:
                    data = yaml.safe_load(f)
                if not data or not isinstance(data, dict):
                    continue
                groups   = data.get("groups") or {}
                dev_list = data.get("devices") or []
                for dev in dev_list:
                    if not isinstance(dev, dict):
                        continue
                    group_name = dev.get("group", "")
                    group_data = groups.get(group_name, {}) if group_name else {}
                    vendor     = (dev.get("vendor") or group_data.get("vendor") or "unknown").lower()
                    commands   = group_data.get("commands_source") or dev.get("commands_source") or []
                    result.append({
                        "hostname":    dev.get("hostname") or dev.get("ip", ""),
                        "ip":          dev.get("ip", ""),
                        "vendor":      vendor,
                        "group":       group_name,
                        "device_type": (dev.get("device_type") or dev.get("type") or group_name or "").lower(),
                        "commands":    commands if isinstance(commands, list) else [],
                        "source_file": os.path.basename(yaml_path),
                    })
            except Exception as e:
                log.error("Failed reading device registry %s: %s", yaml_path, e)
        log.info("Device registry: %d devices loaded from %s", len(result), base)
        return result   # use first path that has files
    log.warning("Device registry not found in %s", search_paths)
    return result


def build_ip_hostname_map(registry: list) -> dict:
    """Return {ip: hostname} lookup so IP-named topology nodes resolve to hostnames."""
    return {
        d["ip"]: d["hostname"]
        for d in registry
        if d.get("ip") and d.get("hostname") and d["ip"] != d["hostname"]
    }


# ── Device notes → Devices/ ───────────────────────────────────────────────────

def write_device_note(node: dict, edges: list, hc: Optional[dict], ip_map: dict = {}):
    raw_id = node["id"]
    # Resolve IP-based node IDs to hostnames using device registry
    name   = ip_map.get(raw_id, raw_id) if re.match(r'^\d{1,3}(\.\d{1,3}){3}$', raw_id) else raw_id
    slug   = safe_slug(name)
    vendor = node.get("vendor", "unknown").lower()
    status = node.get("status", "unknown")
    icon   = {"ok": "🟢", "error": "🔴", "auth_fail": "🔒", "unknown": "⚫"}.get(status, "⚫")

    ospf, lldp, bgp = [], [], []
    for e in edges:
        if e.get("source") == raw_id:
            peer, li, rp = e["target"], e.get("local_interface", ""), e.get("remote_port", "")
        elif e.get("target") == raw_id:
            peer, li, rp = e["source"], e.get("remote_port", ""), e.get("local_interface", "")
        else:
            continue
        # Resolve peer IP to hostname too
        peer = ip_map.get(peer, peer)
        proto = e.get("protocol", "")
        badge = "🟢" if e.get("status", "ok") == "ok" else "🔴"
        line  = f"- {badge} {wl(peer)} via `{li}` ↔ `{rp}`"
        if proto == "ospf":   ospf.append(line)
        elif proto == "lldp": lldp.append(line)
        elif proto == "bgp":  bgp.append(line)

    kpi = []
    if hc:
        for cmd, blk in (hc.get("analysis") or {}).items():
            s = blk.get("summary", "")
            if s:
                i = {"ok": "✅", "warning": "⚠️", "error": "🔴", "critical": "🔴"}.get(blk.get("status", "ok"), "ℹ️")
                kpi.append(f"- {i} **{cmd}**: {s}")

    groups = node.get("groups") or []
    site_links = " · ".join(wl(f"Sites/{g}") for g in groups if g != "default") or "—"

    fm = {
        "aliases": [name],
        "tags": ["device", vendor, status] + [f"site-{g}" for g in groups if g != "default"],
        "vendor": vendor,
        "device_type": node.get("device_type", ""),
        "ip": node.get("ip", ""),
        "status": status,
        "groups": groups,
        "local_as": node.get("local_as"),
        "ospf_neighbors": len(ospf),
        "lldp_neighbors": len(lldp),
        "bgp_upstreams":  len(bgp),
        "last_import": ts_now(),
    }
    if node.get("hc_time"):
        try:
            fm["last_healthcheck"] = datetime.fromtimestamp(
                node["hc_time"], tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        except Exception:
            pass
    fm_yaml = yaml.dump(fm, default_flow_style=False, allow_unicode=True, sort_keys=False)

    ospf_block = "\n".join(ospf) if ospf else "_None_"
    lldp_block = "\n".join(lldp) if lldp else "_None_"
    bgp_block  = "\n".join(bgp)  if bgp  else "_None_"
    kpi_block  = "\n".join(kpi)  if kpi  else "_No healthcheck data_"

    content = f"""---
{fm_yaml}---

# {icon} {name}

| | |
|---|---|
| **IP** | `{node.get("ip", "")}` |
| **Vendor** | {wl(f"Vendors/{vendor.capitalize()}")} |
| **Type** | `{node.get("device_type", "")}` |
| **Status** | `{status}` |
| **Sites** | {site_links} |
| **Local AS** | `{node.get("local_as") or "—"}` |

## OSPF Neighbors ({len(ospf)})
{ospf_block}

## LLDP Neighbors ({len(lldp)})
{lldp_block}

## BGP Upstreams ({len(bgp)})
{bgp_block}

## KPI Summary
{kpi_block}

## Related
- {wl("HealthChecks/" + slug)} — full healthcheck report
- {wl("Topology/Links-" + slug)} — all links involving this device

---
*Last imported: {ts_now()}*
"""
    write_note(DEVICES_DIR / f"{slug}.md", content)


# ── Healthcheck notes → HealthChecks/ ────────────────────────────────────────

def write_healthcheck_note(node: dict, hc: Optional[dict], ip_map: dict = {}):
    raw_id = node["id"]
    name   = ip_map.get(raw_id, raw_id) if re.match(r'^\d{1,3}(\.\d{1,3}){3}$', raw_id) else raw_id
    slug   = safe_slug(name)
    status = node.get("status", "unknown")
    icon   = {"ok": "🟢", "error": "🔴", "auth_fail": "🔒", "unknown": "⚫"}.get(status, "⚫")

    raw_preview = ""
    kpi_rows = []
    if hc:
        raw_preview = (hc.get("raw_preview") or "")[:1500]
        for cmd, blk in (hc.get("analysis") or {}).items():
            s  = blk.get("summary", "")
            st = blk.get("status", "ok")
            i  = {"ok": "✅", "warning": "⚠️", "error": "🔴", "critical": "🔴"}.get(st, "ℹ️")
            if s:
                kpi_rows.append(f"| {i} | `{cmd}` | {s} |")

    if kpi_rows:
        header    = "| | Command | Summary |"
        separator = "|---|---|---|"
        body      = "\n".join(kpi_rows)
        kpi_table = f"{header}\n{separator}\n{body}"
    else:
        kpi_table = "_No KPI data available_"

    lhc = ""
    if node.get("hc_time"):
        try:
            lhc = datetime.fromtimestamp(node["hc_time"], tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        except Exception:
            pass

    content = f"""---
tags: [healthcheck, {node.get("vendor", "").lower()}, {status}]
device: "{name}"
status: "{status}"
ip: "{node.get("ip", "")}"
last_healthcheck: "{lhc}"
last_import: "{ts_now()}"
---

# {icon} HealthCheck — {name}

Back to device: {wl("Devices/" + slug)}

## KPI Table
{kpi_table}

## Raw Preview
```
{raw_preview}
```

---
*Last imported: {ts_now()}*
"""
    write_note(HEALTHCHECK_DIR / f"{slug}.md", content)


# ── Topology link notes → Topology/ ──────────────────────────────────────────

def write_topology_notes(nodes: list, edges: list):
    """One note per device listing all its links."""
    # Build BGP peer IP exclusion set (same logic as run_import)
    bgp_peer_ips = {
        n["ip"] for n in nodes
        if n.get("node_type") == "bgp_cloud" and n.get("ip")
    }

    device_edges = defaultdict(list)
    for e in edges:
        if e.get("protocol") == "bgp":
            continue
        src, tgt = e.get("source", ""), e.get("target", "")
        if src: device_edges[src].append(e)
        if tgt: device_edges[tgt].append(e)

    node_map = {n["id"]: n for n in nodes}

    for device, dev_edges in device_edges.items():
        n = node_map.get(device, {})
        if n.get("node_type"):
            continue
        if device in bgp_peer_ips:
            continue
        if "bgp_upstream" in (n.get("groups") or []):
            continue
        slug = safe_slug(device)
        rows = []
        for e in dev_edges:
            peer   = e["target"] if e["source"] == device else e["source"]
            proto  = e.get("protocol", "?").upper()
            status = e.get("status", "ok")
            li     = e.get("local_interface", "")
            rp     = e.get("remote_port", "")
            badge  = "🟢" if status == "ok" else "🔴"
            rows.append(f"| {badge} | {wl(peer)} | `{proto}` | `{li}` | `{rp}` |")

        header = "| | Peer | Protocol | Local Interface | Remote Port |"
        sep    = "|---|---|---|---|---|"
        body   = "\n".join(rows) if rows else "| — | — | — | — | — |"

        content = f"""---
tags: [topology, links]
device: "{device}"
link_count: {len(dev_edges)}
last_import: "{ts_now()}"
---

# Topology Links — {device}

Back to device: {wl("Devices/" + slug)}

{header}
{sep}
{body}

---
*Last imported: {ts_now()}*
"""
        write_note(TOPOLOGY_DIR / f"Links-{slug}.md", content)


# ── Site notes → Sites/ ───────────────────────────────────────────────────────

def write_site_notes(nodes: list):
    bgp_peer_ips = {
        n["ip"] for n in nodes
        if n.get("node_type") == "bgp_cloud" and n.get("ip")
    }
    sites = defaultdict(list)
    for node in nodes:
        if node.get("node_type"):
            continue
        if node.get("id") in bgp_peer_ips:
            continue
        if "bgp_upstream" in (node.get("groups") or []):
            continue
        for g in (node.get("groups") or []):
            if g and g != "default":
                sites[g].append(node["id"])

    for site, members in sites.items():
        slug  = safe_slug(site)
        links = "\n".join(
            f"- {wl('Devices/' + safe_slug(m))} ({m})" for m in sorted(members)
        )
        content = f"""---
tags: [site]
site: "{site}"
device_count: {len(members)}
last_import: "{ts_now()}"
---

# Site: {site}

## Devices ({len(members)})
{links}

---
*Last imported: {ts_now()}*
"""
        write_note(SITES_DIR / f"{slug}.md", content)


# ── Inventory notes → Inventory/ ─────────────────────────────────────────────

def write_inventory_notes(device_registry: list, eoleos_compliance: dict) -> int:
    """Write one Inventory/ note per registered device — pure CMDB record
    (hostname, IP, vendor, group, device type, SSH command sources).

    Source of truth:  backend/devices/*.yaml  (CMDB)

    EOL/EOS compliance is a separate concern with its own lifecycle and
    urgency semantics — it lives in its own EOL/ note (see write_eoleos_notes),
    linked from here rather than embedded. This note only borrows the EOL
    status icon for an at-a-glance header, nothing more.
    """
    if not device_registry:
        log.warning("Device registry is empty — skipping Inventory/ notes")
        return 0

    count = 0
    for dev in device_registry:
        hostname = dev.get("hostname", "")
        if not hostname:
            continue

        slug   = safe_slug(hostname)
        vendor = dev.get("vendor", "unknown")
        ip     = dev.get("ip", "")
        group  = dev.get("group", "")
        dtype  = dev.get("device_type", "")
        cmds   = dev.get("commands", [])
        src    = dev.get("source_file", "")

        icon = _eoleos_icon(eoleos_compliance.get(hostname, {}))

        cmd_lines = "\n".join(
            f"- **{c.get('name', '?')}** → `{c.get('path', '?')}`"
            for c in cmds if isinstance(c, dict)
        ) or "_None configured_"

        tags = ["inventory", "device", vendor, group or "ungrouped"]

        fm = {
            "tags": tags,
            "hostname": hostname,
            "ip": ip,
            "vendor": vendor,
            "group": group,
            "device_type": dtype,
            "source_file": src,
            "last_import": ts_now(),
        }
        fm_yaml = yaml.dump(fm, default_flow_style=False, allow_unicode=True, sort_keys=False)

        device_link = wl(f"Devices/{slug}")
        site_link   = wl(f"Sites/{safe_slug(group)}") if group else "—"

        content = f"""---
{fm_yaml}---

# {icon} {hostname}

| Field | Value |
|-------|-------|
| **IP Address** | `{ip}` |
| **Vendor** | `{vendor}` |
| **Group / Site** | {site_link} |
| **Device Type** | `{dtype or "—"}` |
| **Source File** | `{src}` |

## SSH Command Sources
{cmd_lines}

## Links
- Live State: {device_link}
- Site: {site_link}
- EOL / EOS Compliance: {wl("EOL/" + slug)}
- Healthcheck: {wl("HealthChecks/" + slug)}
- Backup: {wl("Backups/" + slug)}

---
*Last imported: {ts_now()}*
"""
        write_note(INVENTORY_DIR / f"{slug}.md", content)
        count += 1

    return count


def _eoleos_icon(eol: dict) -> str:
    """Worst-case EOL/EOS status icon for a device — shared by Inventory's
    at-a-glance header and the dedicated EOL note."""
    if eol.get("is_software_expired") or eol.get("is_hardware_expired"):
        return "🔴"
    if eol.get("is_software_warning") or eol.get("is_hardware_warning"):
        return "🟡"
    if eol.get("matched"):
        return "🟢"
    return "⚫"


# ── EOL/EOS notes → EOL/ ──────────────────────────────────────────────────────

def write_eoleos_notes(device_registry: list, eoleos_compliance: dict) -> int:
    """Write one EOL/ note per registered device — dedicated EOL/EOS
    compliance record, separate from the Inventory/ CMDB note.

    Source: /eoleos-compliance API (pre-computed per device, matched against
    running version from latest healthcheck).
    """
    if not device_registry:
        return 0

    count = 0
    for dev in device_registry:
        hostname = dev.get("hostname", "")
        if not hostname:
            continue

        slug  = safe_slug(hostname)
        group = dev.get("group", "")
        dtype = dev.get("device_type", "")

        eol = eoleos_compliance.get(hostname, {})
        sw_eos          = eol.get("software_eos", "N/A")
        hw_eos          = eol.get("hardware_eos", "N/A")
        platform        = eol.get("platform", dtype or "—")
        current_version = eol.get("current_version", "Unknown")
        rec_version     = eol.get("recommended_version", "N/A")
        eol_status      = eol.get("status", "unknown")
        sw_expired      = eol.get("is_software_expired", False)
        hw_expired      = eol.get("is_hardware_expired", False)
        sw_warning      = eol.get("is_software_warning", False)
        hw_warning      = eol.get("is_hardware_warning", False)
        has_hc          = eol.get("has_healthcheck", False)
        matched         = eol.get("matched", False)

        icon = _eoleos_icon(eol)
        urgency = (
            "eol_expired" if (sw_expired or hw_expired) else
            "eol_warning" if (sw_warning or hw_warning) else
            "eol_ok" if matched else
            "unknown"
        )

        tags = ["eol", "eoleos", "device", urgency]

        if matched:
            body = f"""
| Field | Value |
|-------|-------|
| **Platform** | `{platform}` |
| **Current Version** | `{current_version}` |
| **Recommended Version** | `{rec_version}` |
| **Software EOS** | `{sw_eos}` |
| **Hardware EOS** | `{hw_eos}` |
| **Compliance Status** | `{eol_status}` |
| **Software Expired** | `{"⚠️ YES" if sw_expired else "✅ No"}` |
| **Hardware Expired** | `{"⚠️ YES" if hw_expired else "✅ No"}` |
"""
        elif has_hc:
            body = "\n_Device version not matched in EOL database._\n"
        else:
            body = "\n_No healthcheck data available — cannot determine version._\n"

        fm = {
            "tags": tags,
            "hostname": hostname,
            "platform": platform,
            "current_version": current_version,
            "eol_urgency": urgency,
            "software_eos": sw_eos,
            "hardware_eos": hw_eos,
            "last_import": ts_now(),
        }
        fm_yaml = yaml.dump(fm, default_flow_style=False, allow_unicode=True, sort_keys=False)

        content = f"""---
{fm_yaml}---

# {icon} {hostname} — EOL / EOS Compliance
{body}
## Links
- Inventory (CMDB): {wl("Inventory/" + slug)}
- Live State: {wl("Devices/" + slug)}

---
*Last imported: {ts_now()}*
"""
        write_note(EOL_DIR / f"{slug}.md", content)
        count += 1

    return count


# ── Backup notes → Backups/ ──────────────────────────────────────────────────

def write_backup_notes(backups_summary: dict) -> int:
    """Write one Backups/ note per device with backup status and gold-standard compliance."""
    count = 0
    for hostname, dev in backups_summary.items():
        slug    = safe_slug(hostname)
        vendor  = dev.get("vendor", "unknown")
        group   = dev.get("group", "")
        bsum    = dev.get("backup_summary", {})

        last_backup   = bsum.get("last_backup") or {}
        last_changed  = bsum.get("last_changed") or {}
        gold_standard = bsum.get("gold_standard") or {}
        is_compliant  = bsum.get("is_compliant")

        # Backup status icon
        b_status = last_backup.get("status", "never")
        if b_status == "success":
            b_icon = "🟢"
        elif b_status in ("fail", "error"):
            b_icon = "🔴"
        else:
            b_icon = "⚫"

        # Gold-standard compliance icon
        if gold_standard:
            gs_icon = "🟢" if is_compliant else "🔴"
            gs_label = "Compliant" if is_compliant else "Drift detected"
        else:
            gs_icon = "⚫"
            gs_label = "No gold standard set"

        collected_at  = last_backup.get("collected_at", "—")
        error_msg     = last_backup.get("error_msg") or ""
        duration      = last_backup.get("duration", "—")
        backup_id     = last_backup.get("id", "—")

        changed_at    = last_changed.get("collected_at", "—")
        lines_added   = last_changed.get("lines_added", 0)
        lines_deleted = last_changed.get("lines_deleted", 0)
        commit_hash   = last_changed.get("commit_hash", "—")

        error_line = f"\n> ⚠️ **Error**: {error_msg}\n" if error_msg else ""

        tags = ["backup", vendor, group or "ungrouped"]
        if is_compliant is True:
            tags.append("gold_compliant")
        elif is_compliant is False:
            tags.append("gold_drift")

        fm = {
            "tags": tags,
            "hostname": hostname,
            "vendor": vendor,
            "group": group,
            "last_backup_status": b_status,
            "last_backup_at": collected_at,
            "gold_standard_compliant": is_compliant,
            "last_import": ts_now(),
        }
        fm_yaml = yaml.dump(fm, default_flow_style=False, allow_unicode=True, sort_keys=False)

        content = f"""---
{fm_yaml}---

# {b_icon} Backup — {hostname}

Back to device: {wl("Devices/" + slug)} | Inventory: {wl("Inventory/" + slug)}

## Latest Backup
| Field | Value |
|-------|-------|
| **Status** | {b_icon} `{b_status}` |
| **Collected At** | `{collected_at}` |
| **Duration** | `{duration}` |
| **Backup ID** | `{backup_id}` |
{error_line}
## Last Config Change
| Field | Value |
|-------|-------|
| **Changed At** | `{changed_at}` |
| **Lines Added** | `+{lines_added}` |
| **Lines Deleted** | `-{lines_deleted}` |
| **Commit** | `{commit_hash}` |

## Gold Standard Compliance
| | |
|---|---|
| **Status** | {gs_icon} {gs_label} |
| **Gold Standard ID** | `{gold_standard.get("id", "—")}` |

---
*Last imported: {ts_now()}*
"""
        write_note(BACKUPS_DIR / f"{slug}.md", content)
        count += 1

    return count


# ── Automation notes → Automation/ ───────────────────────────────────────────

def write_automation_notes(flows: list, executions: list) -> int:
    """Write one Automation/ note per flow with definition and recent execution history."""
    if not flows:
        return 0

    # Build execution lookup: {flow_id: [execution, ...]} sorted newest first
    exec_by_flow: dict = defaultdict(list)
    for ex in executions:
        fid = ex.get("flow_id") or ex.get("flow_name") or ""
        if fid:
            exec_by_flow[str(fid)].append(ex)

    count = 0
    for flow in flows:
        flow_id   = str(flow.get("id", ""))
        flow_name = flow.get("name", flow_id or "unknown")
        slug      = safe_slug(flow_name)
        desc      = flow.get("description", "")
        created   = flow.get("created_at", "—")
        updated   = flow.get("updated_at", "—")

        # Recent executions (last 10)
        recent_execs = exec_by_flow.get(flow_id, [])[:10]
        exec_rows = []
        for ex in recent_execs:
            ex_status  = ex.get("status", "unknown")
            ex_icon    = "🟢" if ex_status == "success" else ("🔴" if ex_status in ("failed", "error") else "🟡")
            ex_time    = ex.get("started_at") or ex.get("created_at", "—")
            ex_device  = ex.get("device_name") or ex.get("target", "—")
            ex_id      = ex.get("task_id") or ex.get("id", "—")
            exec_rows.append(f"| {ex_icon} | `{ex_status}` | `{ex_time}` | `{ex_device}` | `{ex_id}` |")

        exec_table = ""
        if exec_rows:
            exec_table = "| | Status | Started At | Target Device | Task ID |\n"
            exec_table += "|---|---|---|---|---|\n"
            exec_table += "\n".join(exec_rows)
        else:
            exec_table = "_No executions recorded yet._"

        # Overall health: latest execution status
        latest_status = recent_execs[0].get("status", "never") if recent_execs else "never"
        health_icon   = "🟢" if latest_status == "success" else ("🔴" if latest_status in ("failed", "error") else "⚫")

        fm = {
            "tags": ["automation", "flow"],
            "flow_id": flow_id,
            "flow_name": flow_name,
            "last_run_status": latest_status,
            "created_at": created,
            "last_import": ts_now(),
        }
        fm_yaml = yaml.dump(fm, default_flow_style=False, allow_unicode=True, sort_keys=False)

        content = f"""---
{fm_yaml}---

# {health_icon} Automation Flow — {flow_name}

{f"> {desc}" if desc else ""}

| Field | Value |
|-------|-------|
| **Flow ID** | `{flow_id}` |
| **Last Run Status** | {health_icon} `{latest_status}` |
| **Created** | `{created}` |
| **Updated** | `{updated}` |

## Recent Executions (last {len(recent_execs)})
{exec_table}

---
*Last imported: {ts_now()}*
"""
        write_note(AUTOMATION_DIR / f"{slug}.md", content)
        count += 1

    return count


# ── Vendor notes → Vendors/ ──────────────────────────────────────────────────

def write_vendor_notes(nodes: list, ip_map: dict) -> int:
    """One note per vendor listing all devices of that vendor with live status."""
    vendor_map: dict = defaultdict(list)
    for node in nodes:
        if node.get("node_type"):
            continue
        vendor = node.get("vendor", "unknown").lower()
        vendor_map[vendor].append(node)

    for vendor, dev_nodes in vendor_map.items():
        slug  = safe_slug(vendor.capitalize())
        total = len(dev_nodes)
        ok    = sum(1 for n in dev_nodes if n.get("status") == "ok")
        down  = sum(1 for n in dev_nodes if n.get("status") == "error")

        rows = []
        for n in sorted(dev_nodes, key=lambda x: x.get("id", "")):
            name   = ip_map.get(n["id"], n["id"]) if re.match(r'^\d{1,3}(\.\d{1,3}){3}$', n["id"]) else n["id"]
            status = n.get("status", "unknown")
            icon   = {"ok": "🟢", "error": "🔴", "auth_fail": "🔒", "unknown": "⚫"}.get(status, "⚫")
            groups = ", ".join(g for g in (n.get("groups") or []) if g != "default") or "—"
            dtype  = n.get("device_type", "—")
            rows.append(f"| {icon} | {wl('Devices/' + safe_slug(name))} | `{n.get('ip','')}` | `{dtype}` | {groups} |")

        header = "| | Device | IP | Type | Sites |"
        sep    = "|---|---|---|---|---|"
        body   = "\n".join(rows)

        overall_icon = "🟢" if down == 0 and ok > 0 else ("🔴" if down > 0 else "⚫")

        fm = {
            "tags": ["vendor", vendor],
            "vendor": vendor,
            "device_count": total,
            "devices_ok": ok,
            "devices_down": down,
            "last_import": ts_now(),
        }
        fm_yaml = yaml.dump(fm, default_flow_style=False, allow_unicode=True, sort_keys=False)

        content = f"""---
{fm_yaml}---

# {overall_icon} Vendor: {vendor.capitalize()}

| Metric | Value |
|---|---|
| **Total Devices** | {total} |
| **Up** | 🟢 {ok} |
| **Down** | 🔴 {down} |

## Devices

{header}
{sep}
{body}

---
*Last imported: {ts_now()}*
"""
        write_note(VENDORS_DIR / f"{slug}.md", content)

    return len(vendor_map)


# ── Protocol notes → Protocols/ ───────────────────────────────────────────────

def write_protocol_notes(nodes: list, edges: list, ip_map: dict) -> int:
    """Network-wide per-protocol summary notes: OSPF, BGP, LLDP."""

    def resolve(nid):
        return ip_map.get(nid, nid) if re.match(r'^\d{1,3}(\.\d{1,3}){3}$', nid) else nid

    node_map = {n["id"]: n for n in nodes if not n.get("node_type")}

    # ── OSPF ──────────────────────────────────────────────────────────────────
    ospf_edges = [e for e in edges if e.get("protocol") == "ospf"]
    ospf_devs: dict = defaultdict(list)
    for e in ospf_edges:
        ospf_devs[e["source"]].append(e)
        ospf_devs[e["target"]].append(e)

    rows = []
    total_ospf_links = len(ospf_edges)
    down_ospf = 0
    for dev_id, dev_edges in sorted(ospf_devs.items()):
        n      = node_map.get(dev_id, {})
        name   = resolve(dev_id)
        site   = ", ".join(g for g in (n.get("groups") or []) if g != "default") or "—"
        nbr_ok = sum(1 for e in dev_edges if e.get("status") == "ok")
        nbr_dn = sum(1 for e in dev_edges if e.get("status") != "ok")
        if nbr_dn:
            down_ospf += 1
        icon = "🟢" if nbr_dn == 0 else "🔴"
        rows.append(f"| {icon} | {wl('Devices/' + safe_slug(name))} | {len(dev_edges)} | {nbr_ok} | {nbr_dn} | {site} |")

    ospf_header = "| | Device | Total Neighbors | Up | Down | Sites |"
    ospf_sep    = "|---|---|---|---|---|---|"
    ospf_body   = "\n".join(rows) if rows else "| — | — | — | — | — | — |"
    ospf_icon   = "🟢" if down_ospf == 0 else "🔴"

    write_note(PROTOCOLS_DIR / "OSPF.md", f"""---
tags: [protocol, ospf]
protocol: ospf
total_links: {total_ospf_links}
devices_with_issues: {down_ospf}
last_import: "{ts_now()}"
---

# {ospf_icon} OSPF — Network Summary

| Metric | Value |
|---|---|
| **Total OSPF Links** | {total_ospf_links} |
| **Devices Running OSPF** | {len(ospf_devs)} |
| **Devices with Issues** | 🔴 {down_ospf} |

## Per-Device OSPF State

{ospf_header}
{ospf_sep}
{ospf_body}

---
*Last imported: {ts_now()}*
""")

    # ── BGP ───────────────────────────────────────────────────────────────────
    bgp_edges = [e for e in edges if e.get("protocol") == "bgp"]
    bgp_devs: dict = defaultdict(list)
    for e in bgp_edges:
        bgp_devs[e["source"]].append(e)

    rows = []
    down_bgp = 0
    for dev_id, dev_edges in sorted(bgp_devs.items()):
        n      = node_map.get(dev_id, {})
        name   = resolve(dev_id)
        site   = ", ".join(g for g in (n.get("groups") or []) if g != "default") or "—"
        local_as = n.get("local_as", "—")
        up_cnt = sum(1 for e in dev_edges if e.get("status") == "ok")
        dn_cnt = sum(1 for e in dev_edges if e.get("status") != "ok")
        if dn_cnt:
            down_bgp += 1
        icon = "🟢" if dn_cnt == 0 else "🔴"
        rows.append(f"| {icon} | {wl('Devices/' + safe_slug(name))} | `AS{local_as}` | {len(dev_edges)} | {up_cnt} | {dn_cnt} | {site} |")

    bgp_header = "| | Device | Local AS | Upstreams | Up | Down | Sites |"
    bgp_sep    = "|---|---|---|---|---|---|---|"
    bgp_body   = "\n".join(rows) if rows else "| — | — | — | — | — | — | — |"
    bgp_icon   = "🟢" if down_bgp == 0 else "🔴"

    write_note(PROTOCOLS_DIR / "BGP.md", f"""---
tags: [protocol, bgp]
protocol: bgp
total_sessions: {len(bgp_edges)}
devices_with_issues: {down_bgp}
last_import: "{ts_now()}"
---

# {bgp_icon} BGP — Network Summary

| Metric | Value |
|---|---|
| **Total BGP Sessions** | {len(bgp_edges)} |
| **Devices Running BGP** | {len(bgp_devs)} |
| **Devices with Issues** | 🔴 {down_bgp} |

## Per-Device BGP State

{bgp_header}
{bgp_sep}
{bgp_body}

---
*Last imported: {ts_now()}*
""")

    # ── LLDP ──────────────────────────────────────────────────────────────────
    lldp_edges = [e for e in edges if e.get("protocol") == "lldp"]
    rows = []
    for e in sorted(lldp_edges, key=lambda x: x.get("source", "")):
        src  = resolve(e["source"])
        tgt  = resolve(e["target"])
        li   = e.get("local_interface", "")
        rp   = e.get("remote_port", "")
        icon = "🟢" if e.get("status", "ok") == "ok" else "🔴"
        rows.append(f"| {icon} | {wl('Devices/' + safe_slug(src))} | {wl('Devices/' + safe_slug(tgt))} | `{li}` | `{rp}` |")

    lldp_header = "| | Source | Peer | Local Interface | Remote Port |"
    lldp_sep    = "|---|---|---|---|---|"
    lldp_body   = "\n".join(rows) if rows else "| — | — | — | — | — |"

    write_note(PROTOCOLS_DIR / "LLDP.md", f"""---
tags: [protocol, lldp]
protocol: lldp
total_links: {len(lldp_edges)}
last_import: "{ts_now()}"
---

# 🔵 LLDP — Network Summary

| Metric | Value |
|---|---|
| **Total LLDP Links** | {len(lldp_edges)} |

## LLDP Adjacencies

{lldp_header}
{lldp_sep}
{lldp_body}

---
*Last imported: {ts_now()}*
""")

    return 3  # OSPF + BGP + LLDP


# ── BGP peer notes → Protocols/BGP-Peers/ ────────────────────────────────────

def write_bgp_peer_notes(nodes: list) -> int:
    """One note per external BGP peer session.

    Every device note's "BGP Upstreams" section links to [[AS<num>@<device>]]
    (see write_device_note) — without a matching note, that's a dead-end
    unresolved wikilink in Obsidian. This writes the note those links
    actually resolve to: peer AS/company/IP, session state, and a link back
    to the owning device. Source: topology nodes with node_type=="bgp_cloud".
    """
    peers = [n for n in nodes if n.get("node_type") == "bgp_cloud"]
    count = 0
    for n in peers:
        peer_id   = n.get("id", "")
        if not peer_id:
            continue
        as_num    = n.get("remote_as")
        ip        = n.get("ip", "")
        company   = n.get("company_name") or ""
        status    = n.get("status", "unknown")
        bgp_state = n.get("bgp_status", "unknown")
        is_main   = bool(n.get("main", False))
        sessions  = n.get("session_count", 1)
        owner     = n.get("router_id", "")

        icon = "🟢" if status == "ok" else "🔴" if status in ("error", "down") else "⚫"
        title = f"AS{as_num}" + (f" ({company})" if company else "")

        tags = ["bgp-peer", "protocol", "bgp"]
        if is_main:
            tags.append("main-upstream")

        fm = {
            "tags": tags,
            "peer_as": as_num,
            "peer_ip": ip,
            "company": company or None,
            "status": status,
            "bgp_status": bgp_state,
            "is_main_upstream": is_main,
            "session_count": sessions,
            "owning_device": owner,
            "last_import": ts_now(),
        }
        fm_yaml = yaml.dump(fm, default_flow_style=False, allow_unicode=True, sort_keys=False)

        owner_link = wl("Devices/" + safe_slug(owner)) if owner else "—"

        content = f"""---
{fm_yaml}---

# {icon} {title} — BGP Peer of {owner or "Unknown"}

| Field | Value |
|---|---|
| **Peer AS** | `AS{as_num}` |
| **Company** | {company or "—"} |
| **Peer IP** | `{ip}` |
| **BGP Session State** | `{bgp_state}` |
| **Link Status** | {icon} `{status}` |
| **Main Upstream** | {"✅ Yes" if is_main else "No"} |
| **Sessions with this peer** | {sessions} |

## Owning Device
- {owner_link}

## Related
- {wl("Protocols/BGP")}

---
*Last imported: {ts_now()}*
"""
        write_note(BGP_PEERS_DIR / f"{safe_slug(peer_id)}.md", content)
        count += 1

    return count


# ── Monitoring notes → Monitoring/ ───────────────────────────────────────────

# Maps keyword fragments in CLI command names → monitoring domain file
_MONITORING_DOMAINS = {
    "bgp":         "BGP.md",
    "ospf":        "OSPF.md",
    "interface":   "Interfaces.md",
    "cpu":         "CPU.md",
    "memory":      "Memory.md",
    "temperature": "Temperature.md",
    "mpls":        "MPLS.md",
    "bfd":         "BFD.md",
}

def write_monitoring_notes(nodes: list, hc_by_device: dict, ip_map: dict) -> int:
    """Aggregate monitoring notes per domain showing devices with warnings or errors."""

    def resolve(nid):
        return ip_map.get(nid, nid) if re.match(r'^\d{1,3}(\.\d{1,3}){3}$', nid) else nid

    # domain → [{device, status, summary, cmd}]
    domain_issues: dict = defaultdict(list)
    domain_all: dict    = defaultdict(list)  # every device seen in this domain

    node_map = {n["id"]: n for n in nodes}

    for dev_id, hc in hc_by_device.items():
        name = resolve(dev_id)
        n    = node_map.get(dev_id, {})
        site = ", ".join(g for g in (n.get("groups") or []) if g != "default") or "—"

        for cmd, blk in (hc.get("analysis") or {}).items():
            cmd_l  = cmd.lower()
            status = blk.get("status", "ok")
            summ   = blk.get("summary", "")

            for keyword, domain_file in _MONITORING_DOMAINS.items():
                if keyword in cmd_l:
                    entry = {
                        "name": name, "dev_id": dev_id,
                        "cmd": cmd, "status": status,
                        "summary": summ, "site": site,
                    }
                    domain_all[domain_file].append(entry)
                    if status in ("warning", "error", "critical"):
                        domain_issues[domain_file].append(entry)
                    break  # one domain per command

    written = 0
    all_domains = set(domain_all.keys()) | set(domain_issues.keys())

    for domain_file in sorted(all_domains):
        all_entries    = domain_all.get(domain_file, [])
        issue_entries  = domain_issues.get(domain_file, [])
        domain_name    = domain_file.replace(".md", "")
        overall_icon   = "🟢" if not issue_entries else "🔴"

        # Issues table
        issue_rows = []
        for e in sorted(issue_entries, key=lambda x: x["name"]):
            st_icon = "⚠️" if e["status"] == "warning" else "🔴"
            issue_rows.append(
                f"| {st_icon} | {wl('Devices/' + safe_slug(e['name']))} "
                f"| `{e['cmd']}` | {e['summary']} | {e['site']} |"
            )

        # All-devices summary table
        all_rows = []
        for e in sorted(all_entries, key=lambda x: x["name"]):
            st_icon = {"ok": "✅", "warning": "⚠️", "error": "🔴", "critical": "🔴"}.get(e["status"], "ℹ️")
            all_rows.append(
                f"| {st_icon} | {wl('Devices/' + safe_slug(e['name']))} "
                f"| `{e['cmd']}` | {e['summary']} | {e['site']} |"
            )

        tbl_header = "| | Device | Command | Summary | Sites |"
        tbl_sep    = "|---|---|---|---|---|"

        issue_block = (f"{tbl_header}\n{tbl_sep}\n" + "\n".join(issue_rows)) if issue_rows else "_No issues detected._"
        all_block   = (f"{tbl_header}\n{tbl_sep}\n" + "\n".join(all_rows)) if all_rows else "_No data._"

        content = f"""---
tags: [monitoring, {domain_name.lower()}]
domain: "{domain_name}"
total_devices: {len(set(e['name'] for e in all_entries))}
devices_with_issues: {len(set(e['name'] for e in issue_entries))}
last_import: "{ts_now()}"
---

# {overall_icon} Monitoring — {domain_name}

| Metric | Value |
|---|---|
| **Devices Monitored** | {len(set(e['name'] for e in all_entries))} |
| **Devices with Issues** | 🔴 {len(set(e['name'] for e in issue_entries))} |

## ⚠️ Active Issues

{issue_block}

## All Devices in Domain

{all_block}

---
*Last imported: {ts_now()}*
"""
        write_note(MONITORING_DIR / domain_file, content)
        written += 1

    return written


# ── Changes notes → Changes/ ──────────────────────────────────────────────────

def write_changes_notes(backups_summary: dict) -> int:
    """One Changes/ note per device with config change history (last 10 changes)."""
    written = 0
    for hostname, dev in backups_summary.items():
        device_id = dev.get("id") or dev.get("device_id")
        if not device_id:
            continue

        slug   = safe_slug(hostname)
        vendor = dev.get("vendor", "unknown")
        group  = dev.get("group", "")

        history = fetch_device_change_history(device_id, limit=20)
        # Only entries where config actually changed
        changes = [h for h in history if h.get("changed") or h.get("lines_added") or h.get("lines_deleted")][:10]

        rows = []
        for ch in changes:
            collected = ch.get("collected_at", "—")
            lines_add = ch.get("lines_added", 0) or 0
            lines_del = ch.get("lines_deleted", 0) or 0
            commit    = (ch.get("commit_hash") or ch.get("id") or "—")[:10]
            status    = ch.get("status", "success")
            st_icon   = "🟢" if status == "success" else "🔴"
            rows.append(
                f"| {st_icon} | `{collected}` | `+{lines_add}` | `-{lines_del}` | `{commit}` |"
            )

        tbl_header = "| | Collected At | Lines Added | Lines Deleted | Commit |"
        tbl_sep    = "|---|---|---|---|---|"
        tbl_body   = "\n".join(rows) if rows else "_No config changes recorded._"

        # Last change summary from backups_summary (already fetched)
        bsum        = dev.get("backup_summary", {})
        last_backup = bsum.get("last_backup") or {}
        last_b_time = last_backup.get("collected_at", "—")
        last_b_stat = last_backup.get("status", "—")
        b_icon      = "🟢" if last_b_stat == "success" else ("🔴" if last_b_stat in ("fail","error") else "⚫")

        fm = {
            "tags": ["changes", "config", vendor, group or "ungrouped"],
            "hostname": hostname,
            "vendor": vendor,
            "change_count": len(changes),
            "last_backup_at": last_b_time,
            "last_import": ts_now(),
        }
        fm_yaml = yaml.dump(fm, default_flow_style=False, allow_unicode=True, sort_keys=False)

        content = f"""---
{fm_yaml}---

# 📋 Config Changes — {hostname}

Back to device: {wl("Devices/" + slug)} | Backup status: {wl("Backups/" + slug)}

| Field | Value |
|---|---|
| **Last Backup** | {b_icon} `{last_b_time}` (`{last_b_stat}`) |
| **Changes Recorded** | {len(changes)} |

## Config Change History (last {len(changes)})

{tbl_header}
{tbl_sep}
{tbl_body}

---
*Last imported: {ts_now()}*
"""
        write_note(CHANGES_DIR / f"{slug}.md", content)
        written += 1

    return written


# ── Log notes → Logs/ ────────────────────────────────────────────────────────

# CLI command keywords that indicate log/syslog/alarm output
_LOG_KEYWORDS = ("log", "logbuffer", "logging", "syslog", "alarm", "trap", "event", "debug")

# Severity keywords to flag in log summaries
_LOG_SEVERITY = {
    "critical": "🔴", "error": "🔴", "err": "🔴",
    "warning":  "🟡", "warn": "🟡",
    "notice":   "🔵", "info": "🟢",
}


def write_log_notes(nodes: list, hc_by_device: dict, ip_map: dict) -> int:
    """One Logs/ note per device extracting log/syslog/alarm commands from healthchecks."""

    def resolve(nid):
        return ip_map.get(nid, nid) if re.match(r'^\d{1,3}(\.\d{1,3}){3}$', nid) else nid

    node_map = {n["id"]: n for n in nodes}
    written  = 0

    for dev_id, hc in hc_by_device.items():
        name = resolve(dev_id)
        slug = safe_slug(name)
        n    = node_map.get(dev_id, {})
        site = ", ".join(g for g in (n.get("groups") or []) if g != "default") or "—"

        # Find log-related command blocks in this device's healthcheck
        log_blocks = {}
        for cmd, blk in (hc.get("analysis") or {}).items():
            cmd_l = cmd.lower()
            if any(kw in cmd_l for kw in _LOG_KEYWORDS):
                log_blocks[cmd] = blk

        if not log_blocks:
            continue  # device has no log commands in healthcheck — skip

        # Determine worst severity across all log blocks
        worst_icon = "🟢"
        rows = []
        for cmd, blk in sorted(log_blocks.items()):
            status  = blk.get("status", "ok")
            summary = blk.get("summary", "")
            st_icon = {"ok": "✅", "warning": "⚠️", "error": "🔴", "critical": "🔴"}.get(status, "ℹ️")
            if status in ("error", "critical"):
                worst_icon = "🔴"
            elif status == "warning" and worst_icon != "🔴":
                worst_icon = "🟡"
            rows.append(f"| {st_icon} | `{cmd}` | {summary} |")

        # Scan raw_preview for severity keywords to surface in the note
        raw = (hc.get("raw_preview") or "")
        severity_hits = []
        for line in raw.splitlines():
            line_l = line.lower()
            for sev, sev_icon in _LOG_SEVERITY.items():
                if sev in line_l and len(line.strip()) > 10:
                    severity_hits.append(f"| {sev_icon} | `{sev.upper()}` | `{line.strip()[:120]}` |")
                    break
        severity_hits = severity_hits[:20]  # cap at 20 lines

        tbl_header = "| | Command | Summary |"
        tbl_sep    = "|---|---|---|"
        tbl_body   = "\n".join(rows)

        sev_block = ""
        if severity_hits:
            sev_block = (
                "\n## Log Entries (from raw preview)\n\n"
                "| | Severity | Message |\n"
                "|---|---|---|\n"
                + "\n".join(severity_hits)
            )

        fm = {
            "tags": ["logs", n.get("vendor", "unknown"), site],
            "device": name,
            "log_commands": len(log_blocks),
            "worst_status": worst_icon,
            "last_import": ts_now(),
        }
        fm_yaml = yaml.dump(fm, default_flow_style=False, allow_unicode=True, sort_keys=False)

        content = f"""---
{fm_yaml}---

# {worst_icon} Logs — {name}

Back to device: {wl("Devices/" + slug)} | Healthcheck: {wl("HealthChecks/" + slug)}

| Field | Value |
|---|---|
| **Site** | {site} |
| **Log Commands** | {len(log_blocks)} |

## Log Command Summaries

{tbl_header}
{tbl_sep}
{tbl_body}
{sev_block}

---
*Last imported: {ts_now()}*
"""
        write_note(LOGS_DIR / f"{slug}.md", content)
        written += 1

    return written


# ── AI health summary → AI/ ───────────────────────────────────────────────────

OLLAMA_NUM_THREAD = int(os.getenv("OLLAMA_NUM_THREAD", "16"))

# Cache of the last cycle's signature + generated narrative — lets us skip the
# CPU-bound Ollama call entirely when nothing has actually changed, since this
# call shares the same Ollama instance as interactive user chat.
_last_summary_signature = None
_last_summary_text = ""

def generate_health_summary(
    nodes: list,
    edges: list,
    hc_by_device: dict,
    ip_map: dict,
) -> str:
    """Call Ollama to generate a narrative network health summary.
    Returns the generated text, or empty string on failure."""

    def resolve(nid):
        return ip_map.get(nid, nid) if re.match(r'^\d{1,3}(\.\d{1,3}){3}$', nid) else nid

    real_nodes = [n for n in nodes if not n.get("node_type")]
    total   = len(real_nodes)
    ok      = sum(1 for n in real_nodes if n.get("status") == "ok")
    down    = sum(1 for n in real_nodes if n.get("status") == "error")
    unknown = total - ok - down

    ospf_links = sum(1 for e in edges if e.get("protocol") == "ospf")
    bgp_sess   = sum(1 for e in edges if e.get("protocol") == "bgp")
    lldp_links = sum(1 for e in edges if e.get("protocol") == "lldp")
    ospf_down  = sum(1 for e in edges if e.get("protocol") == "ospf" and e.get("status") != "ok")
    bgp_down   = sum(1 for e in edges if e.get("protocol") == "bgp"  and e.get("status") != "ok")

    # Collect devices with issues
    down_devices = [resolve(n["id"]) for n in real_nodes if n.get("status") == "error"]
    auth_fail    = [resolve(n["id"]) for n in real_nodes if n.get("status") == "auth_fail"]

    # Collect critical/error KPIs across all healthchecks
    critical_kpis = []
    for dev_id, hc in hc_by_device.items():
        name = resolve(dev_id)
        for cmd, blk in (hc.get("analysis") or {}).items():
            if blk.get("status") in ("error", "critical", "warning"):
                critical_kpis.append(f"  - {name} / {cmd}: {blk.get('summary','')}")
    critical_kpis = critical_kpis[:10]  # keep prompt short for CPU inference

    global _last_summary_signature, _last_summary_text
    signature = (
        total, ok, down, unknown, ospf_links, ospf_down, bgp_sess, bgp_down,
        tuple(sorted(down_devices)), tuple(sorted(auth_fail)), tuple(critical_kpis),
    )
    if signature == _last_summary_signature and _last_summary_text:
        log.info("Network state unchanged since last cycle — reusing cached AI health summary (skipping Ollama call)")
        return _last_summary_text

    down_list = ", ".join(down_devices[:10]) or "None"
    auth_list = ", ".join(auth_fail[:5])     or "None"
    kpi_list  = "\n".join(critical_kpis)    or "No critical KPIs."

    prompt = f"""Network health report {ts_now()}:
Devices: {ok} up, {down} down, {unknown} unknown (total {total})
OSPF: {ospf_links} links, {ospf_down} down. BGP: {bgp_sess} sessions, {bgp_down} down.
DOWN: {down_list}
Auth failures: {auth_list}
Issues: {kpi_list}

Write a 3-paragraph NOC health summary: (1) overall status, (2) specific issues and devices, (3) recommended actions. Under 200 words, plain text."""

    # Auto-detect available model if configured one isn't found
    model = OLLAMA_MODEL
    try:
        tags_r = requests.get(f"{OLLAMA_API}/api/tags", timeout=10)
        if tags_r.status_code == 200:
            available = [m["name"] for m in tags_r.json().get("models", [])]
            if available:
                # Use configured model if available, else fall back to first installed
                if model not in available:
                    # Try prefix match (e.g. "llama3.2" matches "llama3.2:latest")
                    match = next((m for m in available if m.startswith(model.split(":")[0])), None)
                    model = match or available[0]
                    log.info("Ollama model auto-selected: %s (configured: %s)", model, OLLAMA_MODEL)
            else:
                log.warning("No Ollama models installed — skipping AI summary")
                return ""
    except Exception as e:
        log.warning("Cannot reach Ollama API: %s", e)
        return ""

    try:
        r = requests.post(
            f"{OLLAMA_API}/api/generate",
            json={
                "model": model,
                "prompt": prompt,
                "stream": False,
                "options": {"num_thread": OLLAMA_NUM_THREAD, "num_predict": 400},
            },
            timeout=300,  # CPU inference is slow — allow 5 minutes
        )
        if r.status_code == 200:
            text = r.json().get("response", "").strip()
            _last_summary_signature = signature
            _last_summary_text = text
            return text
        log.warning("Ollama returned HTTP %d for health summary", r.status_code)
    except Exception as e:
        log.warning("Ollama health summary failed: %s", e)
    return ""


def write_ai_notes(
    nodes: list,
    edges: list,
    hc_by_device: dict,
    ip_map: dict,
) -> int:
    """Generate and write AI network health summaries to AI/ folder."""

    log.info("Generating AI health summary via Ollama (%s)…", OLLAMA_MODEL)
    narrative = generate_health_summary(nodes, edges, hc_by_device, ip_map)

    if not narrative:
        log.warning("AI health summary: no response from Ollama — skipping AI/ note")
        return 0

    real_nodes = [n for n in nodes if not n.get("node_type")]
    total  = len(real_nodes)
    ok     = sum(1 for n in real_nodes if n.get("status") == "ok")
    down   = sum(1 for n in real_nodes if n.get("status") == "error")
    ospf_d = sum(1 for e in edges if e.get("protocol") == "ospf" and e.get("status") != "ok")
    bgp_d  = sum(1 for e in edges if e.get("protocol") == "bgp"  and e.get("status") != "ok")

    overall_icon = "🟢" if down == 0 and ospf_d == 0 and bgp_d == 0 else ("🔴" if down > 0 else "🟡")
    date_str     = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    fm = {
        "tags": ["ai", "health-summary", "automated"],
        "generated_at": ts_now(),
        "model": OLLAMA_MODEL,
        "devices_total": total,
        "devices_ok": ok,
        "devices_down": down,
        "overall_status": overall_icon,
    }
    fm_yaml = yaml.dump(fm, default_flow_style=False, allow_unicode=True, sort_keys=False)

    # Write dated note + overwrite the "latest" summary
    dated_content = f"""---
{fm_yaml}---

# {overall_icon} Network Health Summary — {date_str}

> *AI-generated by {OLLAMA_MODEL} · {ts_now()}*

## Summary

{narrative}

## Snapshot Metrics

| Metric | Value |
|---|---|
| **Devices UP** | 🟢 {ok} / {total} |
| **Devices DOWN** | 🔴 {down} |
| **OSPF Links Down** | {ospf_d} |
| **BGP Sessions Down** | {bgp_d} |

## Related
- {wl("Monitoring/BGP")} · {wl("Monitoring/OSPF")} · {wl("Monitoring/Interfaces")}
- {wl("Protocols/BGP")} · {wl("Protocols/OSPF")}

---
*Auto-generated · {ts_now()}*
"""
    write_note(AI_DIR / f"Health-Summary-{date_str}.md", dated_content)
    write_note(AI_DIR / "Network-Health-Latest.md", dated_content)  # always-fresh pointer

    log.info("AI health summary written (%d chars)", len(narrative))
    return 1


# ── Post-import sync ──────────────────────────────────────────────────────────

_import_cycle_count = 0  # tracks how many imports have completed (metrics/logging only)

def trigger_post_import(devices_changed: int = 0):
    """After a successful brain import, trigger both /api/copilot/sync (KB
    files) and /api/copilot/sync-vault (vault notes) — always, unconditionally.
    Both run in background threads so they never block the import loop.

    devices_changed is kept only for logging context, not as a gate. It used
    to gate whether sync-vault ran at all ("if no device topology/healthcheck
    signature changed, skip it") — but write_inventory_notes/write_eoleos_notes/
    write_backup_notes/write_automation_notes/write_changes_notes etc. have no
    signature of their own and are never reflected in devices_changed. A
    backup completing or EOL/EOS compliance updating with no simultaneous
    device topology change would silently never get embedded into Qdrant,
    sometimes indefinitely, until an unrelated topology change happened to
    also trigger a sync. sync_vault_notes() already does its own efficient
    per-file content-hash skip (see calculate_sha256's volatile-timestamp
    handling in vector_sync.py) — so always calling it is cheap when nothing
    changed and correct when something did, matching how KB sync already
    always runs regardless of devices_changed.
    """
    global _import_cycle_count
    _import_cycle_count += 1

    import threading

    def _kb_sync():
        try:
            r = requests.post(f"{COPILOT_API}/api/copilot/sync", timeout=(10, 300))
            data = r.json()
            if data.get("status") == "skipped":
                log.info("KB sync skipped (already in progress)")
            else:
                log.info("KB sync complete: %s chunks", data.get("synced_chunks", "?"))
        except Exception as e:
            log.warning("KB sync failed: %s", e)

    def _vault_sync():
        try:
            r = requests.post(f"{COPILOT_API}/api/copilot/sync-vault", timeout=(10, 1800))
            data = r.json()
            if data.get("status") == "skipped":
                log.info("Vault sync skipped (already in progress)")
            else:
                log.info("Vault sync complete: %s chunks", data.get("synced_chunks", "?"))
        except Exception as e:
            log.warning("Vault sync failed: %s", e)

    threading.Thread(target=_kb_sync, daemon=True).start()
    log.info("KB sync triggered in background (cycle %d)", _import_cycle_count)

    threading.Thread(target=_vault_sync, daemon=True).start()
    log.info("Vault sync triggered in background (cycle %d, %d device(s) changed)", _import_cycle_count, devices_changed)


# ── Per-device change detection ───────────────────────────────────────────────
# Cumulative imports: only rewrite a device's notes when its actual data
# (status, neighbors, healthcheck KPIs) differs from last run — not on every
# cycle regardless of change. Persisted so it survives across trigger events.

_DEVICE_SIG_PATH = VAULT / ".brain_device_signatures.json"

def _load_device_signatures() -> dict:
    try:
        if _DEVICE_SIG_PATH.exists():
            return json.loads(_DEVICE_SIG_PATH.read_text(encoding="utf-8"))
    except Exception as e:
        log.warning("Failed to load device signature cache: %s", e)
    return {}

def _save_device_signatures(sigs: dict):
    try:
        _DEVICE_SIG_PATH.write_text(json.dumps(sigs), encoding="utf-8")
    except Exception as e:
        log.warning("Failed to save device signature cache: %s", e)

def _compute_device_signature(node: dict, edges: list, hc: Optional[dict]) -> str:
    raw_id = node["id"]
    neighbor_sig = sorted(
        f"{e.get('source')}|{e.get('target')}|{e.get('protocol')}|{e.get('status','ok')}"
        for e in edges
        if e.get("source") == raw_id or e.get("target") == raw_id
    )
    hc_sig = json.dumps(hc.get("analysis") or {}, sort_keys=True) if hc else None
    payload = json.dumps({
        "status": node.get("status"),
        "ip": node.get("ip"),
        "device_type": node.get("device_type"),
        "groups": node.get("groups"),
        "local_as": node.get("local_as"),
        "neighbors": neighbor_sig,
        "hc": hc_sig,
        "hc_time": node.get("hc_time"),
    }, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# ── Main import cycle ─────────────────────────────────────────────────────────

def run_import():
    log.info("── NETAct Brain import starting ──")
    _t0 = time.time()

    topo = fetch_topology()
    if not topo:
        log.error("Cannot reach topology API — skipping cycle.")
        BRAIN_API_ERRORS.labels(api="topology").inc()
        return

    nodes = topo.get("nodes", [])
    edges = topo.get("edges", [])
    log.info("Topology: %d nodes, %d edges", len(nodes), len(edges))

    # Load device registry first — needed for IP→hostname resolution and Inventory notes
    device_registry = load_device_registry()
    ip_map = build_ip_hostname_map(device_registry)
    if ip_map:
        log.info("IP→hostname map: %d entries", len(ip_map))

    # Build a set of IPs belonging to bgp_cloud nodes (external BGP upstreams).
    bgp_peer_ips = {
        n["ip"] for n in nodes
        if n.get("node_type") == "bgp_cloud" and n.get("ip")
    }

    real_nodes = [
        n for n in nodes
        if not n.get("node_type")
        and n.get("id") not in bgp_peer_ips
        and "bgp_upstream" not in (n.get("groups") or [])
    ]
    log.info("Real nodes after BGP filter: %d (excluded %d BGP peer IPs)",
             len(real_nodes), len(bgp_peer_ips))

    BRAIN_DEVICES_TOTAL.set(len(real_nodes))

    # Fetch all healthchecks and collect into dict for aggregate writers
    hc_by_device: dict = {}
    written = 0
    up_count = 0
    down_count = 0
    device_signatures = _load_device_signatures()
    new_signatures: dict = {}
    for node in real_nodes:
        hc = fetch_healthcheck(node["id"]) if node.get("hc_file") else None
        if hc:
            hc_by_device[node["id"]] = hc

        sig = _compute_device_signature(node, edges, hc)
        new_signatures[node["id"]] = sig
        if device_signatures.get(node["id"]) != sig:
            write_device_note(node, edges, hc, ip_map)
            write_healthcheck_note(node, hc, ip_map)
            written += 1

        status = (node.get("status") or "").lower()
        if status == "up":
            up_count += 1
        elif status in ("down", "unreachable"):
            down_count += 1
    log.info("Wrote %d/%d device + healthcheck notes (%d unchanged, skipped)",
              written, len(real_nodes), len(real_nodes) - written)
    BRAIN_NOTES_WRITTEN.labels(note_type="device").inc(written)
    BRAIN_DEVICES_UP.set(up_count)
    BRAIN_DEVICES_DOWN.set(down_count)
    _save_device_signatures(new_signatures)

    def _resolve(nid):
        return ip_map.get(nid, nid) if re.match(r'^\d{1,3}(\.\d{1,3}){3}$', nid) else nid

    valid_device_slugs = {safe_slug(_resolve(n["id"])) for n in real_nodes}
    prune_stale_notes(DEVICES_DIR, valid_device_slugs, "device", allow_empty=True)
    prune_stale_notes(HEALTHCHECK_DIR, valid_device_slugs, "healthcheck", allow_empty=True)

    write_topology_notes(nodes, edges)
    log.info("Wrote topology link notes")
    BRAIN_NOTES_WRITTEN.labels(note_type="topology").inc()

    # Topology link filenames are built from the raw (unresolved) node id —
    # match that here rather than reusing valid_device_slugs.
    valid_topology_slugs = {safe_slug(n["id"]) for n in real_nodes}
    prune_stale_notes(TOPOLOGY_DIR, valid_topology_slugs, "topology", prefix="Links-", allow_empty=True)

    write_site_notes(nodes)
    log.info("Wrote site notes")
    BRAIN_NOTES_WRITTEN.labels(note_type="site").inc()

    valid_sites = {safe_slug(g) for n in nodes for g in (n.get("groups") or []) if g and g != "default"}
    prune_stale_notes(SITES_DIR, valid_sites, "site", allow_empty=True)

    # Inventory
    eoleos_compliance = fetch_eoleos_compliance()
    count = write_inventory_notes(device_registry, eoleos_compliance)
    log.info("Wrote %d inventory notes", count)
    BRAIN_NOTES_WRITTEN.labels(note_type="inventory").inc(count)

    valid_inventory = {safe_slug(d["hostname"]) for d in device_registry if d.get("hostname")}
    prune_stale_notes(INVENTORY_DIR, valid_inventory, "inventory")

    # EOL / EOS Compliance (separate from Inventory — own folder, own note)
    count = write_eoleos_notes(device_registry, eoleos_compliance)
    log.info("Wrote %d EOL/EOS notes", count)
    BRAIN_NOTES_WRITTEN.labels(note_type="eol").inc(count)

    prune_stale_notes(EOL_DIR, valid_inventory, "eol")

    # Backups
    backups_summary = fetch_backups_summary()
    count = write_backup_notes(backups_summary)
    log.info("Wrote %d backup notes", count)
    BRAIN_NOTES_WRITTEN.labels(note_type="backup").inc(count)

    valid_backups = {safe_slug(h) for h in backups_summary.keys()}
    prune_stale_notes(BACKUPS_DIR, valid_backups, "backup")

    # Automation
    flows, executions = fetch_automation_data()
    count = write_automation_notes(flows, executions)
    log.info("Wrote %d automation notes", count)
    BRAIN_NOTES_WRITTEN.labels(note_type="automation").inc(count)

    # Vendors
    count = write_vendor_notes(real_nodes, ip_map)
    log.info("Wrote %d vendor notes", count)
    BRAIN_NOTES_WRITTEN.labels(note_type="vendor").inc(count)

    # Matches write_vendor_notes' own node filter exactly (node_type check
    # only — a slightly broader set than real_nodes) so pruning can't
    # false-positive on a vendor that's only present via a node real_nodes
    # itself excludes.
    vendor_dev_nodes = [n for n in nodes if not n.get("node_type")]
    valid_vendors = {safe_slug(v.capitalize()) for v in {n.get("vendor", "unknown").lower() for n in vendor_dev_nodes}}
    prune_stale_notes(VENDORS_DIR, valid_vendors, "vendor", allow_empty=True)

    # Protocols
    count = write_protocol_notes(nodes, edges, ip_map)
    log.info("Wrote %d protocol notes", count)
    BRAIN_NOTES_WRITTEN.labels(note_type="protocol").inc(count)

    # BGP peers (resolves the [[AS<num>@<device>]] links written into device notes)
    count = write_bgp_peer_notes(nodes)
    log.info("Wrote %d BGP peer notes", count)
    BRAIN_NOTES_WRITTEN.labels(note_type="bgp_peer").inc(count)

    valid_bgp_peers = {safe_slug(n.get("id", "")) for n in nodes if n.get("node_type") == "bgp_cloud" and n.get("id")}
    prune_stale_notes(BGP_PEERS_DIR, valid_bgp_peers, "bgp_peer", allow_empty=True)

    # Monitoring
    count = write_monitoring_notes(real_nodes, hc_by_device, ip_map)
    log.info("Wrote %d monitoring domain notes", count)
    BRAIN_NOTES_WRITTEN.labels(note_type="monitoring").inc(count)

    # Changes
    count = write_changes_notes(backups_summary)
    log.info("Wrote %d config change notes", count)
    BRAIN_NOTES_WRITTEN.labels(note_type="changes").inc(count)

    prune_stale_notes(CHANGES_DIR, valid_backups, "changes")

    # Logs
    count = write_log_notes(real_nodes, hc_by_device, ip_map)
    log.info("Wrote %d log notes", count)
    BRAIN_NOTES_WRITTEN.labels(note_type="logs").inc(count)

    prune_stale_notes(LOGS_DIR, valid_device_slugs, "logs", allow_empty=True)

    # AI summary — gated on written > 0 (real device topology/healthcheck
    # change this cycle), not run unconditionally on every trigger. This is
    # an actual Ollama LLM call (llama3.2), and Brain's OLLAMA_HOST and the
    # copilot's OLLAMA_HOST both resolve through the same exporter to the
    # same single Ollama instance, which serializes all requests (CPU-only,
    # no true concurrency — see the OLLAMA_NUM_THREAD comment in
    # docker-compose.ai.yml). Firing this on every trivial trigger (a map
    # coordinate edit, a BGP registry metadata change, an ISP ping target
    # save — none of which affect device health) was directly competing
    # with, and able to block, live copilot chat inference for no reason:
    # none of those triggers change anything the summary would report
    # differently anyway.
    if written > 0:
        count = write_ai_notes(nodes, edges, hc_by_device, ip_map)
        log.info("Wrote %d AI health summary notes", count)
        BRAIN_NOTES_WRITTEN.labels(note_type="ai").inc(count)
        if count > 0:
            BRAIN_AI_SUMMARIES.inc(count)
    else:
        log.info("AI health summary skipped — no device topology/healthcheck change this cycle")

    duration = time.time() - _t0
    BRAIN_IMPORT_TOTAL.inc()
    BRAIN_IMPORT_DURATION.observe(duration)
    BRAIN_LAST_IMPORT.set(time.time())
    log.info("── Import complete ──")

    # Push vault changes into Qdrant KB automatically
    trigger_post_import(devices_changed=written)


import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from prometheus_client import generate_latest, CONTENT_TYPE_LATEST

import_lock = threading.Lock()
trigger_event = threading.Event()

def import_trigger_loop():
    """Loops indefinitely, running an import only when triggered via the HTTP
    event API — no periodic timer. Every real device-data change (healthcheck,
    backup, device edit, etc.) calls POST /api/brain/import directly."""
    log.info("Pure event-driven mode: waiting for trigger events via HTTP API (no periodic timer).")
    # Run one bootstrap import immediately on startup so the vault isn't empty
    # while waiting for the first real event.
    try:
        with import_lock:
            run_import()
    except Exception as e:
        log.error("Bootstrap import failed: %s", e, exc_info=True)

    while True:
        log.info("Waiting for trigger event (no timeout)...")
        trigger_event.wait()  # blocks indefinitely until POST /api/brain/import sets it
        trigger_event.clear()
        log.info("Trigger received, starting import cycle.")
        try:
            with import_lock:
                run_import()
        except Exception as e:
            log.error("Import failed: %s", e, exc_info=True)

class BrainHTTPHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path in ("/metrics", "/"):
            try:
                body = generate_latest(REGISTRY)
                self.send_response(200)
                self.send_header("Content-Type", CONTENT_TYPE_LATEST)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(f"Error: {e}".encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == "/api/brain/import":
            if import_lock.locked():
                # Still queue it — don't drop the signal. run_import() always
                # fetches current state, so a re-run right after the in-flight
                # one finishes picks up this change too instead of waiting for
                # the next unrelated trigger or the fallback timer.
                trigger_event.set()
                self.send_response(409)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"status": "queued", "reason": "import already in progress, will run again next"}')
            else:
                trigger_event.set()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"status": "triggered"}')
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        # Silence metrics polling requests to keep stdout clean
        if "/metrics" not in self.path:
            log.info("HTTP API Request: %s" % (format % args))

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--loop", action="store_true")
    args = parser.parse_args()

    if args.loop:
        # Start combined HTTP server (metrics + webhook api)
        try:
            http_srv = HTTPServer(("0.0.0.0", METRICS_PORT), BrainHTTPHandler)
            threading.Thread(target=http_srv.serve_forever, daemon=True).start()
            log.info("HTTP Server (metrics + webhook trigger) serving on :%d", METRICS_PORT)
        except Exception as e:
            log.warning("Could not start HTTP server on :%d — %s", METRICS_PORT, e)

        # Run the import loop (blocks main thread)
        import_trigger_loop()
    else:
        run_import()
