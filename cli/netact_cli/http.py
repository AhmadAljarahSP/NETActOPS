"""Shared HTTP helpers — every command that talks to a NETAct service or
Qdrant/Ollama goes through here for consistent error handling."""
from __future__ import annotations

import sys
from typing import Any, Iterator

import httpx
import typer

from .config import AUTH_HEADERS


def _with_auth_headers(kwargs: dict) -> dict:
    headers = {**AUTH_HEADERS, **kwargs.pop("headers", {})}
    if headers:
        kwargs["headers"] = headers
    return kwargs


def request_json(method: str, url: str, **kwargs: Any) -> Any:
    """Make an HTTP request and return parsed JSON, or exit(1) with a clear
    message on any failure — connection refused, timeout, or non-2xx."""
    kwargs = _with_auth_headers(kwargs)
    try:
        resp = httpx.request(method, url, timeout=kwargs.pop("timeout", 15.0), **kwargs)
        resp.raise_for_status()
        if not resp.content:
            return None
        return resp.json()
    except httpx.ConnectError:
        typer.secho(f"Could not connect to {url} (is the service running?)", fg="red", err=True)
        raise typer.Exit(1)
    except httpx.TimeoutException:
        typer.secho(f"Timed out talking to {url}", fg="red", err=True)
        raise typer.Exit(1)
    except httpx.HTTPStatusError as e:
        body = e.response.text[:500]
        typer.secho(f"{method} {url} -> {e.response.status_code}: {body}", fg="red", err=True)
        raise typer.Exit(1)


def probe(url: str, timeout: float = 5.0) -> tuple[bool, str]:
    """Best-effort reachability probe for status/doctor checks. Never raises —
    returns (ok, detail) so callers can report a table row instead of crashing."""
    try:
        resp = httpx.get(url, timeout=timeout, headers=AUTH_HEADERS or None)
        if resp.status_code < 400:
            return True, f"HTTP {resp.status_code}"
        return False, f"HTTP {resp.status_code}"
    except httpx.ConnectError:
        return False, "connection refused"
    except httpx.TimeoutException:
        return False, "timeout"
    except Exception as e:
        return False, str(e)[:80]


def stream_text_lines(method: str, url: str, **kwargs: Any) -> Iterator[str]:
    """Stream a plain-text (non-SSE) response body chunk by chunk — used for
    /api/copilot/chat, which returns StreamingResponse(media_type='text/plain')."""
    kwargs = _with_auth_headers(kwargs)
    try:
        with httpx.stream(method, url, timeout=kwargs.pop("timeout", 120.0), **kwargs) as resp:
            resp.raise_for_status()
            for chunk in resp.iter_text():
                if chunk:
                    yield chunk
    except httpx.ConnectError:
        typer.secho(f"Could not connect to {url} (is the copilot backend running?)", fg="red", err=True)
        raise typer.Exit(1)
    except httpx.HTTPStatusError as e:
        typer.secho(f"{method} {url} -> {e.response.status_code}", fg="red", err=True)
        raise typer.Exit(1)
