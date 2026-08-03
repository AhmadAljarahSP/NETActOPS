"""Thin subprocess wrappers around `docker` / `docker compose` — netact never
reimplements container orchestration, it just shells out to the same tools an
operator would run by hand."""
from __future__ import annotations

import json
import subprocess
import sys
from typing import Any

import typer

from .config import REPO_ROOT


def _run(cmd: list[str], stream: bool = False, check: bool = True) -> subprocess.CompletedProcess:
    if stream:
        # Inherit stdio so -f/--follow style output shows live, matching
        # what `docker compose logs -f` would look like run directly.
        return subprocess.run(cmd, cwd=REPO_ROOT, check=check)
    return subprocess.run(cmd, cwd=REPO_ROOT, check=check, capture_output=True, text=True)


def compose_ps(compose_file: str) -> list[dict[str, Any]]:
    """`docker compose -f <file> ps --format json` -> list of container dicts.
    Returns [] if the file has no running containers rather than raising."""
    try:
        result = _run(
            ["docker", "compose", "-f", compose_file, "ps", "--format", "json"],
            check=False,
        )
    except FileNotFoundError:
        typer.secho("docker not found on PATH", fg="red", err=True)
        raise typer.Exit(1)
    if result.returncode != 0:
        return []
    containers = []
    # `docker compose ps --format json` emits one JSON object per line.
    for line in result.stdout.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            containers.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return containers


def compose_up_build(compose_file: str) -> int:
    """`docker compose -f <file> up -d --build`, streamed live. Returns the
    process exit code so callers (e.g. `upgrade`) can stop on first failure."""
    typer.secho(f"\n==> {compose_file}: up -d --build", fg="cyan", bold=True)
    result = _run(["docker", "compose", "-f", compose_file, "up", "-d", "--build"], stream=True, check=False)
    return result.returncode


def compose_restart(compose_file: str, service: str) -> int:
    typer.secho(f"==> {compose_file}: restart {service}", fg="cyan")
    result = _run(["docker", "compose", "-f", compose_file, "restart", service], stream=True, check=False)
    return result.returncode


def docker_ps_netact() -> list[dict[str, Any]]:
    """`docker ps -a --filter name=NETAct_ --format json` -> list of dicts."""
    try:
        result = _run(
            ["docker", "ps", "-a", "--filter", "name=NETAct_", "--format", "{{json .}}"],
            check=False,
        )
    except FileNotFoundError:
        typer.secho("docker not found on PATH", fg="red", err=True)
        raise typer.Exit(1)
    containers = []
    for line in result.stdout.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            containers.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return containers


def docker_logs(container_name: str, follow: bool = False, tail: int = 100) -> None:
    cmd = ["docker", "logs"]
    if follow:
        cmd.append("-f")
    cmd += ["--tail", str(tail), container_name]
    try:
        subprocess.run(cmd, check=False)
    except FileNotFoundError:
        typer.secho("docker not found on PATH", fg="red", err=True)
        raise typer.Exit(1)
    except KeyboardInterrupt:
        pass


def compose_run_profile(compose_file: str, service: str) -> int:
    """`docker compose -f <file> --profile manual run --rm <service>` — used
    for the one-shot graphify jobs (topology build / graph rebuild). --profile
    must precede the `run` subcommand, matching the exact invocation
    documented in docker-compose.knowledge.yml's own header comments."""
    typer.secho(f"==> {compose_file}: --profile manual run --rm {service}", fg="cyan")
    result = _run(
        ["docker", "compose", "-f", compose_file, "--profile", "manual", "run", "--rm", service],
        stream=True, check=False,
    )
    return result.returncode
