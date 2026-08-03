#!/bin/bash
set -e

# Resolve current directory of the script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

RECONFIGURE=false
if [[ "$1" == "--reconfigure" ]]; then
  RECONFIGURE=true
fi

echo "============================================================"
echo " NETAct Full Stack Startup (Linux)"
echo " Start order: Core -> AI -> Topology -> Knowledge -> Monitoring"
echo "============================================================"
echo

# ---------------------------------------------------------------------------
# 0. Prerequisite checks
# ---------------------------------------------------------------------------
if ! command -v docker &> /dev/null; then
  echo "ERROR: docker is not installed or not on PATH. Install Docker first: https://docs.docker.com/engine/install/"
  exit 1
fi

if ! docker compose version &> /dev/null; then
  echo "ERROR: 'docker compose' (v2 plugin) is not available. Install/update Docker to get the compose plugin."
  exit 1
fi

if ! docker info &> /dev/null; then
  echo "ERROR: Cannot talk to the Docker daemon. Either start Docker, or add your user to the docker group:"
  echo "  sudo usermod -aG docker \$USER && newgrp docker"
  exit 1
fi

# ---------------------------------------------------------------------------
# 1. First-run .env setup — only runs when .env is missing (or --reconfigure)
# ---------------------------------------------------------------------------
prompt_var() {
  # prompt_var VARNAME "Question text" "default value" [secret]
  local __varname="$1" __question="$2" __default="$3" __secret="${4:-}"
  local __value=""
  local __display_default="$__default"
  if [[ "$__secret" == "secret" && -n "$__default" ]]; then
    __display_default="(hidden)"
  fi
  while true; do
    if [[ -n "$__default" ]]; then
      read -r -p "$__question [$__display_default]: " __input
    else
      read -r -p "$__question: " __input
    fi
    __value="${__input:-$__default}"
    break
  done
  printf -v "$__varname" '%s' "$__value"
}

prompt_secret() {
  # prompt_secret VARNAME "Question text" [required]
  local __varname="$1" __question="$2" __required="${3:-}"
  local __value=""
  while true; do
    read -r -s -p "$__question: " __value
    echo
    if [[ -z "$__value" && "$__required" == "required" ]]; then
      echo "  This value is required — please enter something."
      continue
    fi
    break
  done
  printf -v "$__varname" '%s' "$__value"
}

if [[ ! -f .env || "$RECONFIGURE" == "true" ]]; then
  echo "------------------------------------------------------------"
  echo " First-run setup — configuring .env"
  echo " (Re-run this script with --reconfigure to redo this step.)"
  echo "------------------------------------------------------------"
  echo

  echo "-- Jump/bastion host used to reach your managed devices --"
  prompt_var NEW_JUMP_HOST     "Jump host IP or hostname" ""
  prompt_var NEW_JUMP_USER     "Jump host username" ""
  prompt_secret NEW_JUMP_PASSWORD "Jump host password"
  echo

  echo "-- Default device credentials (used when a device doesn't override them) --"
  prompt_var NEW_DEVICE_USER   "Default device username" "$NEW_JUMP_USER"
  prompt_secret NEW_DEVICE_PASS "Default device password"
  echo

  echo "-- EfficientIP SOLIDserver (IPAM/DNS) — optional --"
  read -r -p "Do you use SOLIDserver for IPAM/DNS? [y/N]: " USE_SOLIDSERVER
  if [[ "$USE_SOLIDSERVER" =~ ^[Yy]$ ]]; then
    prompt_var NEW_SOLIDSERVER_HOST "SOLIDserver host IP or hostname" ""
    prompt_var NEW_SOLIDSERVER_USER "SOLIDserver username" ""
    prompt_secret NEW_SOLIDSERVER_PASSWORD "SOLIDserver password"
  else
    NEW_SOLIDSERVER_HOST=""
    NEW_SOLIDSERVER_USER=""
    NEW_SOLIDSERVER_PASSWORD=""
  fi
  echo

  echo "-- App-level API password (gates every backend API call) --"
  echo "   You'll enter this same value again on the app's login screen."
  prompt_secret NEW_APP_PASSWORD "Choose an API password" required
  echo

  echo "-- Backup encryption key --"
  read -r -p "Auto-generate the config-backup encryption key? [Y/n]: " GEN_KEY
  if [[ "$GEN_KEY" =~ ^[Nn]$ ]]; then
    prompt_secret NEW_ENCRYPTION_KEY "Paste your Fernet encryption key" required
  else
    if command -v python3 &> /dev/null && python3 -c "import cryptography" &> /dev/null; then
      NEW_ENCRYPTION_KEY="$(python3 -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')"
    elif command -v openssl &> /dev/null; then
      NEW_ENCRYPTION_KEY="$(openssl rand -base64 32 | tr '+/' '-_')"
    else
      echo "  Neither python3+cryptography nor openssl found — you'll need to set ENCRYPTION_KEY manually in .env."
      NEW_ENCRYPTION_KEY=""
    fi
    echo "  Generated."
  fi
  echo

  echo "-- Google Gemini API key (optional — used for complex-query escalation) --"
  prompt_var NEW_GEMINI_API_KEY "Gemini API key (leave blank to skip)" ""
  echo

  DEFAULT_PUID="$(id -u)"
  DEFAULT_PGID="$(id -g)"
  DEFAULT_TZ="$(cat /etc/timezone 2>/dev/null || timedatectl show --property=Timezone --value 2>/dev/null || echo UTC)"
  prompt_var NEW_PUID "Container PUID" "$DEFAULT_PUID"
  prompt_var NEW_PGID "Container PGID" "$DEFAULT_PGID"
  prompt_var NEW_TZ   "Timezone" "$DEFAULT_TZ"
  echo

  cat > .env << EOF
