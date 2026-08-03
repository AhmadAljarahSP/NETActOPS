import typer
from rich.console import Console

from ..config import SERVICES
from ..http import request_json

app = typer.Typer(help="Device config backups (core backend :8000).")
console = Console()
_BASE = SERVICES["core-backend"].base_url


@app.command("create")
def create(
    device_id: int = typer.Argument(None, help="Numeric device id (see `netact inventory list`)"),
    group: str = typer.Option(None, "--group", help="Back up an entire device group instead of one device"),
) -> None:
    """Create a config backup for one device (POST /backup/{id}) or a whole group (POST /backup/group)."""
    if group:
        result = request_json("POST", f"{_BASE}/backup/group", params={"group": group}, timeout=60.0)
    elif device_id is not None:
        result = request_json("POST", f"{_BASE}/backup/{device_id}", timeout=60.0)
    else:
        typer.secho("Provide a device_id or --group", fg="red", err=True)
        raise typer.Exit(1)
    console.print(result)


@app.command("restore")
def restore(
    device_id: int = typer.Argument(..., help="Numeric device id"),
    backup_id: str = typer.Option(..., "--backup-id", help="Target backup id to roll back to (see backup history)"),
) -> None:
    """Roll a device's config back to a prior backup (POST /backups/{id}/rollback)."""
    result = request_json(
        "POST", f"{_BASE}/backups/{device_id}/rollback",
        params={"target_backup_id": backup_id}, timeout=60.0,
    )
    console.print(result)
