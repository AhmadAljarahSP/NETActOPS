import os
import re
import json
import logging
import glob
from pathlib import Path
from datetime import datetime
import urllib.request

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("graph-sync")

GIT_REPO_PATH = os.getenv("GIT_REPO_PATH", "/git/repo")
HEALTHCHECKS_PATH = os.path.join(GIT_REPO_PATH, "healthchecks")
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY", "")
APP_PASSWORD = os.getenv("APP_PASSWORD", "")

NEO4J_URL = os.getenv("NEO4J_URL", "bolt://NETAct_neo4j:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "supersecretneo4j")

# Decrypt healthchecks helper
def read_healthcheck_content(hc_file: Path) -> str:
    meta_file = hc_file.with_suffix(".meta.json")
    is_encrypted = False
    if meta_file.exists():
        try:
            with open(meta_file, encoding="utf-8") as f:
                metadata = json.load(f)
                is_encrypted = metadata.get("encrypted", False)
        except Exception:
            pass

    if is_encrypted:
        if not ENCRYPTION_KEY:
            logger.warning("File %s is encrypted, but ENCRYPTION_KEY is missing!", hc_file)
            return ""
        try:
            from cryptography.fernet import Fernet
            fernet = Fernet(ENCRYPTION_KEY.encode())
            raw_bytes = hc_file.read_bytes()
            return fernet.decrypt(raw_bytes).decode("utf-8", errors="replace")
        except Exception as e:
            logger.error("Failed to decrypt healthcheck %s: %s", hc_file, e)
            return ""
    else:
        try:
            return hc_file.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            logger.error("Failed to read healthcheck %s: %s", hc_file, e)
            return ""

# Parsers (simplified but robust regex matching table outputs)
def parse_ospf(text: str) -> list[dict]:
    neighbors = []
    # Match standard Cisco/Huawei output patterns
    for line in text.splitlines():
        line = line.strip()
        parts = line.split()
        if len(parts) >= 6:
            nbr_id = parts[0]
            if re.match(r'^\d+\.\d+\.\d+\.\d+$', nbr_id):
                neighbors.append({
                    "neighbor_id": nbr_id,
                    "local_interface": parts[-1],
                    "neighbor_ip": parts[-2],
                    "state": parts[2]
                })
        elif len(parts) == 4:
            nbr_id = parts[2]
            if re.match(r'^\d+\.\d+\.\d+\.\d+$', nbr_id):
                neighbors.append({
                    "neighbor_id": nbr_id,
                    "local_interface": parts[1],
                    "neighbor_ip": "N/A",
                    "state": parts[3]
                })
    return neighbors

def parse_lldp(text: str) -> list[dict]:
    neighbors = []
    in_table = False
    for line in text.splitlines():
        line = line.strip()
        if "Local Interface" in line or "LOCAL-INTF" in line:
            in_table = True
            continue
        if in_table:
            if line.startswith("---") or line.startswith("==="):
                continue
            parts = line.split()
            if len(parts) >= 3:
                # e.g., GE0/0/1    1    GE0/0/2    Huawei-Router-2
                local_intf = parts[0]
                neighbor_device = parts[-1]
                neighbors.append({
                    "local_interface": local_intf,
                    "neighbor_interface": parts[2] if len(parts) >= 4 else "N/A",
                    "neighbor_device": neighbor_device
                })
    return neighbors

def fetch_device_inventory() -> list[dict]:
    url = "http://NETAct_backend:8000/devices"
    headers_dict = {"x-api-key": APP_PASSWORD} if APP_PASSWORD else {}
    try:
        req = urllib.request.Request(url, headers=headers_dict)
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status == 200:
                return json.loads(resp.read().decode("utf-8"))
            else:
                logger.error("Failed to query inventory: HTTP %s", resp.status)
    except Exception as e:
        logger.error("Failed to connect to backend for inventory: %s", e)
    return []

