"""Static service registry and repo-root resolution.

netact is a thin wrapper: every command below calls something that already
exists (an HTTP endpoint, a `docker compose` invocation, or a direct
Qdrant/Ollama API). This module is the one place that knows where things
live, so no command has to guess a port.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _find_repo_root() -> Path:
    """Walk up from this file until a directory containing VERSION and
    docker-compose.core.yml is found (the NETAct repo root)."""
    here = Path(__file__).resolve()
    for candidate in [here.parent, *here.parents]:
        if (candidate / "VERSION").exists() and (candidate / "docker-compose.core.yml").exists():
            return candidate
    # Fallback: allow override via env var for non-standard installs/checkouts.
    override = os.getenv("NETACT_REPO_ROOT")
    if override:
        return Path(override).resolve()
    raise RuntimeError(
        "Could not locate the NETAct repo root (no VERSION + docker-compose.core.yml "
        "found in any parent directory). Set NETACT_REPO_ROOT to override."
    )


REPO_ROOT = _find_repo_root()
VERSION_FILE = REPO_ROOT / "VERSION"
ENV_FILE = REPO_ROOT / ".env"


def _read_env_var(key: str) -> str | None:
    """Minimal .env reader — no python-dotenv dependency needed for one value."""
    if not ENV_FILE.exists():
        return None
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip()
    return None


# core-backend and topology-backend enforce this on nearly every route
# (core/backend/app.py:80, topology/backend/app.py:93); automation and the
# copilot backend define an equivalent check but never wire it in via
# Depends(), so it's a no-op there. Sending it on every request regardless
# of target is harmless — services that don't check it just ignore the
# extra header — and means the CLI doesn't need to track per-service which
# enforces auth today (or whether that changes later).
APP_PASSWORD = _read_env_var("APP_PASSWORD")
AUTH_HEADERS = {"X-Api-Key": APP_PASSWORD} if APP_PASSWORD else {}

# Keys whose value must never be printed in full by `netact config show`.
SECRET_ENV_KEY_MARKERS = ("PASS", "SECRET", "KEY", "TOKEN")


@dataclass(frozen=True)
class Service:
    name: str
    container_name: str
    host: str
    port: int
    health_path: str | None = None  # None = no HTTP health endpoint to probe
    compose_file: str | None = None  # which docker-compose.*.yml owns it
    compose_service: str | None = None  # the actual service key inside that compose file
    # (not always the same as `name` — e.g. core backend's display name is
    # "core-backend" but its compose service key is just "backend")

    @property
    def base_url(self) -> str:
        return f"http://{self.host}:{self.port}"

    @property
    def health_url(self) -> str | None:
        if self.health_path is None:
            return None
        return f"{self.base_url}{self.health_path}"


# Confirmed via live inspection of docker-compose.core.yml / .ai.yml /
# .topology.yml / .knowledge.yml / .monitoring.yml and each service's app.py.
SERVICES: dict[str, Service] = {
    "core-backend": Service(
        "core-backend", "NETAct_backend", "127.0.0.1", 8000,
        health_path="/health", compose_file="docker-compose.core.yml", compose_service="backend",
    ),
    "automation": Service(
        "automation", "NETAct_Automation", "127.0.0.1", 8003,
        health_path="/health", compose_file="docker-compose.core.yml", compose_service="automation",
    ),
    "git": Service(
        "git", "NETAct_git", "127.0.0.1", 8002,
        health_path=None, compose_file="docker-compose.core.yml", compose_service="git",
    ),
    "mcp-server": Service(
        "mcp-server", "NETAct_MCP_Server", "127.0.0.1", 5001,
        health_path=None, compose_file="docker-compose.core.yml", compose_service="mcp-server",
    ),
    "copilot-backend": Service(
        "copilot-backend", "NETAct_copilot_backend", "127.0.0.1", 8010,
        health_path="/api/copilot/health", compose_file="docker-compose.ai.yml", compose_service="copilot-backend",
    ),
    "topology-backend": Service(
        "topology-backend", "NETAct_topology_backend", "127.0.0.1", 8001,
        health_path="/health", compose_file="docker-compose.topology.yml", compose_service="topology-backend",
    ),
    "netact-brain": Service(
        "netact-brain", "NETAct_brain", "127.0.0.1", 9092,
        health_path=None, compose_file="docker-compose.knowledge.yml", compose_service="netact-brain",
    ),
    "qdrant": Service(
        "qdrant", "NETAct_qdrant", "127.0.0.1", 6333,
        health_path="/collections", compose_file="docker-compose.ai.yml", compose_service="qdrant",
    ),
    "ollama": Service(
        "ollama", "NETAct_ollama", "127.0.0.1", 11434,
        health_path="/api/tags", compose_file="docker-compose.ai.yml", compose_service="ollama",
    ),
    "ollama-exporter": Service(
        "ollama-exporter", "NETAct_ollama_exporter", "127.0.0.1", 9110,
        health_path="/metrics", compose_file="docker-compose.ai.yml", compose_service="ollama-exporter",
    ),
    "prometheus": Service(
        "prometheus", "NETAct_prometheus", "127.0.0.1", 9090,
        health_path="/-/healthy", compose_file="docker-compose.monitoring.yml", compose_service="prometheus",
    ),
    "grafana": Service(
        "grafana", "NETAct_grafana", "127.0.0.1", 3002,
        health_path="/api/health", compose_file="docker-compose.monitoring.yml", compose_service="grafana",
    ),
}

# Startup order per CLAUDE.md / start_all.sh: Core -> AI -> Topology -> Knowledge -> Monitoring.
COMPOSE_FILES_IN_ORDER: list[str] = [
    "docker-compose.core.yml",
    "docker-compose.ai.yml",
    "docker-compose.topology.yml",
    "docker-compose.knowledge.yml",
    "docker-compose.monitoring.yml",
]


def get_service(name: str) -> Service:
    try:
        return SERVICES[name]
    except KeyError:
        valid = ", ".join(sorted(SERVICES))
        raise KeyError(f"Unknown service '{name}'. Valid services: {valid}") from None
