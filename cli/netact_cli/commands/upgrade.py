import typer
from rich.console import Console

from ..config import COMPOSE_FILES_IN_ORDER
from ..docker_utils import compose_up_build

console = Console()


def upgrade(
    yes: bool = typer.Option(False, "--yes", "-y", help="Skip confirmation prompt"),
) -> None:
    """Rebuild + restart all 5 stacks from current source, in the documented
    Core -> AI -> Topology -> Knowledge -> Monitoring order. Stops on first
    failure so a broken stack doesn't leave later stacks half-upgraded."""
    console.print("[bold]This will rebuild and restart all NETAct stacks in order:[/bold]")
    for f in COMPOSE_FILES_IN_ORDER:
        console.print(f"  - {f}")
    if not yes and not typer.confirm("Proceed?"):
        raise typer.Exit(0)

    for compose_file in COMPOSE_FILES_IN_ORDER:
        rc = compose_up_build(compose_file)
        if rc != 0:
            console.print(f"\n[red bold]{compose_file} failed to build/start (exit {rc}). Stopping.[/red bold]")
            raise typer.Exit(1)

    console.print("\n[green bold]All stacks rebuilt and running.[/green bold]")
