import typer
from rich.console import Console
from rich.table import Table

from ..config import SERVICES
from ..docker_utils import compose_restart, docker_ps_netact

app = typer.Typer(help="Direct docker/compose control for NETAct containers.")
console = Console()


@app.command("status")
def status() -> None:
    """Raw `docker ps` for every NETAct_* container (no health probing — see `netact status` for that)."""
    containers = docker_ps_netact()
    table = Table(title="docker ps (NETAct_*)")
    table.add_column("name")
    table.add_column("image")
    table.add_column("status")
    for c in containers:
        table.add_row(c.get("Names", c.get("Name", "?")), c.get("Image", "?"), c.get("Status", "?"))
    console.print(table)


@app.command("restart")
def restart(
    service: str = typer.Argument(..., help=f"One of: {', '.join(sorted(SERVICES))}, or 'all'"),
) -> None:
    """Restart one service, or every service, via `docker compose restart`."""
    if service == "all":
        for svc in SERVICES.values():
            if not svc.compose_file or not svc.compose_service:
                continue
            rc = compose_restart(svc.compose_file, svc.compose_service)
            if rc != 0:
                typer.secho(f"Failed to restart {svc.name} (exit {rc})", fg="red", err=True)
        return

    if service not in SERVICES:
        typer.secho(f"Unknown service '{service}'. Valid: {', '.join(sorted(SERVICES))}, or 'all'", fg="red", err=True)
        raise typer.Exit(1)
    svc = SERVICES[service]
    if not svc.compose_file or not svc.compose_service:
        typer.secho(f"{service} has no known compose service to restart via", fg="red", err=True)
        raise typer.Exit(1)
    rc = compose_restart(svc.compose_file, svc.compose_service)
    if rc != 0:
        raise typer.Exit(1)
