import typer
from rich.console import Console

from ..config import SERVICES
from ..http import request_json

console = Console()
_BASE = SERVICES["core-backend"].base_url


def healthcheck(
    device_id: int = typer.Argument(None, help="Numeric device id (see `netact inventory list`)"),
    group: str = typer.Option(None, "--group", help="Run against an entire device group instead of one device"),
) -> None:
    """Run a device healthcheck (POST /healthcheck/{id}) or a whole group (POST /healthcheck/group)."""
    if group:
        result = request_json("POST", f"{_BASE}/healthcheck/group", params={"group": group}, timeout=60.0)
    elif device_id is not None:
        result = request_json("POST", f"{_BASE}/healthcheck/{device_id}", timeout=60.0)
    else:
        typer.secho("Provide a device_id or --group", fg="red", err=True)
        raise typer.Exit(1)
    console.print(result)