# Generated by start_all.sh — edit freely, this file is gitignored.

# --- Jump/bastion host used to reach your managed devices ---
USE_JUMP_SERVER=true
JUMP_HOST=$NEW_JUMP_HOST
JUMP_USER=$NEW_JUMP_USER
JUMP_PASSWORD=$NEW_JUMP_PASSWORD

# --- Default device credentials (used when a device doesn't override them) ---
DEVICE_USER=$NEW_DEVICE_USER
DEVICE_PASS=$NEW_DEVICE_PASS

# --- EfficientIP SOLIDserver (IPAM/DNS) — optional, only needed if you use that integration ---
SOLIDSERVER_HOST=$NEW_SOLIDSERVER_HOST
SOLIDSERVER_USER=$NEW_SOLIDSERVER_USER
SOLIDSERVER_PASSWORD=$NEW_SOLIDSERVER_PASSWORD

# --- App-level API key sent by the frontend/Ansible layer to authenticate backend calls ---
APP_PASSWORD=$NEW_APP_PASSWORD

# --- Fernet key used to encrypt config backups at rest ---
ENCRYPTION_KEY=$NEW_ENCRYPTION_KEY

# --- Google Gemini API key (used for escalation/complex-query synthesis) ---
GEMINI_API_KEY=$NEW_GEMINI_API_KEY

# --- Container user/group + timezone ---
PUID=$NEW_PUID
PGID=$NEW_PGID
TZ=$NEW_TZ
EOF

  chmod 600 .env
  echo "Wrote .env"
  echo
  echo "------------------------------------------------------------"
  echo " Review before continuing"
  echo "------------------------------------------------------------"
  echo "  Jump host    : $NEW_JUMP_HOST"
  echo "  Jump user    : $NEW_JUMP_USER"
  echo
  echo "  There is no separate app username/password — you'll create your"
  echo "  own admin account (any username/password you like) the first time"
  echo "  you open the web UI."
  echo
  echo "  Full config written to: $(pwd)/.env — edit it now if anything"
  echo "  needs changing (e.g. 'nano .env' in another terminal)."
  read -r -p "Press Enter to continue starting the stacks... " _
  echo
else
  echo "Found existing .env — skipping setup (run with --reconfigure to redo it)."
  echo
fi

# ---------------------------------------------------------------------------
# 2. TLS certificate for the frontend (nginx) — self-signed if missing
# ---------------------------------------------------------------------------
if [[ ! -f DeepConsol/certs/server.crt || ! -f DeepConsol/certs/server.key ]]; then
  echo "------------------------------------------------------------"
  echo " Generating a self-signed TLS certificate for the web UI"
  echo "------------------------------------------------------------"
  if ! command -v openssl &> /dev/null; then
    echo "ERROR: openssl is required to generate the TLS certificate but was not found."
    exit 1
  fi
  mkdir -p DeepConsol/certs
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout DeepConsol/certs/server.key \
    -out DeepConsol/certs/server.crt \
    -days 825 \
    -subj "/CN=netact.local" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" 2>/dev/null
  chmod 600 DeepConsol/certs/server.key
  echo "Certificate written to DeepConsol/certs/ (browsers will show an untrusted-cert warning — that's expected for self-signed certs; accept it to continue)."
  echo
fi

# ---------------------------------------------------------------------------
# 3. Start all stacks
# ---------------------------------------------------------------------------
echo "[1/5] Starting Core Platform..."
docker compose -f docker-compose.core.yml up -d --build
echo "Core Stack Started."
echo

echo "[2/5] Starting AI Stack..."
docker compose -f docker-compose.ai.yml up -d --build
echo "AI Stack Started."
echo

echo "[3/5] Starting Topology Stack..."
docker compose -f docker-compose.topology.yml up -d --build
echo "Topology Stack Started."
echo

echo "[4/5] Starting Knowledge Stack..."
docker compose -f docker-compose.knowledge.yml up -d --build
echo "Knowledge Stack Started."
echo

echo "[5/5] Starting Monitoring Stack..."
docker compose -f docker-compose.monitoring.yml up -d
echo "Monitoring Stack Started."
echo

echo "============================================================"
echo " All stacks started. Service endpoints:"
echo "============================================================"
echo "   NETAct GUI         : https://localhost:3000"
echo "   Backend API        : http://localhost:8000"
echo "   Automation API     : http://localhost:8003"
echo "   MCP Server         : http://localhost:5001"
echo "   Topology           : http://localhost:3001"
echo "   Copilot AI         : http://localhost:8011"
echo "   Copilot Backend    : http://localhost:8010"
echo "   Obsidian Web       : http://localhost:8085"
echo "   Ollama             : http://localhost:11434"
echo "   Qdrant             : http://localhost:6333"
echo "   Prometheus         : http://localhost:9090"
echo "   Grafana            : http://127.0.0.1:3002"
echo "============================================================"
echo " First visit to the GUI: choose your own admin username and"
echo " password there to create your account (there's no default account)."
echo
echo " The device inventory ships empty — add devices from the"
echo " Inventory page once you're logged in."
echo "============================================================"
