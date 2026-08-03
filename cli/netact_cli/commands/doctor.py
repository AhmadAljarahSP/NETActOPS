import typer
from rich.console import Console

from ..config import SERVICES
from ..docker_utils import docker_ps_netact
from ..http import probe

console = Console()


def doctor() -> None:
    """Broad self-check: every service's container state + health endpoint,
    plus Qdrant and Ollama reachability. Exits non-zero if anything critical
    is down."""
    containers = {c.get("Names", c.get("Name", "")): c for c in docker_ps_netact()}
    failures = 0

    console.print("[bold]NETAct doctor[/bold]\n")
    for svc in SERVICES.values():
        c = containers.get(svc.container_name)
        if c is None:
            console.print(f"[red]FAIL[/red]  {svc.name:<20} container not found")
            failures += 1
            continue
        raw_state = c.get("State", c.get("Status", "unknown"))
        container_ok = "running" in raw_state.lower() or "up" in raw_state.lower()
        if not container_ok:
            console.print(f"[red]FAIL[/red]  {svc.name:<20} container state: {raw_state}")
            failures += 1
            continue

        if svc.health_url:
            ok, detail = probe(svc.health_url)
            if ok:
                console.print(f"[green]OK[/green]    {svc.name:<20} {detail}")
            else:
                console.print(f"[red]FAIL[/red]  {svc.name:<20} health check failed: {detail}")
                failures += 1
        else:
            console.print(f"[green]OK[/green]    {svc.name:<20} container running (no health endpoint)")

    console.print()
    if failures:
        console.print(f"[red bold]{failures} check(s) failed.[/red bold]")
        raise typer.Exit(1)
    console.print("[green bold]All checks passed.[/green bold]")
