import os
import json
import logging
import requests
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, HTTPException, Header, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("notification-backend")

app = FastAPI(title="NETAct Notification Hub", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

CONFIG_DIR = "/app/db"
CONFIG_PATH = os.path.join(CONFIG_DIR, "notification_routing.json")

# Default Routing Configuration
DEFAULT_CONFIG = {
    "enabled": True,
    "matterbridge_url": "http://netact_matterbridge:4242/api/message",
    "rules": [
        {
            "event_type": "backup_failed",
            "channels": ["telegram"],
            "enabled": True
        },
        {
            "event_type": "config_drift",
            "channels": ["slack"],
            "enabled": True
        },
        {
            "event_type": "automation_flow_run",
            "channels": ["slack", "telegram"],
            "enabled": True
        }
    ]
}

# --- Authentication ---
APP_PASSWORD = os.getenv("APP_PASSWORD")

async def verify_api_key(request: Request, x_api_key: str = Header(None)):
    # Do not verify for local container-to-container calls to /notify endpoint
    # to avoid complex API key sharing in backend triggers.
    if request.url.path.rstrip("/").endswith("/notify"):
        return
    if APP_PASSWORD and x_api_key != APP_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid API Key")

# --- Models ---
class Rule(BaseModel):
    event_type: str
    channels: List[str]
    enabled: bool

class NotificationConfig(BaseModel):
    enabled: bool
    matterbridge_url: str
    rules: List[Rule]

class NotificationRequest(BaseModel):
    event_type: str
    title: str
    message: str
    metadata: Optional[Dict[str, Any]] = None

# --- Helper Functions ---
def load_config() -> dict:
    if not os.path.exists(CONFIG_PATH):
        return DEFAULT_CONFIG
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Failed to load notification settings: {e}")
        return DEFAULT_CONFIG

def save_config(config: dict) -> bool:
    try:
        os.makedirs(CONFIG_DIR, exist_ok=True)
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2)
        return True
    except Exception as e:
        logger.error(f"Failed to save notification settings: {e}")
        return False

# --- Endpoints ---
@app.get("/settings", dependencies=[Depends(verify_api_key)])
def get_settings():
    return load_config()

@app.post("/settings", dependencies=[Depends(verify_api_key)])
def update_settings(config: NotificationConfig):
    success = save_config(config.dict())
    if not success:
        raise HTTPException(status_code=500, detail="Failed to save notification settings")
    return {"status": "success"}

@app.post("/notify", dependencies=[Depends(verify_api_key)])
def notify(req: NotificationRequest):
    config = load_config()
    if not config.get("enabled", True):
        logger.info("Notifications are globally disabled.")
        return {"status": "ignored", "reason": "globally_disabled"}

    # Find matching active rules
    matching_rules = [
        r for r in config.get("rules", []) 
        if r.get("event_type") == req.event_type and r.get("enabled", True)
    ]
    
    if not matching_rules:
        logger.info(f"No active notification rules match event: {req.event_type}")
        return {"status": "ignored", "reason": "no_matching_rules"}

    matterbridge_url = config.get("matterbridge_url", "http://netact_matterbridge:4242/api/message")
    sent_count = 0

    for rule in matching_rules:
        channels = rule.get("channels", [])
        for channel in channels:
            payload = {
                "username": "NETAct Notification",
                "text": f"### {req.title}\n\n{req.message}",
                "gateway": f"netact_{channel}"
            }
            try:
                logger.info(f"Relaying alert to Matterbridge gateway 'netact_{channel}'...")
                res = requests.post(matterbridge_url, json=payload, timeout=5.0)
                if res.status_code < 400:
                    sent_count += 1
                else:
                    logger.error(f"Matterbridge error relaying to {channel}: {res.status_code} - {res.text}")
            except Exception as e:
                logger.error(f"Failed to relay notification to {channel}: {e}")

    return {"status": "success", "relayed_messages": sent_count}
