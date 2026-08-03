import typer
from rich.console import Console

from ..config import SERVICES
from ..docker_utils import compose_run_profile
from ..http import request_json

app = typer.Typer(help="Live network topology (healthcheck-derived) and the Obsidian knowledge graph.")
console = Console()
_TOPOLOGY_BASE = SERVICES["topology-backend"].base_url


def _run_graphify() -> None:
    """Shared by `topology build` and `graph rebuild` — both drive the same
    two graphify jobs against the Obsidian vault, so this is one function
    with two command aliases rather than duplicated logic."""
    rc1 = compose_run_profile("docker-compose.knowledge.yml", "graphify-update")
    if rc1 != 0:
        console.print(f"[red]graphify-update failed (exit {rc1}).[/red]")
        raise typer.Exit(1)
    rc2 = compose_run_profile("docker-compose.knowledge.yml", "graphify-cluster")
    if rc2 != 0:
        console.print(f"[red]graphify-cluster failed (exit {rc2}).[/red]")
        raise typer.Exit(1)
    console.print("[green]Obsidian knowledge graph rebuilt.[/green]")


@app.command("show")
def show() -> None:
    """Live network topology derived from healthcheck data (GET /topology)."""
    data = request_json("GET", f"{_TOPOLOGY_BASE}/topology")
    nodes = data.get("nodes", []) if isinstance(data, dict) else []
    edges = data.get("edges", []) if isinstance(data, dict) else []
    console.print(f"[bold]{len(nodes)} nodes, {len(edges)} edges[/bold]")
    for n in nodes[:50]:
        console.print(f"  node: {n}")
    if len(nodes) > 50:
        console.print(f"  ... and {len(nodes) - 50} more (use --json for full output)")


@app.command("build")
def build() -> None:
    """Rebuild the Obsidian knowledge graph from vault wikilinks (graphify-update + graphify-cluster).
    Note: this is a different graph from `topology show`'s live network view."""
    _run_graphify()


graph_app = typer.Typer(help="Alias for `topology build` — same underlying graphify jobs.")


@graph_app.command("rebuild")
def rebuild() -> None:
    """Alias for `netact topology build` (same graphify jobs, same graph)."""
    _run_graphify()
