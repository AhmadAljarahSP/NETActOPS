import typer
from rich.console import Console
from rich.table import Table

from ..config import SERVICES
from ..docker_utils import docker_ps_netact
from ..http import probe

console = Console()


def status() -> None:
    """Consolidated container state + live health-endpoint check for every
    NETAct service."""
    containers = {c.get("Names", c.get("Name", "")): c for c in docker_ps_netact()}

    table = Table(title="NETAct status")
    table.add_column("service")
    table.add_column("container")
    table.add_column("container state")
    table.add_column("health")

    any_down = False
    for svc in SERVICES.values():
        c = containers.get(svc.container_name)
        if c is None:
            state = "[red]not found[/red]"
            any_down = True
        else:
            raw_state = c.get("State", c.get("Status", "unknown"))
            state = f"[green]{raw_state}[/green]" if "running" in raw_state.lower() or "up" in raw_state.lower() else f"[red]{raw_state}[/red]"
            if "running" not in raw_state.lower() and "up" not in raw_state.lower():
                any_down = True

        if svc.health_url:
            ok, detail = probe(svc.health_url)
            health = f"[green]ok ({detail})[/green]" if ok else f"[red]unreachable ({detail})[/red]"
            if not ok:
                any_down = True
        else:
            health = "[dim]n/a[/dim]"

        table.add_row(svc.name, svc.container_name, state, health)

    console.print(table)
    if any_down:
        raise typer.Exit(1)
