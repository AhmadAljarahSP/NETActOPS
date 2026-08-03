"""
NETAct Topology Service
Parses healthcheck outputs from NETAct_git for OSPF / LLDP neighbors
and returns topology + device map coordinates.
"""

import os
import re
import json
import logging
from pathlib import Path
from typing import Optional
import yaml
import glob
from fastapi import FastAPI, HTTPException, Header, Depends, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from concurrent.futures import ThreadPoolExecutor

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
    force=True,
)
logger = logging.getLogger("topology")

def notify_brain_import():
    try:
        import urllib.request, urllib.error
        req = urllib.request.Request("http://NETAct_brain:9092/api/brain/import", method="POST", data=b"")
        urllib.request.urlopen(req, timeout=3.0).close()
    except urllib.error.HTTPError as e:
        if e.code == 409:
            # Brain is mid-import; it already queued this trigger to run again
            # right after (see BrainHTTPHandler.do_POST) — expected, not a failure.
            logger.debug("Brain import busy, trigger queued (409)")
        else:
            logger.error("Failed to notify brain importer: HTTP %s", e.code)
    except Exception as e:
        logger.error("Failed to notify brain importer: %s", e)

# ---------------------------------------------------------------------------
# BGP AS Registry — well-known upstream providers (AS number → name + main flag)
# Overridden at runtime by bgp_as_registry.json in the git repo.
# ---------------------------------------------------------------------------
DEFAULT_BGP_REGISTRY = {
    "174":   {"name": "Cogent Communications", "main": True},
    "701":   {"name": "Verizon Business", "main": False},
    "1239":  {"name": "Sprint", "main": False},
    "1273":  {"name": "Vodafone", "main": False},
    "1299":  {"name": "Telia", "main": True},
    "2914":  {"name": "NTT", "main": True},
    "3257":  {"name": "GTT", "main": False},
    "3320":  {"name": "Deutsche Telekom", "main": False},
    "3356":  {"name": "Lumen/CenturyLink", "main": True},
    "4134":  {"name": "China Telecom", "main": False},
    "5089":  {"name": "Virgin Media", "main": False},
    "6453":  {"name": "TATA Communications", "main": True},
    "6461":  {"name": "Zayo", "main": False},
    "6762":  {"name": "Telecom Italia Sparkle", "main": False},
    "6939":  {"name": "Hurricane Electric", "main": False},
    "7018":  {"name": "AT&T", "main": False},
    "8075":  {"name": "Microsoft Azure", "main": True},
    "8220":  {"name": "COLT", "main": False},
    "8781":  {"name": "Zain/STC", "main": False},
    "12956": {"name": "Telefonica Global", "main": False},
    "13335": {"name": "Cloudflare", "main": True},
    "15133": {"name": "Edgecast/Verizon Media", "main": False},
    "15169": {"name": "Google", "main": True},
    "16509": {"name": "Amazon AWS", "main": True},
    "20940": {"name": "Akamai", "main": False},
    "24940": {"name": "Hetzner", "main": False},
    "2856":  {"name": "BT", "main": True},
    "32934": {"name": "Meta/Facebook", "main": True},
    "36351": {"name": "SoftLayer/IBM Cloud", "main": False},
}

# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
APP_PASSWORD = os.getenv("APP_PASSWORD", "")

async def verify_api_key(request: Request, x_api_key: str = Header(None)):
    if request.url.path == "/health":
        return
    if APP_PASSWORD and x_api_key != APP_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid API Key")

