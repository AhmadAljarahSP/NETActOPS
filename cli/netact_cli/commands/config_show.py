from rich.console import Console
from rich.table import Table

from ..config import ENV_FILE, SECRET_ENV_KEY_MARKERS, SERVICES

console = Console()


def _mask(key: str, value: str) -> str:
    if not value:
        return value
    if any(marker in key.upper() for marker in SECRET_ENV_KEY_MARKERS):
        return "***"
    return value


def config_show() -> None:
    """Print the resolved service/port registry and .env (secrets masked)."""
    table = Table(title="NETAct service registry")
    table.add_column("service")
    table.add_column("container")
    table.add_column("url")
    table.add_column("compose file")
    for svc in SERVICES.values():
        table.add_row(svc.name, svc.container_name, svc.base_url, svc.compose_file or "-")
    console.print(table)

    if not ENV_FILE.exists():
        console.print(f"\n[yellow]No .env file found at {ENV_FILE}[/yellow]")
        return

    env_table = Table(title=f"\n{ENV_FILE}")
    env_table.add_column("key")
    env_table.add_column("value")
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        env_table.add_row(key.strip(), _mask(key.strip(), value.strip()))
    console.print(env_table)
