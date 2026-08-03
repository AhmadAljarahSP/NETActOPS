import typer

from ..config import SERVICES
from ..docker_utils import docker_logs


def logs(
    service: str = typer.Argument(..., help=f"One of: {', '.join(sorted(SERVICES))}"),
    follow: bool = typer.Option(False, "-f", "--follow", help="Follow log output"),
    tail: int = typer.Option(100, "--tail", help="Number of lines to show from the end"),
) -> None:
    """Tail logs for a NETAct service (wraps `docker logs`)."""
    if service not in SERVICES:
        typer.secho(f"Unknown service '{service}'. Valid: {', '.join(sorted(SERVICES))}", fg="red", err=True)
        raise typer.Exit(1)
    docker_logs(SERVICES[service].container_name, follow=follow, tail=tail)