app = FastAPI(
    title="NETAct Topology Service",
    version="1.0",
    dependencies=[Depends(verify_api_key)],
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Paths & Encryption
# ---------------------------------------------------------------------------
GIT_REPO_PATH = os.getenv("GIT_REPO_PATH", "/git/repo")
HEALTHCHECKS_PATH = os.path.join(GIT_REPO_PATH, "healthchecks")
COORDS_FILE = os.path.join(os.path.dirname(__file__), "data", "device_coords.json")
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY", "")

# ---------------------------------------------------------------------------
# Coordinate store — loaded from JSON, editable via API
# ---------------------------------------------------------------------------
def load_coords() -> dict:
    if os.path.exists(COORDS_FILE):
        try:
            with open(COORDS_FILE) as f:
                return json.load(f)
        except Exception as e:
            logger.warning("Failed to load coords file: %s", e)
    return {}

def save_coords(coords: dict):
    os.makedirs(os.path.dirname(COORDS_FILE), exist_ok=True)
    with open(COORDS_FILE, "w") as f:
        json.dump(coords, f, indent=2)

# ---------------------------------------------------------------------------
# Decrypt healthchecks helper
# ---------------------------------------------------------------------------
def read_healthcheck_content(hc_file: Path) -> str:
    """Reads healthcheck file, automatically decrypting it if encrypted."""
    meta_file = hc_file.with_suffix(".meta.json")
    is_encrypted = False
    if meta_file.exists():
        try:
            with open(meta_file, encoding="utf-8") as f:
                metadata = json.load(f)
                is_encrypted = metadata.get("encrypted", False)
        except Exception as e:
            logger.debug("Failed to read metadata for %s: %s", hc_file, e)

    if is_encrypted:
        if not ENCRYPTION_KEY:
            logger.warning("File %s is encrypted, but ENCRYPTION_KEY environment variable is not set!", hc_file)
            return "[Error: Healthcheck file is encrypted but ENCRYPTION_KEY is missing on topology service]"
        try:
            from cryptography.fernet import Fernet
            fernet = Fernet(ENCRYPTION_KEY.encode())
            raw_bytes = hc_file.read_bytes()
            return fernet.decrypt(raw_bytes).decode("utf-8", errors="replace")
        except Exception as e:
            logger.error("Failed to decrypt healthcheck %s: %s", hc_file, e)
            return f"[Error decrypting healthcheck: {str(e)}]"
    else:
        try:
            return hc_file.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            logger.error("Failed to read healthcheck %s: %s", hc_file, e)
            raise e

# ---------------------------------------------------------------------------
# OSPF neighbor parsers
# ---------------------------------------------------------------------------
def parse_ospf_cisco(text: str) -> list[dict]:
    """Parse 'show ip ospf neighbor' for Cisco IOS / IOS-XE."""
    neighbors = []
    for line in text.splitlines():
        line_strip = line.strip()
        if not line_strip or "Neighbor ID" in line_strip or "State" in line_strip:
            continue
        parts = line_strip.split()
        if len(parts) >= 6:
            nbr_id = parts[0]
            if re.match(r'^\d+\.\d+\.\d+\.\d+$', nbr_id):
                neighbors.append({
                    "neighbor_id": nbr_id,
                    "local_interface": parts[-1],
                    "neighbor_ip": parts[-2],
                    "state": parts[2],
                    "protocol": "ospf",
                })
    return neighbors


def parse_ospf_xr(text: str) -> list[dict]:
    """Parse 'show ospf neighbor' for Cisco XR."""
    neighbors = []
    for line in text.splitlines():
        line_strip = line.strip()
        if not line_strip or "Neighbor ID" in line_strip or "State" in line_strip:
            continue
        parts = line_strip.split()
        if len(parts) >= 6:
            nbr_id = parts[0]
            if re.match(r'^\d+\.\d+\.\d+\.\d+$', nbr_id):
                state = parts[2]
                if len(parts) >= 7 and parts[3] == '-':
                    state = parts[2] + " " + parts[3]
                neighbors.append({
                    "neighbor_id": nbr_id,
                    "local_interface": parts[-1],
                    "neighbor_ip": parts[-2],
                    "state": state,
                    "protocol": "ospf",
                })
    return neighbors


def parse_ospf_juniper(text: str) -> list[dict]:
    """Parse 'show ospf neighbor' for Juniper JunOS."""
    neighbors = []
    for line in text.splitlines():
        line_strip = line.strip()
        if not line_strip or "Address" in line_strip or "Interface" in line_strip:
            continue
        parts = line_strip.split()
        if len(parts) >= 5:
            nbr_ip = parts[0]
            nbr_id = parts[3]
            if re.match(r'^\d+\.\d+\.\d+\.\d+$', nbr_ip) and re.match(r'^\d+\.\d+\.\d+\.\d+$', nbr_id):
                neighbors.append({
                    "neighbor_id": nbr_id,
                    "local_interface": parts[1],
                    "neighbor_ip": nbr_ip,
                    "state": parts[2],
                    "protocol": "ospf",
                })
    return neighbors


def parse_ospf_huawei(text: str) -> list[dict]:
    """Parse 'display ospf peer' and 'display ospf peer brief' for Huawei VRP."""
    neighbors = []
    
    # 1. Parse brief table format if present
    if "Area Id" in text and "Neighbor id" in text:
        in_table = False
        for line in text.splitlines():
            line_strip = line.strip()
            if not line_strip:
                continue
            if "Area Id" in line and "Neighbor id" in line:
                in_table = True
                continue
            if in_table:
                if line_strip.startswith("---") or line_strip.startswith("==="):
                    continue
                parts = line_strip.split()
                if len(parts) >= 4:
                    area_id = parts[0]
                    nbr_id = parts[2]
                    local_intf = parts[1]
                    if re.match(r'^\d+\.\d+\.\d+\.\d+$', nbr_id):
                        neighbors.append({
                            "neighbor_id": nbr_id,
                            "local_interface": local_intf,
                            "neighbor_ip": nbr_id,
                            "state": parts[3] if len(parts) > 3 else "Full",
                            "protocol": "ospf",
                        })

    # 2. Parse detailed format if present
    rid_pat = re.compile(r'Router\s*ID\s*:\s*(\d+\.\d+\.\d+\.\d+)', re.IGNORECASE)
    addr_pat = re.compile(r'Address\s*:\s*(\d+\.\d+\.\d+\.\d+)', re.IGNORECASE)
    intf_pat = re.compile(r'Area\s+\S+\s+interface\s+(\S+)(?:\s*\((\S+)\))?', re.IGNORECASE)
    state_pat = re.compile(r'State\s*:\s*(\S+)', re.IGNORECASE)
    current_intf = None
    current_state = "Full"
    current_rid = None
    for line in text.splitlines():
        mi = intf_pat.search(line)
        if mi:
            current_intf = mi.group(2) if mi.group(2) else mi.group(1)
        ms = state_pat.search(line)
        if ms:
            current_state = ms.group(1)
        mr = rid_pat.search(line)
        if mr:
            current_rid = mr.group(1)
        ma = addr_pat.search(line)
        if ma and current_intf and current_rid:
            neighbors.append({
                "neighbor_id": current_rid,
                "local_interface": current_intf,
                "neighbor_ip": ma.group(1),
                "state": current_state,
                "protocol": "ospf",
            })
    return neighbors


def parse_lldp_cisco(text: str) -> list[dict]:
    """Parse 'show lldp neighbors detail' for Cisco."""
    neighbors = []
    blocks = re.split(r'(?=Device ID:)', text)
    for block in blocks:
        device_id_m = re.search(r'Device ID:\s*(\S+)', block)
        intf_m = re.search(r'Local Intf:\s*(\S+)', block)
        port_m = re.search(r'Port id:\s*(\S+)', block)
        mgmt_m = re.search(r'Management Addresses.*?(\d+\.\d+\.\d+\.\d+)', block, re.DOTALL)
        if device_id_m and intf_m:
            neighbors.append({
                "neighbor_id": device_id_m.group(1),
                "local_interface": intf_m.group(1),
                "remote_port": port_m.group(1) if port_m else "",
                "neighbor_ip": mgmt_m.group(1) if mgmt_m else "",
                "protocol": "lldp",
            })
    return neighbors


def parse_lldp_huawei(text: str) -> list[dict]:
    """Parse 'display lldp neighbor brief' for Huawei."""
    neighbors = []
    in_table = False
    for line in text.splitlines():
        line_strip = line.strip()
        if not line_strip:
            continue
        if "Local Interface" in line or "LOCAL-INTF" in line:
            in_table = True
            continue
        if in_table:
            if line_strip.startswith("---") or line_strip.startswith("==="):
                continue
            parts = line_strip.split()
            if len(parts) >= 3:
                local_intf = parts[0]
                if not parts[1].isdigit():
                    continue
                if len(parts) == 4:
                    neighbor_id = parts[3]
                    remote_port = parts[2]
                elif len(parts) == 3:
                    neighbor_id = parts[2]
                    remote_port = parts[2]
                elif len(parts) >= 5:
                    neighbor_id = parts[-1]
                    remote_port = parts[-2]
                else:
                    continue
                neighbors.append({
                    "neighbor_id": neighbor_id,
                    "local_interface": local_intf,
                    "remote_port": remote_port,
                    "neighbor_ip": "",
                    "protocol": "lldp",
                })
    return neighbors


def parse_lldp_nxos(text: str) -> list[dict]:
    """Parse 'show lldp neighbors' for NX-OS."""
    neighbors = []
    pat = re.compile(r'(\S+)\s+(\S+)\s+\d+\s+\S+\s+(\S+)')
    header_passed = False
    for line in text.splitlines():
        if re.match(r'Device ID', line, re.IGNORECASE):
            header_passed = True
            continue
        if header_passed:
            m = pat.match(line.strip())
            if m:
                neighbors.append({
                    "neighbor_id": m.group(1),
                    "local_interface": m.group(3),
                    "remote_port": m.group(2),
                    "neighbor_ip": "",
                    "protocol": "lldp",
                })
    return neighbors


def parse_lldp_juniper(text: str) -> list[dict]:
    """Parse 'show lldp neighbors' for Juniper JunOS."""
    neighbors = []
    lines = text.splitlines()
    header_index = -1
    for i, line in enumerate(lines):
        if "Local Interface" in line and "Chassis Id" in line:
            header_index = i
            break
            
    if header_index != -1:
        for line in lines[header_index+1:]:
            parts = line.strip().split()
            if len(parts) >= 5:
                local_intf = parts[0]
                chassis_id = parts[2]
                port_info = parts[3]
                system_name = parts[4]
                neighbors.append({
                    "neighbor_id": system_name,
                    "local_interface": local_intf,
                    "remote_port": port_info,
                    "neighbor_ip": chassis_id if re.match(r'^\d+\.\d+\.\d+\.\d+$', chassis_id) else "",
                    "protocol": "lldp",
                })
    return neighbors


def parse_bgp_cisco(text: str) -> tuple[Optional[int], list[dict]]:
    """Parse 'show ip bgp summary' or 'show bgp summary' for Cisco."""
    local_as = None
    neighbors = []
    as_match = re.search(r'local AS number\s+(\d+)', text, re.IGNORECASE)
    if not as_match:
        as_match = re.search(r'local AS\s+(\d+)', text, re.IGNORECASE)
    if as_match:
        local_as = int(as_match.group(1))
    in_table = False
    for line in text.splitlines():
        line_strip = line.strip()
        if not line_strip:
            continue
        # IOS/IOS-XE: "State/PfxRcd"   IOS-XR: "St/PfxRcd"
        if "Neighbor" in line_strip and "PfxRcd" in line_strip:
            in_table = True
            continue
        if in_table:
            parts = line_strip.split()
            if len(parts) >= 9:
                peer_ip = parts[0]
                if re.match(r'^\d+\.\d+\.\d+\.\d+$', peer_ip):
                    # IOS column order:  Neighbor V    AS ...
                    # XR column order:   Neighbor Spk  AS ...
                    # Both have AS at index 2
                    remote_as = parts[2]
                    # State/PfxRcd is the last token; "Idle (Admin)" spans two tokens
                    last_tok = parts[-1]
                    is_established = last_tok.isdigit()
                    state_str = "Established" if is_established else last_tok
                    # Skip administratively shut-down sessions ("Idle (Admin)")
                    if state_str == "(Admin)":
                        continue
                    neighbors.append({
                        "neighbor_ip": peer_ip,
                        "neighbor_id": peer_ip,
                        "remote_as": int(remote_as) if remote_as.isdigit() else None,
                        "state": state_str,
                        "established": is_established,
                        "protocol": "bgp",
                    })
    return local_as, neighbors


def parse_bgp_juniper(text: str) -> tuple[Optional[int], list[dict]]:
    """Parse 'show bgp summary' for Juniper."""
    local_as = None
    neighbors = []
    as_match = re.search(r'Local AS:\s*(\d+)', text, re.IGNORECASE)
    if not as_match:
        as_match = re.search(r'local AS\s+(\d+)', text, re.IGNORECASE)
    if as_match:
        local_as = int(as_match.group(1))
    in_table = False
    for line in text.splitlines():
        line_strip = line.strip()
        if not line_strip:
            continue
        if "Peer" in line_strip and "AS" in line_strip and "State|#Active" in line_strip:
            in_table = True
            continue
        if in_table:
            parts = line_strip.split()
            if len(parts) >= 8:
                peer_ip = parts[0]
                peer_ip_clean = peer_ip.split('+')[0]
                if re.match(r'^\d+\.\d+\.\d+\.\d+$', peer_ip_clean):
                    remote_as = parts[1]
                    state = parts[-1]
                    is_established = "Establ" in state
                    neighbors.append({
                        "neighbor_ip": peer_ip_clean,
                        "neighbor_id": peer_ip_clean,
                        "remote_as": int(remote_as) if remote_as.isdigit() else None,
                        "state": "Established" if is_established else state,
                        "established": is_established,
                        "protocol": "bgp",
                    })
    return local_as, neighbors


def parse_bgp_huawei(text: str) -> tuple[Optional[int], list[dict]]:
    """Parse 'display bgp peer' for Huawei VRP."""
    local_as = None
    neighbors = []
    as_match = re.search(r'BGP local AS number\s*:\s*(\d+)', text, re.IGNORECASE)
    if not as_match:
        as_match = re.search(r'local AS\s+(\d+)', text, re.IGNORECASE)
    if as_match:
        local_as = int(as_match.group(1))
    in_table = False
    for line in text.splitlines():
        line_strip = line.strip()
        if not line_strip:
            continue
        if "Peer" in line_strip and "AS" in line_strip and "State" in line_strip:
            in_table = True
            continue
        if in_table:
            parts = line_strip.split()
            if len(parts) >= 8:
                peer_ip = parts[0]
                if re.match(r'^\d+\.\d+\.\d+\.\d+$', peer_ip):
                    remote_as = parts[2]
                    state = parts[7]
                    is_established = state.lower() == "established"
                    neighbors.append({
                        "neighbor_ip": peer_ip,
                        "neighbor_id": peer_ip,
                        "remote_as": int(remote_as) if remote_as.isdigit() else None,
                        "state": "Established" if is_established else state,
                        "established": is_established,
                        "protocol": "bgp",
                    })
    return local_as, neighbors


def parse_ospf_interfaces(text: str) -> dict[str, str]:
    """Parse 'show ospf interface brief' to {interface: state}."""
    states = {}
    for line in text.splitlines():
        line_strip = line.strip()
        if not line_strip:
            continue
        if "interface" in line_strip.lower() or "state" in line_strip.lower() or "limit" in line_strip.lower() or line_strip.startswith("---") or line_strip.startswith("===") or line_strip.startswith("*") or line_strip.startswith("{"):
            continue
        parts = line_strip.split()
        if len(parts) >= 2:
            intf = parts[0]
            state = "up"
            if any(p.lower() == "down" for p in parts):
                state = "down"
            states[intf] = state
    return states


def match_interface(intf1: str, intf2: str) -> bool:
    """Helper to match interface names like xe-0/1/0.0 and xe-0/1/0."""
    def clean(s):
        s = s.lower().strip()
        s = s.split('.')[0]
        s = s.replace("bundle-ether", "be")
        s = s.replace("tengige", "te")
        s = s.replace("gigabitethernet", "ge")
        s = s.replace("fastethernet", "fa")
        s = s.replace("ethernet", "et")
        s = s.replace("hundredgige", "hu")
        s = re.sub(r'[^a-z0-9/]', '', s)
        return s
    return clean(intf1) == clean(intf2)


# ---------------------------------------------------------------------------
# OSPF LSDB parsers (IOS-XR)
# ---------------------------------------------------------------------------

def parse_ospf_lsdb_xr(text: str) -> list[dict]:
    """
    Parse 'show ospf database router' (IOS-XR).
    Returns list of {adv_router, neighbor_id, local_addr, cost, area}.
    """
    links = []
    adv_router = None
    area = "0"
    in_p2p = False
    neighbor_id = None
    local_addr = None
    cost = None

    area_re    = re.compile(r'Router Link States \(Area\s+([\d.]+)\)', re.I)
    adv_re     = re.compile(r'Advertising Router:\s+([\d.]+)')
    p2p_re     = re.compile(r'Link connected to:\s+another Router', re.I)
    nbr_re     = re.compile(r'\(Link ID\)\s+Neighboring Router ID:\s+([\d.]+)')
    ldata_re   = re.compile(r'\(Link Data\)\s+Router Interface address:\s+([\d.]+)')
    metric_re  = re.compile(r'TOS\s+0\s+Metrics?:\s+(\d+)')

    def _flush():
        nonlocal in_p2p, neighbor_id, local_addr, cost
        if adv_router and neighbor_id:
            links.append({
                "adv_router":   adv_router,
                "neighbor_id":  neighbor_id,
                "local_addr":   local_addr or "",
                "cost":         int(cost) if cost else 1,
                "area":         area,
            })
        in_p2p = False
        neighbor_id = None
        local_addr = None
        cost = None

    for line in text.splitlines():
        m = area_re.search(line)
        if m:
            area = m.group(1)
            continue
        m = adv_re.search(line)
        if m:
            _flush()
            adv_router = m.group(1)
            continue
        if p2p_re.search(line):
            _flush()
            in_p2p = True
            continue
        if in_p2p:
            m = nbr_re.search(line)
            if m:
                neighbor_id = m.group(1)
                continue
            m = ldata_re.search(line)
            if m:
                local_addr = m.group(1)
                continue
            m = metric_re.search(line)
            if m:
                cost = m.group(1)
                # flush this link when we get the metric
                _flush()

    return links


def parse_te_topology_xr(text: str) -> list[dict]:
    """
    Parse 'show mpls traffic-eng topology' (IOS-XR).
    Returns list of {source, neighbor, te_metric, max_bw_kbps, avail_bw_kbps, link_ip}.
    """
    te_links = []
    current_node = None
    current_nbr  = None
    te_metric    = None
    max_bw       = None
    avail_bw     = None
    link_ip      = None

    node_re    = re.compile(r'^Node\s+([\d.]+)', re.M)
    link_re    = re.compile(r'Link\[\d+\]:\s+Nbr\s+([\d.]+)')
    maxbw_re   = re.compile(r'max reservable bw:\s+([\d]+)\s+\(kbps\)')
    avbw_re    = re.compile(r'bw in use by tunnels:\s+([\d]+)\s+\(kbps\)')
    temet_re   = re.compile(r'te_metric:\s*(\d+)')
    linkip_re  = re.compile(r'Link IP addresses?:\s+([\d.]+)')

    def _flush_link():
        nonlocal current_nbr, te_metric, max_bw, avail_bw, link_ip
        if current_node and current_nbr:
            avail = (int(max_bw) - int(avail_bw)) if (max_bw and avail_bw) else None
            te_links.append({
                "source":       current_node,
                "neighbor":     current_nbr,
                "te_metric":    int(te_metric) if te_metric else None,
                "max_bw_kbps":  int(max_bw)   if max_bw   else None,
                "avail_bw_kbps": avail,
                "link_ip":      link_ip or "",
            })
        current_nbr = None
        te_metric = None
        max_bw = None
        avail_bw = None
        link_ip = None

    for line in text.splitlines():
        m = node_re.match(line.strip())
        if m:
            _flush_link()
            current_node = m.group(1)
            continue
        m = link_re.search(line)
        if m:
            _flush_link()
            current_nbr = m.group(1)
            continue
        m = temet_re.search(line)
        if m and current_nbr:
            te_metric = m.group(1)
            continue
        m = maxbw_re.search(line)
        if m and current_nbr and max_bw is None:
            max_bw = m.group(1)
            continue
        m = avbw_re.search(line)
        if m and current_nbr:
            avail_bw = m.group(1)
            continue
        m = linkip_re.search(line)
        if m and current_nbr:
            link_ip = m.group(1)
            continue

    _flush_link()
    return te_links


def parse_te_tunnels_xr(text: str) -> list[dict]:
    """
    Parse 'show mpls traffic-eng tunnels detail' (IOS-XR).
    Returns list of {name, tunnel_id, source, dest, bw_kbps, admin, oper, hops}.
    hops = list of router IPs from Record Route (actual signalled path).

    IOS-XR tunnel header variants:
      Name: tunnel-te1 (Tunnel1) Destination: 1.2.3.4
      Name: tunnel-te100  Destination: 1.2.3.4
      tunnel-te1 (Tunnel1)   Destination: 1.2.3.4
    """
    tunnels = []
    t: dict = {}
    in_rsvp      = False
    in_rroute    = False   # multi-line Record Route accumulation
    in_eroute    = False   # multi-line Explicit Route accumulation

    # Multiple header patterns to cover IOS-XR variations
    name_re1  = re.compile(r'Name:\s+(\S+).*?\((\S+)\)\s+Destination:\s+([\d.]+)', re.I)
    name_re2  = re.compile(r'Name:\s+(\S+)\s+Destination:\s+([\d.]+)', re.I)
    name_re3  = re.compile(r'^(\S*tunnel\S*)\s+\(Tunnel\d+\)\s+Destination:\s+([\d.]+)', re.I)
    status_re = re.compile(r'Admin:\s+(\S+)\s+Oper:\s+(\S+)', re.I)
    bw_re     = re.compile(r'Bandwidth:\s+(\d+)\s+kbps', re.I)
    rsvp_re   = re.compile(r'RSVP Signalling Info', re.I)
    src_re    = re.compile(r'Src\s+([\d.]+),\s*Dst\s+([\d.]+)(?:,\s*Tun_Id\s+(\d+))?', re.I)
    rroute_re = re.compile(r'Record Route:', re.I)
    eroute_re = re.compile(r'Explicit Route:', re.I)
    ip_re     = re.compile(r'([\d]{1,3}\.[\d]{1,3}\.[\d]{1,3}\.[\d]{1,3})')

    def _flush():
        nonlocal t, in_rsvp, in_rroute, in_eroute
        if t.get("name"):
            tunnels.append(t)
        t = {}
        in_rsvp = in_rroute = in_eroute = False

    for line in text.splitlines():
        stripped = line.strip()

        # ── Try each header pattern ──────────────────────────────────────────
        m = name_re1.search(stripped)
        if m:
            _flush()
            t = {"name": m.group(1), "tunnel_id": m.group(2), "dest": m.group(3),
                 "source": None, "bw_kbps": None, "admin": None, "oper": None, "hops": []}
            continue

        m = name_re2.search(stripped)
        if m and not name_re1.search(stripped):
            _flush()
            t = {"name": m.group(1), "tunnel_id": m.group(1), "dest": m.group(2),
                 "source": None, "bw_kbps": None, "admin": None, "oper": None, "hops": []}
            continue

        m = name_re3.match(stripped)
        if m:
            _flush()
            t = {"name": m.group(1), "tunnel_id": m.group(1), "dest": m.group(2),
                 "source": None, "bw_kbps": None, "admin": None, "oper": None, "hops": []}
            continue

        if not t:
            continue

        # ── Admin/Oper status ────────────────────────────────────────────────
        m = status_re.search(line)
        if m and t.get("admin") is None:
            t["admin"] = m.group(1).lower()
            t["oper"]  = m.group(2).lower()
            continue

        # ── Bandwidth ────────────────────────────────────────────────────────
        m = bw_re.search(line)
        if m and t.get("bw_kbps") is None:
            t["bw_kbps"] = int(m.group(1))
            continue

        # ── RSVP section start ───────────────────────────────────────────────
        if rsvp_re.search(line):
            in_rsvp = True
            continue

        # ── Record Route / Explicit Route headers (start accumulation) ───────
        if rroute_re.search(line):
            in_rroute = True; in_eroute = False
            # IPs may be on same line
            hops = ip_re.findall(line.split(':', 1)[-1])
            if hops:
                t["hops"] = hops
            continue

        if eroute_re.search(line) and not t.get("hops"):
            in_eroute = True; in_rroute = False
            hops = ip_re.findall(line.split(':', 1)[-1])
            if hops:
                t["hops"] = hops
            continue

        # ── Accumulate multi-line Record/Explicit route IPs ──────────────────
        if in_rroute or in_eroute:
            # Continue only while the line looks like it contains IPs / route data
            if ip_re.search(line) or re.search(r'\(S\)|\(L\)|[\d.]+', line):
                hops = ip_re.findall(line)
                if hops:
                    t["hops"] = list(dict.fromkeys(t.get("hops", []) + hops))
                continue
            else:
                in_rroute = in_eroute = False   # line has no IPs → route block ended

        # ── Source/Dest from RSVP section ───────────────────────────────────
        if in_rsvp:
            m = src_re.search(line)
            if m:
                t["source"] = m.group(1)
                if not t.get("dest"):
                    t["dest"] = m.group(2)
                if m.group(3):
                    t["tunnel_id"] = m.group(3)
                continue

    _flush()
    return tunnels


def parse_rsvp_sessions_xr(text: str) -> list[dict]:
    """
    Parse 'show rsvp session' (IOS-XR).
    Returns list of {dest, source, tunnel_id, state, output_intf}.
    """
    sessions = []
    ip_re = re.compile(r'^\d+\.\d+\.\d+\.\d+')
    for line in text.splitlines():
        line = line.strip()
        if not line or not ip_re.match(line):
            continue
        parts = line.split()
        if len(parts) >= 7:
            sessions.append({
                "dest":        parts[0],
                "source":      parts[1],
                "tunnel_id":   parts[2],
                "output_intf": parts[5] if len(parts) > 5 else "",
                "state":       parts[6] if len(parts) > 6 else "",
            })
    return sessions


# ---------------------------------------------------------------------------
# Healthcheck output block splitter
# ---------------------------------------------------------------------------

def extract_command_blocks(text: str) -> dict[str, str]:
    """Split a healthcheck file into {command -> output} dict."""
    blocks: dict[str, str] = {}
    current_cmd: Optional[str] = None
    buf: list[str] = []
    separator = re.compile(r'^={3,}')
    cmd_header = re.compile(r'^>>> (.+)$')

    for line in text.splitlines():
        if separator.match(line):
            if current_cmd and buf:
                blocks[current_cmd] = "\n".join(buf)
            if current_cmd:
                buf = []
            continue
        m = cmd_header.match(line)
        if m:
            current_cmd = m.group(1).strip()
            buf = []
        elif current_cmd is not None:
            buf.append(line)

    if current_cmd and buf:
        blocks[current_cmd] = "\n".join(buf)

    return blocks


def parse_neighbors_from_blocks(blocks: dict, vendor: str) -> list[dict]:
    """Try every command block and dispatch to the right parser."""
    vendor = vendor.lower()
    results: list[dict] = []

    for cmd, output in blocks.items():
        cmd_l = cmd.lower()

        if "ospf" in cmd_l and ("neighbor" in cmd_l or "neighbour" in cmd_l or "peer" in cmd_l):
            if vendor in ("huawei", "vrp"):
                results.extend(parse_ospf_huawei(output))
            elif vendor in ("cisco_xr", "xr"):
                results.extend(parse_ospf_xr(output))
            elif vendor in ("juniper", "juniper_junos"):
                results.extend(parse_ospf_juniper(output))
            elif "display" in cmd_l:
                results.extend(parse_ospf_huawei(output))
            else:
                results.extend(parse_ospf_cisco(output))

        elif "lldp" in cmd_l and ("neighbor" in cmd_l or "brief" in cmd_l):
            if vendor in ("huawei", "vrp") or "display" in cmd_l:
                results.extend(parse_lldp_huawei(output))
            elif vendor == "nxos":
                results.extend(parse_lldp_nxos(output))
            elif vendor in ("juniper", "juniper_junos"):
                results.extend(parse_lldp_juniper(output))
            else:
                results.extend(parse_lldp_cisco(output))

    # Deduplicate: same neighbor_id + local_interface + protocol may appear
    # multiple times when a device healthcheck contains both brief and detailed
    # OSPF/LLDP commands (e.g. "display ospf peer brief" + "display ospf peer").
    # Keep the first occurrence (brief tables tend to come first and are cleaner).
    seen: set = set()
    deduped: list[dict] = []
    for n in results:
        key = (
            n.get("neighbor_id", "").lower(),
            n.get("local_interface", "").lower(),
            n.get("protocol", ""),
        )
        if key not in seen:
            seen.add(key)
            deduped.append(n)

    return deduped


# ---------------------------------------------------------------------------
# Scan healthchecks directory
# ---------------------------------------------------------------------------

def get_all_healthcheck_files() -> list[Path]:
    p = Path(HEALTHCHECKS_PATH)
    if not p.exists():
        return []
    return sorted(p.rglob("*.txt"))


def latest_healthcheck_per_device() -> dict[str, Path]:
    """Return {device_name -> latest healthcheck file}."""
    device_latest: dict[str, Path] = {}
    for f in get_all_healthcheck_files():
        # File names: <device>_<timestamp>.txt  or  <device>/<timestamp>.txt
        device_name = f.parent.name if f.parent.name != "healthchecks" else f.stem.rsplit("_", 2)[0]
        if device_name not in device_latest or f.stat().st_mtime > device_latest[device_name].stat().st_mtime:
            device_latest[device_name] = f
    return device_latest


def infer_vendor_from_path(path: Path) -> str:
    """Guess vendor from folder path or file content header."""
    name = str(path).lower()
    if "huawei" in name:
        return "huawei"
    if "xr" in name or "cisco_xr" in name:
        return "cisco_xr"
    if "nxos" in name or "nexus" in name:
        return "nxos"
    return "cisco"


def load_device_groups() -> tuple[dict[str, list[str]], list[str]]:
    """
    Parse /app/devices/*.yaml and map device hostnames to their group names (represented by the YAML file name stem).
    Returns:
        - device_to_groups: dict {hostname: [group_names]}
        - all_groups: list of all active group names
    """
    device_to_groups = {}
    all_groups_set = set()
    devices_dir = Path("/app/devices")
    
    if not devices_dir.exists():
        logger.warning("Devices configuration directory /app/devices does not exist.")
        return {}, []

    for yaml_file in sorted(devices_dir.glob("*.yaml")):
        try:
            with open(yaml_file, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
            if not data or "devices" not in data:
                continue
                
            group = yaml_file.stem  # Use the yaml file name stem as the group!
            
            for dev in data["devices"]:
                hostname = dev.get("hostname") or dev.get("ip") or dev.get("ip_address")
                if hostname:
                    if hostname not in device_to_groups:
                        device_to_groups[hostname] = []
                    
                    if group not in device_to_groups[hostname]:
                        device_to_groups[hostname].append(group)
                    all_groups_set.add(group)
        except Exception as e:
            logger.error("Error reading device config file %s: %s", yaml_file, e)
            continue
            
    return device_to_groups, sorted(list(all_groups_set))


def load_device_coords_from_yaml() -> dict:
    """
    Parse /app/devices/*.yaml and extract device lat/lng coordinates.
    """
    device_coords = {}
    devices_dir = Path("/app/devices")
    if not devices_dir.exists():
        # local backup path check
        devices_dir = Path(os.path.join(os.path.dirname(__file__), "..", "..", "backend", "devices"))
        if not devices_dir.exists():
            return {}

    for yaml_file in sorted(devices_dir.glob("*.yaml")):
        try:
            with open(yaml_file, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
            if not data or "devices" not in data:
                continue
            for dev in data["devices"]:
                hostname = dev.get("hostname") or dev.get("ip") or dev.get("ip_address")
                if hostname:
                    lat = dev.get("latitude") or dev.get("lat")
                    lng = dev.get("longitude") or dev.get("lng")
                    details = {}
                    if lat is not None:
                        try: details["latitude"] = float(lat)
                        except (TypeError, ValueError): pass
                    if lng is not None:
                        try: details["longitude"] = float(lng)
                        except (TypeError, ValueError): pass
                    if details:
                        device_coords[hostname] = details
        except Exception as e:
            logger.error("Error parsing device YAML for coordinates: %s", e)
    return device_coords


def load_device_inventory() -> dict:
    """
    Parse /app/devices/*.yaml and build a map of {hostname: {"vendor": str, "device_type": str}}.
    """
    inventory = {}
    devices_dir = Path("/app/devices")
    if not devices_dir.exists():
        # local backup path check
        devices_dir = Path(os.path.join(os.path.dirname(__file__), "..", "..", "backend", "devices"))
        if not devices_dir.exists():
            return {}

    for yaml_file in sorted(devices_dir.glob("*.yaml")):
        try:
            with open(yaml_file, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
            if not data:
                continue
            groups = data.get("groups") or {}
            dev_list = data.get("devices") or []
            for dev in dev_list:
                hostname = dev.get("hostname") or dev.get("ip") or dev.get("ip_address")
                if hostname:
                    group_name = dev.get("group")
                    group_data = groups.get(group_name, {}) if group_name else {}
                    vendor = dev.get("vendor") or group_data.get("vendor") or "cisco"
                    device_type = dev.get("device_type") or dev.get("type") or group_data.get("device_type") or "router"
                    inventory[hostname] = {
                        "vendor": str(vendor).strip().lower(),
                        "device_type": str(device_type).strip().lower()
                    }
        except Exception as e:
            logger.error("Error reading device config file in inventory parser: %s", e)
    return inventory


# In-memory parsed healthcheck data cache
# Key: (str(file_path), mtime)
# Value: dict
PARSED_CACHE = {}

def get_parsed_healthcheck(hc_file: Path) -> dict:
    try:
        mtime = hc_file.stat().st_mtime
    except Exception:
        mtime = 0
    cache_key = (str(hc_file), mtime)
    if cache_key in PARSED_CACHE:
        return PARSED_CACHE[cache_key]

    try:
        text = read_healthcheck_content(hc_file)
    except Exception as e:
        logger.warning("Cannot read/decrypt %s: %s", hc_file, e)
        return None

    # Extract device IP from file header
    ip_match = re.search(r'=== IP:\s*(\S+)\s*===', text)
    device_ip = ip_match.group(1) if ip_match else ""

    # Extract OSPF Router ID
    rid_match = re.search(r'Router\s*ID\s*(\d+\.\d+\.\d+\.\d+)', text, re.IGNORECASE)
    router_id = rid_match.group(1) if rid_match else ""

    # Status
    status = "ok"
    if "[ERROR]" in text or "[TIMEOUT]" in text:
        status = "error"
    elif "[AUTH FAIL]" in text:
        status = "auth_fail"

    # True vendor lookup
    device_name = hc_file.parent.name if hc_file.parent.name != "healthchecks" else hc_file.stem.rsplit("_", 2)[0]
    device_inventory = load_device_inventory()
    inv = device_inventory.get(device_name, {})
    vendor = inv.get("vendor", "").strip().lower()
    if not vendor:
        vendor = infer_vendor_from_path(hc_file)

    blocks = extract_command_blocks(text)
    neighbors = parse_neighbors_from_blocks(blocks, vendor)
    
    # Parse BGP neighbors and local AS
    local_as = None
    bgp_neighbors = []
    for cmd, output in blocks.items():
        cmd_l = cmd.lower()
        if "bgp" in cmd_l and ("summary" in cmd_l or "peer" in cmd_l):
            if vendor in ("huawei", "vrp") or "display" in cmd_l:
                las, peers = parse_bgp_huawei(output)
            elif vendor in ("juniper", "juniper_junos"):
                las, peers = parse_bgp_juniper(output)
            else:
                las, peers = parse_bgp_cisco(output)
            if las:
                local_as = las
            bgp_neighbors.extend(peers)

    # Parse OSPF interface states
    ospf_interfaces = {}
    for cmd, output in blocks.items():
        if "ospf" in cmd.lower() and "interface" in cmd.lower() and "brief" in cmd.lower():
            ospf_interfaces = parse_ospf_interfaces(output)
            break

    # Parse OSPF LSDB (Router LSAs) → adjacency with metrics
    lsdb_links: list[dict] = []
    for cmd, output in blocks.items():
        cmd_l = cmd.lower()
        if "ospf" in cmd_l and "database" in cmd_l and "router" in cmd_l:
            lsdb_links = parse_ospf_lsdb_xr(output)
            break

    # Parse TE topology (link bandwidth / TE metric)
    te_links: list[dict] = []
    for cmd, output in blocks.items():
        cmd_l = cmd.lower()
        if "traffic-eng" in cmd_l and "topology" in cmd_l:
            te_links = parse_te_topology_xr(output)
            break

    # Parse TE tunnels (active paths)
    te_tunnels: list[dict] = []
    for cmd, output in blocks.items():
        cmd_l = cmd.lower()
        if "traffic-eng" in cmd_l and "tunnel" in cmd_l:
            te_tunnels = parse_te_tunnels_xr(output)
            break

    # Parse RSVP sessions
    rsvp_sessions: list[dict] = []
    for cmd, output in blocks.items():
        cmd_l = cmd.lower()
        if "rsvp" in cmd_l and "session" in cmd_l:
            rsvp_sessions = parse_rsvp_sessions_xr(output)
            break

    # KPI analysis
    analysis = analyze_healthcheck(text)

    res = {
        "ip": device_ip,
        "router_id": router_id,
        "local_as": local_as,
        "status": status,
        "neighbors": neighbors + bgp_neighbors,
        "ospf_interfaces": ospf_interfaces,
        "lsdb_links": lsdb_links,
        "te_links": te_links,
        "te_tunnels": te_tunnels,
        "rsvp_sessions": rsvp_sessions,
        "analysis": analysis,
        "raw_preview": text[:2000],
        "timestamp": mtime
    }
    PARSED_CACHE[cache_key] = res
    return res


def pair_links(A: str, B: str, A_to_B: list[dict], B_to_A: list[dict]) -> list[dict]:
    paired = []
    used_B = set()

    # Step 1: Match LLDP links by exact interface name swap
    for idx_A, a in enumerate(A_to_B):
        if a.get("protocol") == "lldp":
            match_idx = None
            for idx_B, b in enumerate(B_to_A):
                if idx_B in used_B:
                    continue
                if b.get("protocol") == "lldp":
                    if match_interface(a.get("local_interface", ""), b.get("remote_port", "")) and match_interface(a.get("remote_port", ""), b.get("local_interface", "")):
                        match_idx = idx_B
                        break
            if match_idx is not None:
                used_B.add(match_idx)
                b = B_to_A[match_idx]
                paired.append({
                    "source": A,
                    "target": B,
                    "local_interface": a.get("local_interface", ""),
                    "remote_port": b.get("local_interface", ""),
                    "protocol": "lldp",
                    "protocols": {"lldp"},
                    "ospf_states": {},
                    "status": "ok",
                    "source_interface": a.get("local_interface", ""),
                    "target_interface": b.get("local_interface", ""),
                })
            else:
                paired.append({
                    "source": A,
                    "target": B,
                    "local_interface": a.get("local_interface", ""),
                    "remote_port": a.get("remote_port", ""),
                    "protocol": "lldp",
                    "protocols": {"lldp"},
                    "ospf_states": {},
                    "status": "ok",
                    "source_interface": a.get("local_interface", ""),
                    "target_interface": a.get("remote_port", ""),
                })

    # Step 2: Match OSPF links to existing LLDP links if possible
    unmatched_ospf_A = []
    for a in A_to_B:
        if a.get("protocol") == "ospf":
            matched = False
            for link in paired:
                if "lldp" in link["protocols"] and match_interface(link["source_interface"], a.get("local_interface", "")):
                    link["protocols"].add("ospf")
                    if "state" in a:
                        link["ospf_states"][A] = a["state"]
                    matched = True
                    break
            if not matched:
                unmatched_ospf_A.append(a)

    unmatched_ospf_B = []
    for idx_B, b in enumerate(B_to_A):
        if b.get("protocol") == "ospf":
            if idx_B in used_B:
                for link in paired:
                    if "lldp" in link["protocols"] and match_interface(link["target_interface"], b.get("local_interface", "")):
                        link["protocols"].add("ospf")
                        if "state" in b:
                            link["ospf_states"][B] = b["state"]
                        break
            else:
                matched = False
                for link in paired:
                    if "lldp" in link["protocols"] and match_interface(link["target_interface"], b.get("local_interface", "")):
                        link["protocols"].add("ospf")
                        if "state" in b:
                            link["ospf_states"][B] = b["state"]
                        matched = True
                        used_B.add(idx_B)
                        break
                if not matched:
                    unmatched_ospf_B.append((idx_B, b))

    # Step 3: Pair remaining unmatched OSPF links
    unmatched_ospf_A.sort(key=lambda x: x.get("local_interface", ""))
    unmatched_ospf_B.sort(key=lambda x: x[1].get("local_interface", ""))

    len_A = len(unmatched_ospf_A)
    len_B = len(unmatched_ospf_B)
    for i in range(max(len_A, len_B)):
        a = unmatched_ospf_A[i] if i < len_A else None
        b_idx, b = unmatched_ospf_B[i] if i < len_B else (None, None)

        if a and b:
            used_B.add(b_idx)
            ospf_states = {}
            if "state" in a: ospf_states[A] = a["state"]
            if "state" in b: ospf_states[B] = b["state"]
            paired.append({
                "source": A,
                "target": B,
                "local_interface": a.get("local_interface", ""),
                "remote_port": b.get("local_interface", ""),
                "protocol": "ospf",
                "protocols": {"ospf"},
                "ospf_states": ospf_states,
                "status": "ok",
                "source_interface": a.get("local_interface", ""),
                "target_interface": b.get("local_interface", ""),
            })
        elif a:
            ospf_states = {}
            if "state" in a: ospf_states[A] = a["state"]
            paired.append({
                "source": A,
                "target": B,
                "local_interface": a.get("local_interface", ""),
                "remote_port": "",
                "protocol": "ospf",
                "protocols": {"ospf"},
                "ospf_states": ospf_states,
                "status": "ok",
                "source_interface": a.get("local_interface", ""),
                "target_interface": "",
            })
        elif b:
            used_B.add(b_idx)
            ospf_states = {}
            if "state" in b: ospf_states[B] = b["state"]
            paired.append({
                "source": B,
                "target": A,
                "local_interface": b.get("local_interface", ""),
                "remote_port": "",
                "protocol": "ospf",
                "protocols": {"ospf"},
                "ospf_states": ospf_states,
                "status": "ok",
                "source_interface": b.get("local_interface", ""),
                "target_interface": "",
            })

    # Step 3.5: Pair BGP links
    bgp_A = [a for a in A_to_B if a.get("protocol") == "bgp"]
    bgp_B = [b for b in B_to_A if b.get("protocol") == "bgp"]
    
    used_bgp_B = set()
    for a in bgp_A:
        matched_b = None
        for idx_b, b in enumerate(bgp_B):
            if idx_b in used_bgp_B:
                continue
            matched_b = b
            used_bgp_B.add(idx_b)
            break
            
        if matched_b:
            status = "ok"
            if a.get("state") != "Established" or matched_b.get("state") != "Established":
                status = "down"
            paired.append({
                "source": A,
                "target": B,
                "local_interface": f"BGP (AS {a.get('remote_as')})" if a.get('remote_as') else "BGP",
                "remote_port": f"BGP (AS {matched_b.get('remote_as')})" if matched_b.get('remote_as') else "BGP",
                "protocol": "bgp",
                "protocols": {"bgp"},
                "ospf_states": {},
                "status": status,
                "source_interface": "",
                "target_interface": "",
                "remote_as": a.get("remote_as"),
                "local_as": matched_b.get("remote_as"),
            })
        else:
            status = "ok" if a.get("state") == "Established" else "down"
            paired.append({
                "source": A,
                "target": B,
                "local_interface": f"BGP (AS {a.get('remote_as')})" if a.get('remote_as') else "BGP",
                "remote_port": "",
                "protocol": "bgp",
                "protocols": {"bgp"},
                "ospf_states": {},
                "status": status,
                "source_interface": "",
                "target_interface": "",
                "remote_as": a.get("remote_as"),
            })
            
    for idx_b, b in enumerate(bgp_B):
        if idx_b not in used_bgp_B:
            status = "ok" if b.get("state") == "Established" else "down"
            paired.append({
                "source": B,
                "target": A,
                "local_interface": f"BGP (AS {b.get('remote_as')})" if b.get('remote_as') else "BGP",
                "remote_port": "",
                "protocol": "bgp",
                "protocols": {"bgp"},
                "ospf_states": {},
                "status": status,
                "source_interface": "",
                "target_interface": "",
                "remote_as": b.get("remote_as"),
            })

    # Step 4: Add any other unrecognized protocols from A_to_B or B_to_A
    for a in A_to_B:
        if a.get("protocol") not in ("lldp", "ospf", "bgp"):
            paired.append({
                "source": A,
                "target": B,
                "local_interface": a.get("local_interface", ""),
                "remote_port": a.get("remote_port", ""),
                "protocol": a.get("protocol", "unknown"),
                "protocols": {a.get("protocol", "unknown")},
                "ospf_states": {},
                "status": "ok",
                "source_interface": a.get("local_interface", ""),
                "target_interface": a.get("remote_port", ""),
            })

    return paired


def build_topology(time_range: Optional[str] = "latest", start_time: Optional[float] = None, end_time: Optional[float] = None) -> dict:
    """
    Main topology builder.
    Returns nodes (devices) + edges (neighbor links).
    """
    coords = load_coords()
    yaml_coords = load_device_coords_from_yaml()
    device_inventory = load_device_inventory()
    device_files = latest_healthcheck_per_device()
    device_to_groups, all_groups = load_device_groups()

    nodes: dict[str, dict] = {}
    edges: list[dict] = []

    # Load OSPF ping timestamp from modification time of targets file
    targets_file = os.path.join(GIT_REPO_PATH, "isp_ping_targets.json")
    ospf_ping_timestamp = None
    if os.path.exists(targets_file):
        try:
            ospf_ping_timestamp = os.path.getmtime(targets_file)
        except Exception as e:
            logger.warning("Failed to get targets timestamp: %s", e)

    default_thresholds = {
        "latency_warning": 150.0,
        "latency_critical": 250.0,
        "loss_warning": 10.0,
        "loss_critical": 50.0
    }

    # Pass 0: Pre-populate all devices from YAML inventory to nodes
    for device_name, inv in device_inventory.items():
        saved_c = coords.get(device_name, {})
        is_unplaced = saved_c.get("unplaced", False)
        yaml_c = {} if is_unplaced else yaml_coords.get(device_name, {})
        
        nodes[device_name] = {
            "id": device_name,
            "label": device_name,
            "ip": "",
            "status": "unknown",
            "groups": device_to_groups.get(device_name, ["default"]),
            "vendor": inv.get("vendor", "cisco"),
            "device_type": inv.get("device_type", "router"),
            "x": None if is_unplaced else saved_c.get("x", None),
            "y": None if is_unplaced else saved_c.get("y", None),
            "latitude": None if is_unplaced else (saved_c.get("latitude") or yaml_c.get("latitude", None)),
            "longitude": None if is_unplaced else (saved_c.get("longitude") or yaml_c.get("longitude", None)),
            "hc_file": None,
            "hc_time": None,
            "local_as": None,
        }

    # Process all files in parallel (using cache + thread pool)
    parsed_results = {}
    with ThreadPoolExecutor(max_workers=16) as executor:
        future_to_device = {executor.submit(get_parsed_healthcheck, hc_file): name for name, hc_file in device_files.items()}
        for future in future_to_device:
            name = future_to_device[future]
            try:
                res = future.result()
                if res:
                    parsed_results[name] = res
            except Exception as e:
                logger.error("Failed to parse device %s in thread pool: %s", name, e)

    # Pass 1: Build IP lookup translation map and update active nodes with healthcheck details
    ip_to_name = {}
    for device_name, res in parsed_results.items():
        if res["ip"]:
            ip_to_name[res["ip"]] = device_name
        if res["router_id"]:
            ip_to_name[res["router_id"]] = device_name

        saved_c = coords.get(device_name, {})
        is_unplaced = saved_c.get("unplaced", False)
        yaml_c = {} if is_unplaced else yaml_coords.get(device_name, {})
        inv = device_inventory.get(device_name, {})
        hc_file = device_files[device_name]

        nodes[device_name] = {
            "id": device_name,
            "label": device_name,
            "ip": res["ip"],
            "status": res["status"],
            "groups": device_to_groups.get(device_name, ["default"]),
            "vendor": inv.get("vendor", "cisco") if inv else "cisco",
            "device_type": inv.get("device_type", "router") if inv else "router",
            "x": None if is_unplaced else saved_c.get("x", None),
            "y": None if is_unplaced else saved_c.get("y", None),
            "latitude": None if is_unplaced else (saved_c.get("latitude") or yaml_c.get("latitude", None)),
            "longitude": None if is_unplaced else (saved_c.get("longitude") or yaml_c.get("longitude", None)),
            "hc_file": str(hc_file),
            "hc_time": res["timestamp"],
            "local_as": res.get("local_as"),
        }

    # Pass 1.5: Build interface IP to device name mapping using OSPF neighbor Router IDs
    for device_name, res in parsed_results.items():
        for nbr in res.get("neighbors", []):
            if nbr.get("protocol") == "ospf":
                nbr_id = nbr.get("neighbor_id")
                nbr_ip = nbr.get("neighbor_ip")
                if nbr_id and nbr_ip:
                    resolved_device = ip_to_name.get(nbr_id)
                    if resolved_device:
                        ip_to_name[nbr_ip] = resolved_device

    # Pass 2: Group unidirectional links by device pair and execute pairing
    from collections import defaultdict
    node_pair_links = defaultdict(lambda: {"A_to_B": [], "B_to_A": []})

    for device_name, res in parsed_results.items():
        for nbr in res["neighbors"]:
            # BGP peers are handled exclusively in Pass 4+5 as bgp_cloud nodes.
            # Skip them here so we don't create raw IP nodes that pollute the
            # topology GUI and Graphify graph with external BGP peer addresses.
            if nbr.get("protocol") == "bgp":
                continue

            raw_target_id = nbr["neighbor_id"]
            target_key = ip_to_name.get(raw_target_id, raw_target_id)

            if target_key not in nodes:
                saved_c = coords.get(target_key, {})
                is_unplaced = saved_c.get("unplaced", False)
                yaml_c = {} if is_unplaced else yaml_coords.get(target_key, {})
                inv = device_inventory.get(target_key, {})

                nodes[target_key] = {
                    "id": target_key,
                    "label": target_key,
                    "ip": nbr.get("neighbor_ip", ""),
                    "status": "unknown",
                    "groups": device_to_groups.get(target_key, ["default"]),
                    "vendor": inv.get("vendor", "cisco"),
                    "device_type": inv.get("device_type", "router"),
                    "x": None if is_unplaced else saved_c.get("x", None),
                    "y": None if is_unplaced else saved_c.get("y", None),
                    "latitude": None if is_unplaced else (saved_c.get("latitude") or yaml_c.get("latitude", None)),
                    "longitude": None if is_unplaced else (saved_c.get("longitude") or yaml_c.get("longitude", None)),
                    "hc_file": None,
                    "hc_time": None,
                    "local_as": None,
                }

            if device_name == target_key:
                continue

            if device_name < target_key:
                node_pair_links[frozenset([device_name, target_key])]["A_to_B"].append(nbr)
            else:
                node_pair_links[frozenset([device_name, target_key])]["B_to_A"].append(nbr)

    # Compute final physical edges and determine statuses
    for pair, direction_dict in node_pair_links.items():
        pair_list = sorted(list(pair))
        A = pair_list[0]
        B = pair_list[1] if len(pair_list) > 1 else pair_list[0]

        A_to_B = direction_dict["A_to_B"]
        B_to_A = direction_dict["B_to_A"]

        paired_for_pair = pair_links(A, B, A_to_B, B_to_A)
        for edge in paired_for_pair:
            # Protocol assignment
            if "ospf" in edge["protocols"]:
                edge["protocol"] = "ospf"
            elif "lldp" in edge["protocols"]:
                edge["protocol"] = "lldp"
            elif "bgp" in edge["protocols"]:
                edge["protocol"] = "bgp"

            # Check OSPF neighbor states
            for dev, o_state in edge["ospf_states"].items():
                if "down" in o_state.lower():
                    edge["status"] = "down"

            # Check OSPF interface states
            for dev_role, dev_id in [("source", edge["source"]), ("target", edge["target"])]:
                dev_hc = parsed_results.get(dev_id, {})
                dev_ospf_intfs = dev_hc.get("ospf_interfaces", {})
                intf_name = edge["local_interface"] if dev_role == "source" else edge["remote_port"]
                if intf_name:
                    for ospf_intf, ospf_state in dev_ospf_intfs.items():
                        if match_interface(intf_name, ospf_intf) and ospf_state == "down":
                            edge["status"] = "down"

            # OSPF ping metrics are disabled
            edge["ping_metrics"] = None

            # Clean temporary fields
            edge.pop("protocols", None)
            edge.pop("ospf_states", None)
            edge.pop("source_interface", None)
            edge.pop("target_interface", None)
            edges.append(edge)

    # Pass 3: Process manual targets from isp_ping_targets.json
    targets_file = os.path.join(GIT_REPO_PATH, "isp_ping_targets.json")
    if os.path.exists(targets_file):
        try:
            with open(targets_file, "r", encoding="utf-8") as f:
                manual_targets_list = json.load(f)
                for t in manual_targets_list:
                    src = t.get("source")
                    target_ip = t.get("target_ip")
                    if not src or not target_ip:
                        continue
                    # Ensure source exists in nodes
                    if src not in nodes:
                        continue
                    
                    # 1. Resolve actual target destination node ID
                    dest_router = t.get("destination_router")
                    actual_dest = dest_router or ip_to_name.get(target_ip)
                    
                    if actual_dest and actual_dest in nodes:
                        target_node_id = actual_dest
                    else:
                        target_node_id = target_ip
                        # Ensure virtual target node exists
                        if target_ip not in nodes:
                            nodes[target_ip] = {
                                "id": target_ip,
                                "label": target_ip,
                                "ip": target_ip,
                                "status": "unknown",
                                "groups": ["manual_ping"],
                                "vendor": "generic",
                                "device_type": "internet",
                                "node_type": "isp_target",   # geo-only: never shown in 3D/force
                                "x": None,
                                "y": None,
                                "latitude": None,
                                "longitude": None,
                                "hc_file": None,
                                "hc_time": None,
                            }
                    
                    # 2. Get metrics directly from target t
                    success_rate = t.get("success_rate", 100.0)
                    rtt_min = t.get("rtt_min", 0.0)
                    rtt_avg = t.get("rtt_avg", 0.0)
                    rtt_max = t.get("rtt_max", 0.0)
                    
                    status = "up"
                    if success_rate == 0.0 or rtt_avg >= 250.0:
                        status = "down"
                    elif success_rate < 100.0 or rtt_avg >= 150.0:
                        status = "warning"
                        
                    metrics_dict = {
                        "success_rate": round(success_rate, 1),
                        "rtt_min": round(rtt_min, 1),
                        "rtt_avg": round(rtt_avg, 1),
                        "rtt_max": round(rtt_max, 1),
                        "status": status,
                        "custom_thresholds": {
                            "latency_warning": 150.0,
                            "latency_critical": 250.0,
                            "loss_warning": 10.0,
                            "loss_critical": 50.0
                        },
                        "default_thresholds": default_thresholds,
                        "pinged_ips": {
                            "a_ip": None,
                            "b_ip": target_ip
                        }
                    }
                    
                    if target_node_id == target_ip:
                        nodes[target_ip]["status"] = "ok" if status == "up" else ("warning" if status == "warning" else "error")
                    
                    edges.append({
                        "source": src,
                        "target": target_node_id,
                        "local_interface": "ISP-Link",
                        "remote_port": "Internet" if target_node_id == target_ip else "Port",
                        "protocol": "isp",
                        "status": "ok" if status == "up" else ("warning" if status == "warning" else "down"),
                        "ping_metrics": metrics_dict
                    })
        except Exception as e:
            logger.warning("Failed to inject manual targets into topology: %s", e)

    # Pass 4+5 (combined): Build one BGP cloud node per (router × remote_AS) pair.
    # Each cloud carries its own bgp_status (established | degraded) per that specific
    # router's sessions, so the same AS can appear green from one router and red from another.

    # Load AS registry for company name / "main" enrichment
    _registry: dict = dict(DEFAULT_BGP_REGISTRY)
    _registry_file = os.path.join(GIT_REPO_PATH, "bgp_as_registry.json")
    if os.path.exists(_registry_file):
        try:
            with open(_registry_file) as _f:
                _loaded = json.load(_f)
                _registry.update(_loaded)
        except Exception as _e:
            logger.warning("Failed to load bgp_as_registry.json: %s", _e)

    # Remove any IP-based pseudo-nodes that earlier passes may have created
    _old_cloud_ids = [nid for nid, n in list(nodes.items()) if n.get("node_type") == "bgp_cloud"]
    for _oid in _old_cloud_ids:
        nodes.pop(_oid, None)
    # Drop old BGP edges entirely — we rebuild them below
    edges = [e for e in edges if e.get("protocol") != "bgp"]

    # Collect all eBGP sessions per (device_name, remote_as)
    _router_as_sessions: dict = {}  # (device_name, remote_as) → list[neighbor_dict]
    for _dev_name, _res in parsed_results.items():
        _dev_local_as = _res.get("local_as")
        for _nbr in _res.get("neighbors", []):
            if _nbr.get("protocol") != "bgp":
                continue
            _remote_as = _nbr.get("remote_as")
            if not _remote_as:
                continue
            if _dev_local_as and _remote_as == _dev_local_as:
                continue  # skip iBGP
            _key = (_dev_name, _remote_as)
            _router_as_sessions.setdefault(_key, []).append(_nbr)

    # Create one cloud node + one edge per (device, remote_as) pair
    for (_dev_name, _remote_as), _sessions in _router_as_sessions.items():
        _cloud_id = f"AS{_remote_as}@{_dev_name}"
        _reg = _registry.get(str(_remote_as), {})
        _any_established = any(s.get("established", False) for s in _sessions)
        _bgp_status = "established" if _any_established else "degraded"
        _company = _reg.get("name", "")
        _display_label = _company if _company else f"AS{_remote_as}"

        nodes[_cloud_id] = {
            "id": _cloud_id,
            "label": _display_label,
            "as_label": f"AS{_remote_as}",
            "ip": _sessions[0].get("neighbor_ip", ""),
            "status": "ok" if _any_established else "unknown",
            "groups": ["bgp_upstream"],
            "vendor": "isp",
            "device_type": "cloud",
            "x": None, "y": None,
            "latitude": None, "longitude": None,
            "hc_file": None, "hc_time": None,
            "local_as": None,
            "remote_as": _remote_as,
            "router_id": _dev_name,
            "node_type": "bgp_cloud",
            "bgp_status": _bgp_status,
            "company_name": _company,
            "main": _reg.get("main", False),
            "session_count": len(_sessions),
        }

        edges.append({
            "source": _dev_name,
            "target": _cloud_id,
            "local_interface": f"BGP AS{_remote_as}",
            "remote_port": _display_label,
            "protocol": "bgp",
            "status": "ok" if _any_established else "unknown",
            "ping_metrics": None,
            "remote_as": _remote_as,
            "bgp_status": _bgp_status,
        })

    return {
        "nodes": list(nodes.values()),
        "edges": edges,
        "device_count": len(device_files),
        "healthcheck_count": len(get_all_healthcheck_files()),
        "groups": all_groups,
        "ospf_ping_timestamp": ospf_ping_timestamp,
    }


# ---------------------------------------------------------------------------
# Healthcheck analysis
# ---------------------------------------------------------------------------

def analyze_healthcheck(text: str) -> dict:
    """Analyse a single healthcheck file for KPIs."""
    blocks = extract_command_blocks(text)
    results = {}

    for cmd, output in blocks.items():
        cmd_l = cmd.lower()
        analysis = {"command": cmd, "lines": len(output.splitlines()), "status": "ok", "summary": ""}

        if "error" in output.lower()[:100]:
            analysis["status"] = "error"

        # CPU
        if "cpu" in cmd_l:
            cpu_m = re.search(r'(\d+)%?\s*(CPU|cpu)', output)
            if cpu_m:
                pct = int(cpu_m.group(1))
                analysis["summary"] = f"CPU {pct}%"
                analysis["status"] = "warning" if pct > 70 else ("critical" if pct > 90 else "ok")
                analysis["value"] = pct

        # Memory
        elif "memory" in cmd_l or "mem" in cmd_l:
            mem_m = re.search(r'(\d+)\s*/\s*(\d+)', output)
            if mem_m:
                used, total = int(mem_m.group(1)), int(mem_m.group(2))
                if total > 0:
                    pct = round(used / total * 100, 1)
                    analysis["summary"] = f"Mem {pct}%"
                    analysis["status"] = "warning" if pct > 75 else "ok"
                    analysis["value"] = pct

        # OSPF neighbors
        elif "ospf" in cmd_l and ("neighbor" in cmd_l or "neighbour" in cmd_l):
            nbr_lines = [l for l in output.splitlines() if re.search(r'\d+\.\d+\.\d+\.\d+', l)]
            analysis["summary"] = f"{len(nbr_lines)} OSPF neighbors"
            analysis["value"] = len(nbr_lines)

        # BGP summary
        elif "bgp" in cmd_l and "summary" in cmd_l:
            estab = len(re.findall(r'\bEstablished\b|\bIdle\b', output, re.IGNORECASE))
            analysis["summary"] = f"BGP entries: {estab}"
            analysis["value"] = estab

        # Interface brief
        elif "interface" in cmd_l and ("brief" in cmd_l or "status" in cmd_l):
            if "ospf" in cmd_l:
                up = 0
                down = 0
                for line in output.splitlines():
                    line_strip = line.strip()
                    if not line_strip:
                        continue
                    if "interface" in line_strip.lower() or "state" in line_strip.lower() or "limit" in line_strip.lower() or line_strip.startswith("---") or line_strip.startswith("===") or line_strip.startswith("*") or line_strip.startswith("{"):
                        continue
                    parts = line_strip.split()
                    if len(parts) >= 2:
                        if any(p.lower() == "down" for p in parts):
                            down += 1
                        elif any(p in parts or p.upper() in parts for p in ["P2P", "P2MP", "LOOP", "DR", "BDR", "DRother", "PtToPt", "Loopback", "Waiting", "LOOPBACK"]):
                            up += 1
            else:
                down = len(re.findall(r'\bdown\b', output, re.IGNORECASE))
                up = len(re.findall(r'\bup\b', output, re.IGNORECASE))
            analysis["summary"] = f"{up} up / {down} down interfaces"
            analysis["value"] = {"up": up, "down": down}
            if down > 0:
                analysis["status"] = "warning"

        results[cmd] = analysis

    return results


# ---------------------------------------------------------------------------
# REST API
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/topology")
def get_topology(time_range: Optional[str] = "latest", start_time: Optional[float] = None, end_time: Optional[float] = None):
    """Full topology: nodes + edges from latest healthchecks."""
    return build_topology(time_range=time_range, start_time=start_time, end_time=end_time)


# ---------------------------------------------------------------------------
# Coordinates CRUD  /coords
# ---------------------------------------------------------------------------

class CoordPayload(BaseModel):
    device: str
    x: Optional[float] = None
    y: Optional[float] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None

@app.get("/coords")
def get_coords():
    """Return all saved device coordinates as an array of {device, latitude, longitude, x, y}."""
    raw = load_coords()
    return [{"device": k, **v} for k, v in raw.items()]

@app.post("/coords", dependencies=[Depends(verify_api_key)])
def save_coord(payload: CoordPayload, background_tasks: BackgroundTasks):
    """Save or update coordinates for a single device."""
    coords = load_coords()
    entry = coords.get(payload.device, {})
    if payload.latitude is not None:
        entry["latitude"]  = payload.latitude
        entry["longitude"] = payload.longitude
        entry.pop("x", None)
        entry.pop("y", None)
    elif payload.x is not None:
        entry["x"] = payload.x
        entry["y"] = payload.y
        entry.pop("latitude", None)
        entry.pop("longitude", None)
    coords[payload.device] = entry
    save_coords(coords)
    background_tasks.add_task(notify_brain_import)
    return {"status": "ok", "device": payload.device}

@app.post("/coords/bulk", dependencies=[Depends(verify_api_key)])
def bulk_save_coords(updates: list, background_tasks: BackgroundTasks):
    """Bulk-save coordinates for multiple devices at once."""
    coords = load_coords()
    for item in updates:
        device = item.get("device")
        if not device:
            continue
        entry = coords.get(device, {})
        if item.get("latitude") is not None:
            entry["latitude"]  = item["latitude"]
            entry["longitude"] = item["longitude"]
            entry.pop("x", None)
            entry.pop("y", None)
        elif item.get("x") is not None:
            entry["x"] = item["x"]
            entry["y"] = item["y"]
            entry.pop("latitude", None)
            entry.pop("longitude", None)
        coords[device] = entry
    save_coords(coords)
    background_tasks.add_task(notify_brain_import)
    return {"status": "ok", "updated": len(updates)}

@app.delete("/coords/{device}", dependencies=[Depends(verify_api_key)])
def delete_coord(device: str, background_tasks: BackgroundTasks):
    """Remove saved coordinates for a device (makes it unplaced)."""
    coords = load_coords()
    if device in coords:
        del coords[device]
        save_coords(coords)
        background_tasks.add_task(notify_brain_import)
        return {"status": "ok", "device": device}
    raise HTTPException(status_code=404, detail=f"No coords found for {device}")



@app.get("/healthchecks")
def list_healthchecks():
    """List all healthcheck files, grouped by device."""
    device_files = latest_healthcheck_per_device()
    result = []
    for device, path in device_files.items():
        result.append({
            "device": device,
            "file": str(path),
            "timestamp": path.stat().st_mtime,
            "size_bytes": path.stat().st_size,
        })
    return {"devices": result, "total": len(result)}


@app.get("/healthchecks/{device_name}")
def get_device_healthcheck(device_name: str):
    """Return parsed analysis of the latest healthcheck for a device."""
    device_files = latest_healthcheck_per_device()
    if device_name not in device_files:
        raise HTTPException(status_code=404, detail=f"No healthcheck found for {device_name}")
    hc_file = device_files[device_name]
    res = get_parsed_healthcheck(hc_file)
    if not res:
        raise HTTPException(status_code=500, detail="Failed to read/decrypt healthcheck file")
    return {
        "device": device_name,
        "ip": res["ip"],
        "router_id": res.get("router_id", ""),
        "file": str(hc_file),
        "timestamp": res["timestamp"],
        "analysis": res["analysis"],
        "raw_preview": res["raw_preview"],
    }


@app.get("/healthchecks/{device_name}/neighbors")
def get_device_neighbors(device_name: str):
    """Return OSPF + LLDP neighbors for a device."""
    device_files = latest_healthcheck_per_device()
    if device_name not in device_files:
        raise HTTPException(status_code=404, detail=f"No healthcheck found for {device_name}")
    hc_file = device_files[device_name]
    res = get_parsed_healthcheck(hc_file)
    if not res:
        raise HTTPException(status_code=500, detail="Failed to read/decrypt healthcheck file")
    return {
        "device": device_name,
        "neighbors": res.get("neighbors", []),
        "ospf_interfaces": res.get("ospf_interfaces", {}),
        "lsdb_links": res.get("lsdb_links", []),
        "te_tunnels": res.get("te_tunnels", []),
        "rsvp_sessions": res.get("rsvp_sessions", []),
    }


# ---------------------------------------------------------------------------
# ISP Ping endpoints
# ---------------------------------------------------------------------------

@app.get("/isp-ping/targets")
def get_isp_ping_targets():
    targets_file = os.path.join(GIT_REPO_PATH, "isp_ping_targets.json")
    if os.path.exists(targets_file):
        try:
            with open(targets_file) as f:
                return json.load(f)
        except Exception:
            pass
    return []


class IspPingTargetsPayload(BaseModel):
    targets: list

@app.post("/isp-ping/targets", dependencies=[Depends(verify_api_key)])
def save_isp_ping_targets(payload: IspPingTargetsPayload, background_tasks: BackgroundTasks):
    targets_file = os.path.join(GIT_REPO_PATH, "isp_ping_targets.json")
    try:
        with open(targets_file, "w") as f:
            json.dump(payload.targets, f, indent=2)
        try:
            subprocess.run(["git", "config", "user.name", "backup-system"], cwd=GIT_REPO_PATH, capture_output=True)
            subprocess.run(["git", "config", "user.email", "backup-system@local"], cwd=GIT_REPO_PATH, capture_output=True)
            subprocess.run(["git", "add", "isp_ping_targets.json"], cwd=GIT_REPO_PATH, capture_output=True)
            subprocess.run(["git", "commit", "-m", "Auto-commit ISP ping targets update"], cwd=GIT_REPO_PATH, capture_output=True)
        except Exception as git_err:
            logger.error("Failed to commit targets to Git: %s", git_err)
        background_tasks.add_task(notify_brain_import)
        return {"status": "ok", "count": len(payload.targets)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write targets: {str(e)}")


@app.get("/isp-ping/config")
def get_isp_ping_config():
    config_file = os.path.join(GIT_REPO_PATH, "isp_ping_config.json")
    if os.path.exists(config_file):
        try:
            with open(config_file) as f:
                return json.load(f)
        except Exception:
            pass
    return {"interval_minutes": 60, "trigger_run": False}


class IspPingConfigPayload(BaseModel):
    interval_minutes: int = 60
    trigger_run: bool = False

@app.post("/isp-ping/config")
def post_isp_ping_config(payload: IspPingConfigPayload):
    config_file = os.path.join(GIT_REPO_PATH, "isp_ping_config.json")
    data_out = {
        "interval_minutes": payload.interval_minutes,
        "trigger_run": payload.trigger_run,
    }
    try:
        with open(config_file, "w", encoding="utf-8") as f:
            json.dump(data_out, f, indent=2)
        try:
            subprocess.run(["git", "config", "user.name", "backup-system"], cwd=GIT_REPO_PATH, capture_output=True)
            subprocess.run(["git", "config", "user.email", "backup-system@local"], cwd=GIT_REPO_PATH, capture_output=True)
            subprocess.run(["git", "add", "isp_ping_config.json"], cwd=GIT_REPO_PATH, capture_output=True)
            subprocess.run(["git", "commit", "-m", "Auto-commit ISP ping config update"], cwd=GIT_REPO_PATH, capture_output=True)
        except Exception as git_err:
            logger.error("Failed to commit config to Git: %s", git_err)
        return {"status": "ok", "config": data_out}
    except Exception as e:
        logger.error("Failed to write ISP ping config: %s", e)
        raise HTTPException(status_code=500, detail=f"Failed to write config: {str(e)}")

@app.post("/isp-ping/run")
def run_isp_pings():
    import urllib.request
    try:
        headers = {}
        app_password = os.getenv("APP_PASSWORD")
        if app_password:
            headers["X-API-Key"] = app_password
        req = urllib.request.Request(
            "http://backend:8000/isp-ping/run",
            method="POST",
            headers=headers
        )
        with urllib.request.urlopen(req) as res:
            return json.loads(res.read().decode())
    except Exception as e:
        logger.error("Failed to trigger pings on main backend: %s", e)
        raise HTTPException(status_code=500, detail=f"Failed to trigger pings: {str(e)}")


# ---------------------------------------------------------------------------
# BGP AS Registry CRUD
# ---------------------------------------------------------------------------

@app.get("/bgp-registry")
def get_bgp_registry():
    """Return the BGP AS name/main registry (file-based, falls back to defaults)."""
    registry_file = os.path.join(GIT_REPO_PATH, "bgp_as_registry.json")
    if os.path.exists(registry_file):
        try:
            with open(registry_file) as f:
                saved = json.load(f)
            merged = dict(DEFAULT_BGP_REGISTRY)
            merged.update(saved)
            return merged
        except Exception as e:
            logger.warning("Failed to read bgp_as_registry.json: %s", e)
    return DEFAULT_BGP_REGISTRY


class BgpRegistryPayload(BaseModel):
    registry: dict


@app.post("/bgp-registry", dependencies=[Depends(verify_api_key)])
def save_bgp_registry(payload: BgpRegistryPayload, background_tasks: BackgroundTasks):
    """Persist the BGP AS registry to the git repo and commit."""
    registry_file = os.path.join(GIT_REPO_PATH, "bgp_as_registry.json")
    try:
        with open(registry_file, "w") as f:
            json.dump(payload.registry, f, indent=2, sort_keys=True)
        try:
            subprocess.run(["git", "config", "user.name", "NETAct Topology"], cwd=GIT_REPO_PATH, capture_output=True)
            subprocess.run(["git", "config", "user.email", "netact@local"], cwd=GIT_REPO_PATH, capture_output=True)
            subprocess.run(["git", "add", "bgp_as_registry.json"], cwd=GIT_REPO_PATH, capture_output=True)
            subprocess.run(["git", "commit", "-m", "Update BGP AS registry via topology UI"], cwd=GIT_REPO_PATH, capture_output=True)
        except Exception as git_err:
            logger.warning("Git commit failed (registry saved to disk): %s", git_err)
        background_tasks.add_task(notify_brain_import)
        return {"status": "ok", "count": len(payload.registry)}
    except Exception as e:
        logger.error("Failed to write bgp_as_registry.json: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# OSPF Topology  /ospf-topology
# Aggregates LSDB links from all devices -> full IGP graph
# ---------------------------------------------------------------------------

@app.get("/ospf-topology")
def get_ospf_topology():
    """
    Returns the full OSPF topology derived from Router LSAs collected
    across all devices.  Used by the frontend for SPF path calculation
    and TE overlay visualisation.

    Key design: the LSDB of a single device contains LSAs originated by
    ALL routers in the area — not just that device.  So we must NOT label
    every discovered router ID with the collecting device's name.  Instead
    we do a first pass to build a router_id → device_name mapping from all
    devices we actually manage, and use that to annotate nodes.
    """
    device_files = latest_healthcheck_per_device()

    # ── Pass 1: build router_id → device_name / ip for devices we manage ────
    rid_to_name: dict = {}
    rid_to_ip:   dict = {}
    for dev_name, hc_file in device_files.items():
        parsed = get_parsed_healthcheck(hc_file)
        if not parsed:
            continue
        rid = parsed.get("router_id", "")
        ip  = parsed.get("ip", "")
        if rid:
            rid_to_name[rid] = dev_name
            rid_to_ip[rid]   = ip
        # Also map the management IP itself in case it equals the router_id
        if ip and ip not in rid_to_name:
            rid_to_name[ip] = dev_name
            rid_to_ip[ip]   = ip

    # ── Pass 2: aggregate LSDB links ─────────────────────────────────────────
    nodes: dict = {}
    links: list = []
    te_links: list = []
    te_tunnels: list = []
    seen_pairs: set = set()

    for dev_name, hc_file in device_files.items():
        parsed = get_parsed_healthcheck(hc_file)
        if not parsed:
            continue

        for link in parsed.get("lsdb_links", []):
            adv  = link["adv_router"]
            nbr  = link["neighbor_id"]
            cost = link["cost"]
            area = link.get("area", "0")

            for rid in (adv, nbr):
                if rid and rid not in nodes:
                    # Only assign device_name if this rid belongs to a managed device
                    nodes[rid] = {
                        "router_id":   rid,
                        "device_name": rid_to_name.get(rid, ""),
                        "ip":          rid_to_ip.get(rid, ""),
                    }

            pair = tuple(sorted([adv, nbr]))
            if pair not in seen_pairs and adv and nbr:
                seen_pairs.add(pair)
                links.append({
                    "source":     adv,
                    "target":     nbr,
                    "cost":       cost,
                    "local_addr": link.get("local_addr", ""),
                    "area":       area,
                })

        for tl in parsed.get("te_links", []):
            te_links.append({**tl, "device_name": dev_name})

        for tt in parsed.get("te_tunnels", []):
            te_tunnels.append({**tt, "device_name": dev_name})

    return {
        "nodes":      nodes,
        "links":      links,
        "te_links":   te_links,
        "te_tunnels": te_tunnels,
    }


# ---------------------------------------------------------------------------
# SPF Path  /path?src=X&dst=Y
# ---------------------------------------------------------------------------

@app.get("/path")
def get_spf_path(src: str, dst: str):
    """
    Compute the OSPF shortest path (Dijkstra) from src to dst.
    src/dst are router IDs (e.g. "10.0.0.1").
    """
    import heapq

    topo = get_ospf_topology()
    link_list = topo["links"]

    adj: dict = {}
    for lnk in link_list:
        s, t, c = lnk["source"], lnk["target"], lnk["cost"]
        adj.setdefault(s, []).append((c, t))
        adj.setdefault(t, []).append((c, s))

    if src not in adj:
        raise HTTPException(status_code=404, detail=f"Source router {src} not in LSDB")
    if dst not in adj and dst != src:
        raise HTTPException(status_code=404, detail=f"Destination router {dst} not in LSDB")

    dist  = {src: 0}
    prev  = {}
    heap  = [(0, src)]
    while heap:
        d, u = heapq.heappop(heap)
        if d > dist.get(u, float("inf")):
            continue
        for cost, v in adj.get(u, []):
            nd = d + cost
            if nd < dist.get(v, float("inf")):
                dist[v] = nd
                prev[v] = u
                heapq.heappush(heap, (nd, v))

    if dst not in dist:
        raise HTTPException(status_code=404, detail=f"No OSPF path from {src} to {dst}")

    path = []
    cur = dst
    while cur != src:
        path.append(cur)
        cur = prev[cur]
    path.append(src)
    path.reverse()

    return {
        "path":       path,
        "total_cost": dist[dst],
        "hops":       len(path) - 1,
    }


# ---------------------------------------------------------------------------
# TE Paths  /te-paths
# ---------------------------------------------------------------------------

@app.get("/te-paths")
def get_te_paths():
    """
    Returns MPLS-TE data from two sources:
    1. te_tunnels  — from 'show mpls traffic-eng tunnels detail' (head-end routers only).
                     Includes full Record Route hop list.
    2. rsvp_sessions — from 'show rsvp session' on any router (transit or head-end).
                       Each entry has source (head-end IP), dest (tail-end IP),
                       tunnel_id, state.  Useful when the collected device is a
                       transit node and has no head-end tunnels of its own.
    """
    device_files = latest_healthcheck_per_device()
    te_tunnels: list = []
    rsvp_sessions: list = []
    seen_sessions: set = set()

    for dev_name, hc_file in device_files.items():
        parsed = get_parsed_healthcheck(hc_file)
        if not parsed:
            continue
        for tt in parsed.get("te_tunnels", []):
            te_tunnels.append({**tt, "device_name": dev_name})
        for rs in parsed.get("rsvp_sessions", []):
            key = (rs.get("source", ""), rs.get("dest", ""), rs.get("tunnel_id", ""))
            if key not in seen_sessions:
                seen_sessions.add(key)
                rsvp_sessions.append({
                    **rs,
                    "device_name": dev_name,
                    # Build a minimal 2-hop path (src→dst) for map rendering
                    "hops": [rs.get("source", ""), rs.get("dest", "")] if rs.get("source") else [],
                })

    return {
        "tunnels":       te_tunnels,
        "rsvp_sessions": rsvp_sessions,
    }
