"""
jump_transport.py
Standalone Paramiko-based jump-server transport module.

Supports two access modes to reach target routers:
  1. SSH    → direct-tcpip channel  (used by Netmiko sock= parameter)
  2. Telnet → PTY shell on jump + 'telnet <ip> <port>' pivot
"""

from __future__ import annotations

import logging
import re
import socket
import threading
import time

import paramiko

SOCKET_TIMEOUT = 30
TELNET_PORT    = 23

# ---------------------------------------------------------------------------
# Logger — prints to stdout so  docker logs  picks it up immediately
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
    force=True,  # override any existing root-logger config
)
logger = logging.getLogger("jump_transport")


class JumpTransport:
    """
    Manages a single Paramiko Transport to a jump/bastion server.
    Thread-safe.
    """

    def __init__(self, host, username, password, port=22, socket_timeout=SOCKET_TIMEOUT):
        self.host           = host
        self.username       = username
        self.password       = password
        self.port           = port
        self.socket_timeout = socket_timeout
        self._transport     = None
        self._lock          = threading.Lock()

        logger.info(
            "JumpTransport __init__: host=%s  port=%s  user=%s  socket_timeout=%s",
            host, port, username, socket_timeout,
        )

    # ------------------------------------------------------------------
    # Public API — SSH path
    # ------------------------------------------------------------------

    def connect(self):
        logger.info("connect() called — jump=%s:%s", self.host, self.port)
        with self._lock:
            if self._transport and self._transport.is_active():
                logger.debug("Transport already active — skipping reconnect")
                return
            self._connect_locked()

    def open_channel(self, dest_host, dest_port=22):
        logger.info(
            "open_channel() — jump=%s:%s  ->  dest=%s:%s",
            self.host, self.port, dest_host, dest_port,
        )
        self._ensure_transport()
        try:
            ch = self._transport.open_channel(
                "direct-tcpip",
                (dest_host, dest_port),
                ("127.0.0.1", 0),
                timeout=self.socket_timeout,
            )
            logger.info("direct-tcpip channel opened OK -> %s:%s", dest_host, dest_port)
            return ch
        except Exception as exc:
            logger.error(
                "open_channel FAILED -> %s:%s  error=%s",
                dest_host, dest_port, exc, exc_info=True,
            )
            raise

    # ------------------------------------------------------------------
    # Public API — Telnet pivot path
    # ------------------------------------------------------------------

    def open_telnet_shell(
        self,
        dest_host: str,
        dest_port: int = TELNET_PORT,
        login_prompt: str = r"[Uu]ser(name)?[:\s]|[Ll]ogin[:\s]",
        password_prompt: str = r"[Pp]ass(word)?[:\s]",
        username: str | None = None,
        password: str | None = None,
        device_prompt: str = r"[>#\$]\s*$",
        connect_timeout: float = 30.0,
    ) -> paramiko.Channel:
        logger.info(
            "open_telnet_shell() — dest=%s:%s  user=%s  timeout=%.1fs",
            dest_host, dest_port, username, connect_timeout,
        )
        shell = self.open_shell_on_jump()

        telnet_cmd = f"telnet {dest_host} {dest_port}"
        logger.debug("Sending on jump shell: %r", telnet_cmd)
        shell.send(telnet_cmd + "\n")

        deadline = time.time() + connect_timeout
        buf = ""
        phase = "connecting"

        while time.time() < deadline:
            time.sleep(0.5)  # Increased sleep time

            if shell.recv_ready():
                chunk = shell.recv(65535).decode("utf-8", errors="replace")
                buf += chunk
                logger.debug("[TELNET-RAW phase=%s] Received %d chars, total buf: %d", 
                            phase, len(chunk), len(buf))

            # Username prompt
            if username and re.search(login_prompt, buf, re.IGNORECASE):
                logger.info("Login prompt detected on %s — sending username", dest_host)
                shell.send(username + "\n")
                buf = ""
                phase = "authenticating"
                time.sleep(1)
                continue

            # Password prompt
            if password and re.search(password_prompt, buf, re.IGNORECASE):
                logger.info("Password prompt detected on %s — sending password", dest_host)
                shell.send(password + "\n")
                buf = ""
                phase = "post-auth"
                time.sleep(1)
                continue

            # Device CLI prompt — we're in
            if re.search(device_prompt, buf):
                logger.info(
                    "Device CLI prompt detected on %s:%s — telnet ready  phase=%s",
                    dest_host, dest_port, phase,
                )
                # Clear any remaining data in buffer
                time.sleep(0.5)
                while shell.recv_ready():
                    shell.recv(65535)
                return shell

        logger.error(
            "open_telnet_shell TIMEOUT — %s:%s  phase=%s  last_buf=%r",
            dest_host, dest_port, phase, buf[-600:],
        )
        raise TimeoutError(
            f"[TELNET TIMEOUT] Could not reach prompt on {dest_host}:{dest_port} "
            f"via jump {self.host}. Last output (phase={phase}):\n{buf[-800:]}"
        )

    # ------------------------------------------------------------------
    # Public API — raw jump shell
    # ------------------------------------------------------------------

    def open_shell_on_jump(self) -> paramiko.Channel:
        logger.info("open_shell_on_jump() — jump=%s:%s", self.host, self.port)
        self._ensure_transport()
        try:
            channel = self._transport.open_channel("session")
            channel.get_pty(term="vt100", width=200, height=50)
            channel.invoke_shell()
            time.sleep(2)  # Increased wait time for shell

            # Read and log banner
            if channel.recv_ready():
                banner = channel.recv(65535).decode("utf-8", errors="replace")
                logger.debug("Jump shell banner: %r", banner[:200])
            else:
                logger.debug("Jump shell opened — no banner received yet")
                
                # Try to get prompt
                time.sleep(1)
                if channel.recv_ready():
                    banner = channel.recv(65535).decode("utf-8", errors="replace")
                    logger.debug("Delayed banner: %r", banner[:200])

            logger.info("Jump shell ready on %s:%s", self.host, self.port)
            return channel
        except Exception as exc:
            logger.error("open_shell_on_jump FAILED: %s", exc, exc_info=True)
            raise

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def close(self):
        logger.info("close() — jump=%s:%s", self.host, self.port)
        with self._lock:
            if self._transport:
                try:
                    self._transport.close()
                    logger.info("Transport closed OK")
                except Exception as exc:
                    logger.warning("Error closing transport: %s", exc)
                finally:
                    self._transport = None
            else:
                logger.debug("close() called but no transport exists")

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, *_):
        self.close()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _connect_locked(self):
        logger.info(
            "_connect_locked() — TCP connect to %s:%s  timeout=%s",
            self.host, self.port, self.socket_timeout,
        )
        try:
            sock = socket.create_connection((self.host, self.port), timeout=self.socket_timeout)
            logger.debug("TCP socket established to %s:%s", self.host, self.port)
        except OSError as exc:
            logger.error(
                "TCP connection FAILED to %s:%s — errno=%s  msg=%s",
                self.host, self.port, exc.errno, exc,
            )
            raise
        except Exception as exc:
            logger.error(
                "TCP connection FAILED to %s:%s — %s", self.host, self.port, exc, exc_info=True,
            )
            raise

        try:
            logger.debug("Creating Paramiko Transport …")
            t = paramiko.Transport(sock)
            t.connect(username=self.username, password=self.password)
            self._transport = t
            logger.info(
                "Paramiko transport authenticated OK -> %s:%s  user=%s",
                self.host, self.port, self.username,
            )
        except paramiko.AuthenticationException as exc:
            logger.error(
                "Paramiko AUTH FAILED — user=%s  jump=%s:%s — %s",
                self.username, self.host, self.port, exc,
            )
            raise
        except paramiko.SSHException as exc:
            logger.error(
                "Paramiko SSH error during connect -> %s:%s — %s",
                self.host, self.port, exc, exc_info=True,
            )
            raise
        except Exception as exc:
            logger.error(
                "Paramiko transport setup FAILED -> %s:%s — %s",
                self.host, self.port, exc, exc_info=True,
            )
            raise

    def _ensure_transport(self):
        with self._lock:
            exists = self._transport is not None
            active = exists and self._transport.is_active()
            logger.debug(
                "_ensure_transport() — exists=%s  active=%s",
                exists, active,
            )
            if not active:
                logger.warning(
                    "Transport not active (exists=%s) — reconnecting to jump %s:%s",
                    exists, self.host, self.port,
                )
                self._connect_locked()


# ---------------------------------------------------------------------------
# High-level Telnet Session Helper
# ---------------------------------------------------------------------------

class TelnetSession:
    """
    Thin wrapper around a paramiko Channel inside an active telnet session.
    Provides send_command() with prompt-wait, stall detection, and full logging.
    """

    def __init__(
        self,
        channel: paramiko.Channel,
        prompt_pattern: str = r"[>#\$]\s*$",
        default_timeout: float = 120.0,
        read_interval: float   = 0.5,
    ):
        self.channel         = channel
        self.prompt_pattern  = prompt_pattern
        self.default_timeout = default_timeout
        self.read_interval   = read_interval
        self._log            = logging.getLogger("TelnetSession")
        self._log.info(
            "TelnetSession created  prompt=%r  timeout=%.1fs  read_interval=%.1fs",
            prompt_pattern, default_timeout, read_interval,
        )

    # ------------------------------------------------------------------

    def read_until_prompt(self, timeout: float = 30.0) -> str:
        """Read until prompt appears or timeout"""
        deadline = time.time() + timeout
        buf = ""
        
        while time.time() < deadline:
            if self.channel.recv_ready():
                chunk = self.channel.recv(65535).decode("utf-8", errors="replace")
                buf += chunk
                
            if re.search(self.prompt_pattern, buf):
                self._log.debug("Prompt found after reading %d chars", len(buf))
                break
                
            time.sleep(self.read_interval)
        
        return buf

    def send_command(
        self,
        cmd: str,
        timeout: float | None = None,
        strip_cmd: bool    = True,
        strip_prompt: bool = True,
    ) -> str:
        timeout  = timeout or self.default_timeout
        deadline = time.time() + timeout
        self._log.info("send_command: %r  timeout=%.1fs", cmd, timeout)

        # Drain stale channel data more thoroughly
        drained = b""
        drained_count = 0
        while self.channel.recv_ready():
            drained += self.channel.recv(65535)
            drained_count += 1
        if drained:
            self._log.debug("Drained %d bytes (%d chunks) before sending command", len(drained), drained_count)

        # Send command
        self.channel.send(cmd + "\n")
        time.sleep(0.5)  # Small delay after sending

        buf = ""
        last_len = 0
        stable_count = 0
        iterations = 0
        last_output_time = time.time()

        while time.time() < deadline:
            time.sleep(self.read_interval)
            iterations += 1

            if self.channel.recv_ready():
                chunk = self.channel.recv(65535).decode("utf-8", errors="replace")
                buf += chunk
                last_output_time = time.time()
                self._log.debug(
                    "[CMD-READ iter=%d] +%d chars  total=%d  last_50=%r",
                    iterations, len(chunk), len(buf), buf[-50:] if buf else ""
                )
                stable_count = 0
                last_len = len(buf)
            else:
                # Check if we've seen the prompt
                if buf and re.search(self.prompt_pattern, buf):
                    self._log.debug(
                        "Prompt matched after %d iters, %d chars — done", iterations, len(buf)
                    )
                    break
                
                # Check for stall (no data for a while)
                time_since_output = time.time() - last_output_time
                if buf and time_since_output > 15:
                    self._log.warning(
                        "Output stalled for %.1f seconds at %d chars — treating as done",
                        time_since_output, len(buf)
                    )
                    break
                
                # Check for stable output (no growth)
                if len(buf) == last_len and buf.strip():
                    stable_count += 1
                    self._log.debug(
                        "No new data  stable_count=%d/5  total=%d chars", stable_count, len(buf)
                    )
                    if stable_count >= 5:
                        self._log.warning(
                            "Output stable at %d chars after %d iters — treating as done",
                            len(buf), iterations,
                        )
                        break
                else:
                    stable_count = 0
                    last_len = len(buf)
                continue

            if re.search(self.prompt_pattern, buf):
                self._log.debug("Prompt found in stream at iter=%d", iterations)
                break
        else:
            self._log.warning(
                "send_command TIMEOUT %.1fs — cmd=%r  collected %d chars  last_200=%r",
                timeout, cmd, len(buf), buf[-200:],
            )

        # Clean up the output
        lines = buf.splitlines()
        
        # Remove the echoed command if present
        if strip_cmd and lines and cmd.strip() in lines[0]:
            lines = lines[1:]
            
        # Remove the final prompt if present
        if strip_prompt and lines and re.search(self.prompt_pattern, lines[-1]):
            lines = lines[:-1]
            
        # Additional cleanup: remove any trailing empty lines
        while lines and not lines[-1].strip():
            lines.pop()

        result = "\n".join(lines).rstrip()
        
        self._log.info(
            "send_command DONE — cmd=%r  lines=%d  chars=%d",
            cmd, len(lines), len(result),
        )
        
        return result

    # ------------------------------------------------------------------

    def disable_paging(self, commands=("terminal length 0", "terminal width 512")):
        self._log.info("disable_paging()")
        for cmd in commands:
            try:
                out = self.send_command(cmd, timeout=30)
                self._log.debug("disable_paging %r -> response length: %d chars", cmd, len(out))
                # Wait a bit after each paging command
                time.sleep(1)
            except Exception as exc:
                self._log.warning("disable_paging %r raised: %s", cmd, exc)
        
        # Send an extra newline to ensure we're at a clean prompt
        try:
            self.channel.send("\n")
            time.sleep(1)
            # Read and discard any output
            while self.channel.recv_ready():
                self.channel.recv(65535)
        except Exception as exc:
            self._log.warning("Error sending extra newline: %s", exc)

    def close(self):
        self._log.info("TelnetSession.close()")
        try:
            self.channel.close()
        except Exception as exc:
            self._log.warning("Error closing channel: %s", exc)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()