import asyncio
import logging
import os
import re
import time

import asyncssh

from async_jump_transport import AsyncJumpTransport

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
    force=True,
)
logger = logging.getLogger("collector")
logger.setLevel(logging.DEBUG)

BACKUP_COMMANDS_DIR = os.path.join(os.path.dirname(__file__), "showcommands")
HEALTHCHECK_COMMANDS_DIR = os.path.join(os.path.dirname(__file__), "commands")

# Per-vendor prompt patterns and session config
VENDOR_CONFIG = {
    "huawei": {
        "prompt_pattern": r"[<\[][^\r\n<>\[\]]{1,64}[>\]]",
        "request_pty":    False,
        "term_type":      None,
        "paging_cmd":     "screen-length 0 temporary",
        "quit_cmd":       "quit",
    },
    "cisco": {
        "prompt_pattern": r"[^\r\n]+[>#]\s*$",
        "request_pty":    True,
        "term_type":      "vt100",
        "paging_cmd":     "terminal length 0",
        "quit_cmd":       "exit",
    },
    "cisco_xr": {
        "prompt_pattern": r"[^\r\n]+[>#]\s*$",
        "request_pty":    True,
        "term_type":      "vt100",
        "paging_cmd":     "terminal length 0",
        "quit_cmd":       "exit",
    },
    "cisco_xr": {
        "prompt_pattern": r"[^\r\n]+[>#]\s*$",
        "request_pty":    True,
        "term_type":      "vt100",
        "paging_cmd":     "terminal length 0",
        "quit_cmd":       "exit",
    },
    "nxos": {
        "prompt_pattern": r"[^\r\n]+[>#]\s*$",
        "request_pty":    True,
        "term_type":      "vt100",
        "paging_cmd":     "terminal length 0",
        "quit_cmd":       "exit",
    },
    "juniper": {
        "prompt_pattern": r"[^\r\n]+[>%]\s*$",
        "request_pty":    False,
        "term_type":      None,
        "paging_cmd":     "set cli screen-length 0",
        "quit_cmd":       "exit",
    },
}

DEFAULT_VENDOR_CONFIG = {
    "prompt_pattern": r"[^\r\n]+[>#%]\s*$",
    "request_pty":    True,
    "term_type":      "vt100",
    "paging_cmd":     "terminal length 0",
    "quit_cmd":       "exit",
}

# Per-command timeout in seconds
COMMAND_TIMEOUT = 60

# Stop reading after this many seconds of silence once prompt is seen
READ_IDLE_TIMEOUT = 3.0


def get_vendor_config(vendor: str) -> dict:
    v = vendor.lower()
    if "juniper" in v:
        v = "juniper"
    elif "cisco_xr" in v or "xr" in v:
        v = "cisco_xr"
    elif "cisco" in v:
        v = "cisco"
    return VENDOR_CONFIG.get(v, DEFAULT_VENDOR_CONFIG)


def get_commands(vendor: str, commands_source_path: str = None, command_type: str = "backup") -> list[str]:
    v_lower = vendor.lower()
    if "juniper" in v_lower:
        normalized_vendor = "juniper"
    elif "cisco_xr" in v_lower or "xr" in v_lower:
        normalized_vendor = "cisco_xr"
    elif "cisco" in v_lower:
        normalized_vendor = "cisco"
    else:
        normalized_vendor = v_lower

    fallback_cmd = "display version" if normalized_vendor == "huawei" else "show version"
    
    # Enforce directory boundaries: backups only from showcommands, healthchecks only from commands
    if commands_source_path:
        if command_type == "backup" and "showcommands" not in commands_source_path:
            logger.info("get_commands: ignoring non-backup commands source %s for backup type", commands_source_path)
            commands_source_path = None
        elif command_type == "healthcheck" and "showcommands" in commands_source_path:
            logger.info("get_commands: ignoring backup commands source %s for healthcheck type", commands_source_path)
            commands_source_path = None

    if commands_source_path and os.path.exists(commands_source_path):
        filepath = commands_source_path
        logger.debug("get_commands: using explicit path %s for type=%s", filepath, command_type)
    else:
        base_dir = HEALTHCHECK_COMMANDS_DIR if command_type == "healthcheck" else BACKUP_COMMANDS_DIR
        logger.debug("get_commands: using %s directory", command_type.upper())

        filepath = os.path.join(base_dir, f"{normalized_vendor}.txt")
        if not os.path.exists(filepath):
            # Check for uppercase filename fallback (crucial for case-sensitive filesystems like Docker Linux)
            filepath_upper = os.path.join(base_dir, f"{normalized_vendor.upper()}.txt")
            if os.path.exists(filepath_upper):
                filepath = filepath_upper
            else:
                filepath = os.path.join(base_dir, "cisco.txt")
                if not os.path.exists(filepath):
                    filepath = os.path.join(base_dir, "default.txt")
                    if not os.path.exists(filepath):
                        logger.warning("No command file found for vendor='%s' (normalized='%s') in %s", vendor, normalized_vendor, base_dir)
                        return [fallback_cmd]
                logger.warning("No vendor file for '%s', falling back to %s", vendor, os.path.basename(filepath))

    try:
        with open(filepath, "r") as f:
            cmds = [l.strip() for l in f if l.strip() and not l.strip().startswith("#")]
        if not cmds:
            logger.warning("Command file %s is empty, using fallback", filepath)
            return [fallback_cmd]
        logger.info("get_commands: loaded %d commands from %s for type=%s", len(cmds), filepath, command_type)
        return cmds
    except Exception as exc:
        logger.error("get_commands: failed to load from %s: %s", filepath, exc)
        return [fallback_cmd]



async def read_until_prompt(stdout, prompt_pattern: str, timeout: float = COMMAND_TIMEOUT) -> str:
    """
    Read from asyncssh shell stdout (string mode) until a prompt is detected.
    Uses idle timeout: stops when no new data arrives for READ_IDLE_TIMEOUT
    seconds AND the last line matches the prompt pattern.
    """
    buf = ""
    deadline = time.time() + timeout

    while time.time() < deadline:
        try:
            chunk = await asyncio.wait_for(stdout.read(4096), timeout=READ_IDLE_TIMEOUT)
            if not chunk:
                break
            buf += chunk

            last_line = buf.rsplit("\n", 1)[-1].strip()
            # Strip ANSI escape codes before matching prompt
            last_line_clean = re.sub(r"\x1b\[[0-9;]*[mGKHF]", "", last_line)
            if re.search(prompt_pattern, last_line_clean):
                break

        except asyncio.TimeoutError:
            last_line = buf.rsplit("\n", 1)[-1].strip()
            last_line_clean = re.sub(r"\x1b\[[0-9;]*[mGKHF]", "", last_line)
            if re.search(prompt_pattern, last_line_clean):
                logger.debug("Idle timeout with prompt detected — done reading")
                break
            if time.time() >= deadline:
                logger.warning("Overall command timeout reached without prompt")
                break

    return buf


def truncate_sensitive_line(line: str) -> str:
    """Detect and truncate sensitive data on a single line of configuration/output."""
    # 1. set system login user
    m = re.search(r"^(.*?\bset\s+system\s+login\s+user\s+\S+\s+authentication\s+(?:plaintext-password|encrypted-password)\s+)(?:\"[^\"]*\"|\'[^\']*\'|\S+)(.*)$", line, re.IGNORECASE)
    if m:
        return f"{m.group(1)}<truncated>{m.group(2)}"

    # 2. set system root-authentication
    m = re.search(r"^(.*?\bset\s+system\s+root-authentication\s+(?:plaintext-password|encrypted-password)\s+)(?:\"[^\"]*\"|\'[^\']*\'|\S+)(.*)$", line, re.IGNORECASE)
    if m:
        return f"{m.group(1)}<truncated>{m.group(2)}"

    # 3. set snmp community
    m = re.search(r"^(.*?\bset\s+snmp\s+community\s+)(?:\"[^\"]*\"|\'[^\']*\'|\S+)(.*)$", line, re.IGNORECASE)
    if m:
        return f"{m.group(1)}<truncated>{m.group(2)}"

    # 4. snmp-server community
    m = re.search(r"^(.*?\bsnmp-server\s+community\s+(?:cipher\s+|simple\s+|\d\s+)?)(?:\"[^\"]*\"|\'[^\']*\'|\S+)(.*)$", line, re.IGNORECASE)
    if m:
        return f"{m.group(1)}<truncated>{m.group(2)}"

    # 5. snmp-agent community
    m = re.search(r"^(.*?\bsnmp-agent\s+community\s+(?:read\s+|write\s+)?(?:cipher\s+|simple\s+|\d\s+)?)(?:\"[^\"]*\"|\'[^\']*\'|\S+)(.*)$", line, re.IGNORECASE)
    if m:
        return f"{m.group(1)}<truncated>{m.group(2)}"

    # 6. local-user
    m = re.search(r"^(.*?\blocal-user\s+\S+.*?\b(?:password|cipher)\s+(?:cipher\s+|simple\s+|encrypted\s+|\d\s+)?)(?:\"[^\"]*\"|\'[^\']*\'|\S+)(.*)$", line, re.IGNORECASE)
    if m:
        return f"{m.group(1)}<truncated>{m.group(2)}"

    # 7. username (with password or secret)
    m = re.search(r"^(.*?\busername\s+\S+.*?\b(?:password|secret)\s+(?:cipher\s+|simple\s+|encrypted\s+|\d\s+)?)(?:\"[^\"]*\"|\'[^\']*\'|\S+)(.*)$", line, re.IGNORECASE)
    if m:
        return f"{m.group(1)}<truncated>{m.group(2)}"

    # 8. traps version 2c
    m = re.search(r"^(.*?\btraps\s+version\s+2c\s+(?:cipher\s+|simple\s+|\d\s+)?)(?:\"[^\"]*\"|\'[^\']*\'|\S+)(.*)$", line, re.IGNORECASE)
    if m:
        return f"{m.group(1)}<truncated>{m.group(2)}"

    # 9. password (standalone or general)
    m = re.search(r"^(.*?\b(?:password|secret)\s+(?:cipher\s+|simple\s+|encrypted\s+|\d\s+)?)(?:\"[^\"]*\"|\'[^\']*\'|\S+)(.*)$", line, re.IGNORECASE)
    if m:
        return f"{m.group(1)}<truncated>{m.group(2)}"

    return line

def sanitize_output(text: str) -> str:
    """Process configuration text line-by-line to truncate sensitive values."""
    if not text:
        return text
    return "\n".join(truncate_sensitive_line(line) for line in text.splitlines())


def get_vendor_config(vendor: str) -> dict:
    v = vendor.lower()
    if "juniper" in v:
        v = "juniper"
    elif "cisco_xr" in v or "xr" in v:
        v = "cisco_xr"
    elif "cisco" in v:
        v = "cisco"
    return VENDOR_CONFIG.get(v, DEFAULT_VENDOR_CONFIG)


def get_commands(vendor: str, commands_source_path: str = None, command_type: str = "backup") -> list[str]:
    v_lower = vendor.lower()
    if "juniper" in v_lower:
        normalized_vendor = "juniper"
    elif "cisco_xr" in v_lower or "xr" in v_lower:
        normalized_vendor = "cisco_xr"
    elif "cisco" in v_lower:
        normalized_vendor = "cisco"
    else:
        normalized_vendor = v_lower

    fallback_cmd = "display version" if normalized_vendor == "huawei" else "show version"
    
    # Enforce directory boundaries: backups only from showcommands, healthchecks only from commands
    if commands_source_path:
        if command_type == "backup" and "showcommands" not in commands_source_path:
            logger.info("get_commands: ignoring non-backup commands source %s for backup type", commands_source_path)
            commands_source_path = None
        elif command_type == "healthcheck" and "showcommands" in commands_source_path:
            logger.info("get_commands: ignoring backup commands source %s for healthcheck type", commands_source_path)
            commands_source_path = None

    if commands_source_path and os.path.exists(commands_source_path):
        filepath = commands_source_path
        logger.debug("get_commands: using explicit path %s for type=%s", filepath, command_type)
    else:
        base_dir = HEALTHCHECK_COMMANDS_DIR if command_type == "healthcheck" else BACKUP_COMMANDS_DIR
        logger.debug("get_commands: using %s directory", command_type.upper())

        filepath = os.path.join(base_dir, f"{normalized_vendor}.txt")
        if not os.path.exists(filepath):
            # Check for uppercase filename fallback (crucial for case-sensitive filesystems like Docker Linux)
            filepath_upper = os.path.join(base_dir, f"{normalized_vendor.upper()}.txt")
            if os.path.exists(filepath_upper):
                filepath = filepath_upper
            else:
                filepath = os.path.join(base_dir, "cisco.txt")
                if not os.path.exists(filepath):
                    filepath = os.path.join(base_dir, "default.txt")
                    if not os.path.exists(filepath):
                        logger.warning("No command file found for vendor='%s' (normalized='%s') in %s", vendor, normalized_vendor, base_dir)
                        return [fallback_cmd]
                logger.warning("No vendor file for '%s', falling back to %s", vendor, os.path.basename(filepath))

    try:
        with open(filepath, "r") as f:
            cmds = [l.strip() for l in f if l.strip() and not l.strip().startswith("#")]
        if not cmds:
            logger.warning("Command file %s is empty, using fallback", filepath)
            return [fallback_cmd]
        logger.info("get_commands: loaded %d commands from %s for type=%s", len(cmds), filepath, command_type)
        return cmds
    except Exception as exc:
        logger.error("get_commands: failed to load from %s: %s", filepath, exc)
        return [fallback_cmd]



async def read_until_prompt(stdout, prompt_pattern: str, timeout: float = COMMAND_TIMEOUT) -> str:
    """
    Read from asyncssh shell stdout (string mode) until a prompt is detected.
    Uses idle timeout: stops when no new data arrives for READ_IDLE_TIMEOUT
    seconds AND the last line matches the prompt pattern.
    """
    buf = ""
    deadline = time.time() + timeout

    while time.time() < deadline:
        try:
            chunk = await asyncio.wait_for(stdout.read(4096), timeout=READ_IDLE_TIMEOUT)
            if not chunk:
                break
            buf += chunk

            last_line = buf.rsplit("\n", 1)[-1].strip()
            # Strip ANSI escape codes before matching prompt
            last_line_clean = re.sub(r"\x1b\[[0-9;]*[mGKHF]", "", last_line)
            if re.search(prompt_pattern, last_line_clean):
                break

        except asyncio.TimeoutError:
            last_line = buf.rsplit("\n", 1)[-1].strip()
            last_line_clean = re.sub(r"\x1b\[[0-9;]*[mGKHF]", "", last_line)
            if re.search(prompt_pattern, last_line_clean):
                logger.debug("Idle timeout with prompt detected — done reading")
                break
            if time.time() >= deadline:
                logger.warning("Overall command timeout reached without prompt")
                break

    return buf


def truncate_sensitive_line(line: str) -> str:
    """Detect and truncate sensitive data on a single line of configuration/output."""
    # 1. set system login user
    m = re.search(r"^(.*?\bset\s+system\s+login\s+user\s+\S+\s+authentication\s+(?:plaintext-password|encrypted-password)\s+)(?:\"[^\"]*\"|\'[^\']*\'|\S+)(.*)$", line, re.IGNORECASE)
    if m:
        return f"{m.group(1)}<truncated>{m.group(2)}"

    # 2. set system root-authentication
    m = re.search(r"^(.*?\bset\s+system\s+root-authentication\s+(?:plaintext-password|encrypted-password)\s+)(?:\"[^\"]*\"|\'[^\']*\'|\S+)(.*)$", line, re.IGNORECASE)
    if m:
        return f"{m.group(1)}<truncated>{m.group(2)}"

    # 3. set snmp community
    m = re.search(r"^(.*?\bset\s+snmp\s+community\s+)(?:\"[^\"]*\"|\'[^\']*\'|\S+)(.*)$", line, re.IGNORECASE)
    if m:
        return f"{m.group(1)}<truncated>{m.group(2)}"

    # 4. snmp-server community
    m = re.search(r"^(.*?\bsnmp-server\s+community\s+(?:cipher\s+|simple\s+|\d\s+)?)(?:\"[^\"]*\"|\'[^\']*\'|\S+)(.*)$", line, re.IGNORECASE)
    if m:
        return f"{m.group(1)}<truncated>{m.group(2)}"

    # 5. snmp-agent community
    m = re.search(r"^(.*?\bsnmp-agent\s+community\s+(?:read\s+|write\s+)?(?:cipher\s+|simple\s+|\d\s+)?)(?:\"[^\"]*\"|\'[^\']*\'|\S+)(.*)$", line, re.IGNORECASE)
    if m:
        return f"{m.group(1)}<truncated>{m.group(2)}"

    # 6. local-user
    m = re.search(r"^(.*?\blocal-user\s+\S+.*?\b(?:password|cipher)\s+(?:cipher\s+|simple\s+|encrypted\s+|\d\s+)?)(?:\"[^\"]*\"|\'[^\']*\'|\S+)(.*)$", line, re.IGNORECASE)
    if m:
        return f"{m.group(1)}<truncated>{m.group(2)}"

    # 7. username (with password or secret)
    m = re.search(r"^(.*?\busername\s+\S+.*?\b(?:password|secret)\s+(?:cipher\s+|simple\s+|encrypted\s+|\d\s+)?)(?:\"[^\"]*\"|\'[^\']*\'|\S+)(.*)$", line, re.IGNORECASE)
    if m:
        return f"{m.group(1)}<truncated>{m.group(2)}"

    # 8. traps version 2c
    m = re.search(r"^(.*?\btraps\s+version\s+2c\s+(?:cipher\s+|simple\s+|\d\s+)?)(?:\"[^\"]*\"|\'[^\']*\'|\S+)(.*)$", line, re.IGNORECASE)
    if m:
        return f"{m.group(1)}<truncated>{m.group(2)}"

    # 9. password (standalone or general)
    m = re.search(r"^(.*?\b(?:password|secret)\s+(?:cipher\s+|simple\s+|encrypted\s+|\d\s+)?)(?:\"[^\"]*\"|\'[^\']*\'|\S+)(.*)$", line, re.IGNORECASE)
    if m:
        return f"{m.group(1)}<truncated>{m.group(2)}"

    return line


def sanitize_output(text: str) -> str:
    """Process configuration text line-by-line to truncate sensitive values."""
    if not text:
        return text
    return "\n".join(truncate_sensitive_line(line) for line in text.splitlines())


def clean_output(raw: str, cmd: str, prompt_pattern: str) -> str:
    """Strip echoed command, ANSI codes, and trailing prompt from output, and sanitize sensitive data."""
    # Remove ANSI escape sequences
    text = re.sub(r"\x1b\[[0-9;]*[mGKHF]", "", raw)
    lines = text.splitlines()
    # Remove echoed command (first line)
    if lines and cmd.strip() in lines[0]:
        lines = lines[1:]
    # Remove trailing prompt line
    if lines:
        last_clean = re.sub(r"\x1b\[[0-9;]*[mGKHF]", "", lines[-1].strip())
        if re.search(prompt_pattern, last_clean):
            lines = lines[:-1]
    
    cleaned = "\n".join(lines).strip()
    return sanitize_output(cleaned)

class DirectTelnetStream:
    def __init__(self, reader, writer):
        self._reader = reader
        self._writer = writer
    def write(self, text: str):
        self._writer.write(text.encode('utf-8'))
    async def read(self, n: int = 4096) -> str:
        data = await self._reader.read(n)
        return data.decode('utf-8', errors='ignore')
    def close(self):
        self._writer.close()


async def collect_via_ssh(jump_transport: AsyncJumpTransport, device: dict, command_type: str = "backup", use_jump_server: bool = True) -> str:
    target_ip = device["ip_address"]
    username  = device["username"]
    password  = device["password"]
    vendor    = device.get("vendor", "cisco")
    port      = int(device.get("port", 22))
    vcfg      = get_vendor_config(vendor)

    commands = device.get("custom_commands") or get_commands(vendor, device.get("selected_commands_source"), command_type=command_type)

    logger.info(
        "collect_via_ssh START — %s (%s) ip=%s commands=%d type=%s pty=%s jump_mode=%s",
        device.get("hostname"), vendor, target_ip, len(commands), command_type, vcfg["request_pty"], use_jump_server,
    )

    try:
        # Step 1: jump server connection or direct
        if use_jump_server and jump_transport:
            jump_conn = await jump_transport.ensure_connection()
            logger.info("Jump server connection ready")
        else:
            jump_conn = None
            logger.info("Direct SSH connection mode active (bypassing jump server)")

        # Step 2: connect to device
        logger.info("Opening asyncssh connection to %s (tunnel=%s)...", target_ip, bool(jump_conn))
        device_conn = await asyncssh.connect(
            target_ip,
            port=port,
            username=username,
            password=password,
            known_hosts=None,
            client_keys=[],  # Prevents switch from aborting connection on failed public key auth
            tunnel=jump_conn,
        )
        logger.info("asyncssh connected to %s OK", target_ip)

        parts = [
            f"=== Device: {device.get('hostname')} ===",
            f"=== IP: {target_ip} ===",
            f"=== Type: {command_type.upper()} ===",
            f"=== Time: {time.strftime('%Y-%m-%d %H:%M:%S')} ===\n",
        ]

        async with device_conn:
            # Step 3: open shell with vendor-appropriate PTY setting
            stdin, stdout, stderr = await device_conn.open_session(
                term_type=vcfg["term_type"],
                request_pty=vcfg["request_pty"],
            )
            logger.info(
                "Shell session opened on %s (pty=%s term=%s)",
                target_ip, vcfg["request_pty"], vcfg["term_type"],
            )

            # Step 4: read login banner / initial prompt
            banner = await read_until_prompt(stdout, vcfg["prompt_pattern"], timeout=30)
            logger.debug("Initial banner received (%d chars)", len(banner))

            # Step 5: disable pagination
            if vcfg["paging_cmd"]:
                logger.info("Disabling pagination: %s", vcfg["paging_cmd"])
                stdin.write(f"{vcfg['paging_cmd']}\n")
                await read_until_prompt(stdout, vcfg["prompt_pattern"], timeout=15)

            # Step 6: run each command
            for idx, cmd in enumerate(commands, 1):
                logger.info("[%d/%d] Executing: %s", idx, len(commands), cmd)
                t0 = time.time()

                stdin.write(f"{cmd}\n")
                raw = await read_until_prompt(stdout, vcfg["prompt_pattern"], timeout=COMMAND_TIMEOUT)
                elapsed = time.time() - t0

                output = clean_output(raw, cmd, vcfg["prompt_pattern"])

                logger.info(
                    "[%d/%d] Done in %.1fs — %d lines",
                    idx, len(commands), elapsed, len(output.splitlines()),
                )

                parts.extend([
                    "=" * 60,
                    f">>> {cmd}",
                    "=" * 60,
                    output,
                    "",
                ])

            # Step 7: graceful logout
            stdin.write(f"{vcfg['quit_cmd']}\n")
            stdin.close()

        final_output = "\n".join(parts)
        logger.info("Total collected: %d bytes", len(final_output))
        return final_output

    except Exception as exc:
        logger.error("collect_via_ssh EXCEPTION: %s", exc, exc_info=True)
        return f"[ERROR] {target_ip}: {repr(exc)}"


async def flush_stream(stdout, timeout: float = 0.2) -> None:
    """Flush any pending data in the stdout stream until a short timeout is reached."""
    while True:
        try:
            chunk = await asyncio.wait_for(stdout.read(4096), timeout=timeout)
            if not chunk:
                break
        except asyncio.TimeoutError:
            break


async def collect_via_telnet(jump_transport: AsyncJumpTransport, device: dict, command_type: str = "backup", use_jump_server: bool = True) -> str:
    target_ip = device["ip_address"]
    username  = device["username"]
    password  = device["password"]
    vendor    = device.get("vendor", "cisco")
    port      = int(device.get("port", 23))
    vcfg      = get_vendor_config(vendor)

    commands = device.get("custom_commands") or get_commands(vendor, device.get("selected_commands_source"), command_type=command_type)

    logger.info(
        "collect_via_telnet START — %s (%s) ip=%s commands=%d type=%s jump_mode=%s",
        device.get("hostname"), vendor, target_ip, len(commands), command_type, use_jump_server,
    )

    try:
        if use_jump_server and jump_transport:
            # Step 1: jump server connection
            jump_conn = await jump_transport.ensure_connection()
            logger.info("Jump server connection ready")

            # Step 2: open session on jump server with PTY
            logger.info("Opening session on jump server with PTY for telnet pivot...")
            stdin, stdout, stderr = await jump_conn.open_session(
                term_type="vt100",
                request_pty=True,
            )

            # Wait a tiny bit for shell prompt to initialize and flush the channel
            await asyncio.sleep(1.0)
            await flush_stream(stdout, timeout=0.2)

            # Step 3: Initiate telnet command
            telnet_cmd = f"telnet {target_ip} {port}"
            logger.info("Sending telnet command on jump shell: %s", telnet_cmd)
            stdin.write(f"{telnet_cmd}\n")
        else:
            logger.info("Direct Telnet connection mode active to %s:%d...", target_ip, port)
            reader, writer = await asyncio.wait_for(asyncio.open_connection(target_ip, port), timeout=15.0)
            direct_stream = DirectTelnetStream(reader, writer)
            stdin, stdout = direct_stream, direct_stream

        # Step 4: Login negotiation loop
        login_prompt = r"[Uu]ser(name)?[:\s]|[Ll]ogin[:\s]"
        password_prompt = r"[Pp]ass(word)?[:\s]"
        device_prompt = vcfg["prompt_pattern"]

        buf = ""
        deadline = time.time() + 30.0
        phase = "connecting"

        while time.time() < deadline:
            try:
                chunk = await asyncio.wait_for(stdout.read(4096), timeout=1.0)
                if not chunk:
                    break
                buf += chunk
            except asyncio.TimeoutError:
                # Timeout is fine, just lets us evaluate buffer and check deadline
                pass

            # Username prompt check
            if phase == "connecting" and username and re.search(login_prompt, buf, re.IGNORECASE):
                logger.info("Login prompt detected on %s — sending username", target_ip)
                stdin.write(f"{username}\n")
                buf = ""
                phase = "authenticating"
                await asyncio.sleep(1.0)
                continue

            # Password prompt check
            if phase == "authenticating" and password and re.search(password_prompt, buf, re.IGNORECASE):
                logger.info("Password prompt detected on %s — sending password", target_ip)
                stdin.write(f"{password}\n")
                buf = ""
                phase = "post-auth"
                await asyncio.sleep(1.0)
                continue

            # Device prompt check
            if re.search(device_prompt, buf):
                logger.info("Device CLI prompt detected on %s:%d — telnet ready", target_ip, port)
                break

        # Flush standard output buffer
        await asyncio.sleep(0.5)
        await flush_stream(stdout, timeout=0.2)

        parts = [
            f"=== Device: {device.get('hostname')} ===",
            f"=== IP: {target_ip} ===",
            f"=== Type: {command_type.upper()} ===",
            f"=== Protocol: TELNET ===",
            f"=== Time: {time.strftime('%Y-%m-%d %H:%M:%S')} ===\n",
        ]

        # Step 5: disable pagination
        if vcfg["paging_cmd"]:
            logger.info("Disabling pagination: %s", vcfg["paging_cmd"])
            stdin.write(f"{vcfg['paging_cmd']}\n")
            await read_until_prompt(stdout, vcfg["prompt_pattern"], timeout=15)

        # Step 6: run each command
        for idx, cmd in enumerate(commands, 1):
            logger.info("[%d/%d] Executing (Telnet): %s", idx, len(commands), cmd)
            t0 = time.time()

            stdin.write(f"{cmd}\n")
            raw = await read_until_prompt(stdout, vcfg["prompt_pattern"], timeout=COMMAND_TIMEOUT)
            elapsed = time.time() - t0

            output = clean_output(raw, cmd, vcfg["prompt_pattern"])

            logger.info(
                "[%d/%d] Done in %.1fs — %d lines",
                idx, len(commands), elapsed, len(output.splitlines()),
            )

            parts.extend([
                "=" * 60,
                f">>> {cmd}",
                "=" * 60,
                output,
                "",
            ])

        # Step 7: graceful logout
        stdin.write(f"{vcfg['quit_cmd']}\n")
        stdin.close()

        final_output = "\n".join(parts)
        logger.info("Total collected (Telnet): %d bytes", len(final_output))
        return final_output

    except Exception as exc:
        logger.error("collect_via_telnet EXCEPTION: %s", exc, exc_info=True)
        return f"[ERROR] {target_ip}: {repr(exc)}"


async def collect_from_device(jump_transport: AsyncJumpTransport, device: dict, command_type: str = "backup", use_jump_server: bool = True) -> dict:
    """Main entry point called by FastAPI."""
    protocol = device.get("protocol", "ssh").lower()
    hostname = device.get("hostname", device.get("ip_address", "unknown"))

    logger.info(
        "collect_from_device ENTER — hostname=%s protocol=%s type=%s jump_mode=%s",
        hostname, protocol, command_type, use_jump_server,
    )

    try:
        if protocol == "telnet":
            output = await collect_via_telnet(jump_transport, device, command_type, use_jump_server=use_jump_server)
        else:
            output = await collect_via_ssh(jump_transport, device, command_type, use_jump_server=use_jump_server)
    except Exception as exc:
        logger.error("collect_from_device EXCEPTION: %s", exc, exc_info=True)
        output = f"[ERROR] {repr(exc)}"

    output_lines = len(output.splitlines()) if output else 0
    output_chars = len(output) if output else 0
    logger.info(
        "collect_from_device EXIT — hostname=%s lines=%d chars=%d type=%s",
        hostname, output_lines, output_chars, command_type,
    )

    return {"device": hostname, "output": output, "type": command_type}

# ---------------------------------------------------------------------------
# Config push — ported from core/automation/executors/base.py's
# push_config_to_device (identical, proven logic) so that NETAct_backend is
# the single canonical place that ever opens a real device connection to
# change configuration, rather than that capability existing in two places.
# Automation/Ansible now call POST /devices/{id}/push-config on backend
# instead of connecting to devices directly.
# ---------------------------------------------------------------------------
DEVICE_USER = os.getenv("DEVICE_USER", "")
DEVICE_PASS = os.getenv("DEVICE_PASS", "")


async def push_config_to_device(jump_transport: "AsyncJumpTransport", device: dict, config_text: str, custom_creds: dict = None) -> dict:
    """Pushes a block of vendor CLI config lines to a device over the jump
    host, entering config mode, sending each line, then committing/saving
    per-vendor. Same behavior as the automation engine's version of this
    function — ported here so backend owns the one real write path."""
    target_ip = device["ip_address"]
    username = DEVICE_USER or device.get("username", "")
    password = DEVICE_PASS or device.get("password", "")

    if custom_creds and custom_creds.get("username"):
        username = custom_creds["username"]
        password = custom_creds.get("password", "")

    vendor = device.get("vendor", "cisco").lower()
    port = int(device.get("port", 22))
    protocol = device.get("protocol", "ssh").lower()

    logger.info("push_config START - %s (%s) via %s", device.get("hostname"), target_ip, protocol)
    session_log = []
    t0 = time.time()
    vcfg = get_vendor_config(vendor)

    try:
        if protocol == "telnet":
            jump_conn = await jump_transport.ensure_connection()
            stdin, stdout, stderr = await jump_conn.open_session(term_type="vt100", request_pty=True)
            await asyncio.sleep(1.0)

            while True:
                try:
                    chunk = await asyncio.wait_for(stdout.read(4096), timeout=0.1)
                    if not chunk:
                        break
                except asyncio.TimeoutError:
                    break

            stdin.write(f"telnet {target_ip} {port}\n")
            session_log.append(f"JumpServer$ telnet {target_ip} {port}")

            login_prompt = r"[Uu]ser(name)?[:\s]|[Ll]ogin[:\s]"
            password_prompt = r"[Pp]ass(word)?[:\s]"
            device_prompt = vcfg["prompt_pattern"]

            buf = ""
            deadline = time.time() + 20.0
            phase = "connecting"

            while time.time() < deadline:
                try:
                    chunk = await asyncio.wait_for(stdout.read(4096), timeout=0.5)
                    if not chunk:
                        break
                    buf += chunk
                    session_log.append(chunk)
                except asyncio.TimeoutError:
                    pass

                if phase == "connecting" and username and re.search(login_prompt, buf, re.IGNORECASE):
                    stdin.write(f"{username}\n")
                    buf = ""
                    phase = "authenticating"
                    await asyncio.sleep(0.5)
                    continue
                if phase == "authenticating" and password and re.search(password_prompt, buf, re.IGNORECASE):
                    stdin.write(f"{password}\n")
                    buf = ""
                    phase = "post-auth"
                    await asyncio.sleep(0.5)
                    continue
                if re.search(device_prompt, buf):
                    break

            if vcfg["paging_cmd"]:
                stdin.write(f"{vcfg['paging_cmd']}\n")
                await read_until_prompt(stdout, vcfg["prompt_pattern"], timeout=5)

            cfg_enter = "system-view" if "huawei" in vendor else "configure terminal"
            stdin.write(f"{cfg_enter}\n")
            session_log.append(f"\nDevice> {cfg_enter}")
            await read_until_prompt(stdout, vcfg["prompt_pattern"], timeout=5)

            for line in config_text.splitlines():
                if line.strip() and not line.strip().startswith("#"):
                    stdin.write(f"{line}\n")
                    session_log.append(f"\nDevice(config)> {line}")
                    raw_out = await read_until_prompt(stdout, vcfg["prompt_pattern"], timeout=10)
                    session_log.append(raw_out)

            if "huawei" in vendor.lower():
                cfg_exit = "commit\nreturn"
            elif "xr" in vendor.lower():
                cfg_exit = "commit\nend"
            else:
                cfg_exit = "end\nwrite memory"
            stdin.write(f"{cfg_exit}\n")
            session_log.append(f"\nSaving configs...")
            raw_out = await read_until_prompt(stdout, vcfg["prompt_pattern"], timeout=10)
            session_log.append(raw_out)

            stdin.write(f"exit\n")
            stdin.close()

        else:  # SSH via asyncssh tunnel
            jump_conn = await jump_transport.ensure_connection()
            device_conn = await asyncssh.connect(
                target_ip,
                port=port,
                username=username,
                password=password,
                known_hosts=None,
                client_keys=[],
                tunnel=jump_conn,
            )

            async with device_conn:
                stdin, stdout, stderr = await device_conn.open_session(
                    term_type=vcfg["term_type"],
                    request_pty=vcfg["request_pty"],
                )

                banner = await read_until_prompt(stdout, vcfg["prompt_pattern"], timeout=15)
                session_log.append(banner)

                if vcfg["paging_cmd"]:
                    stdin.write(f"{vcfg['paging_cmd']}\n")
                    await read_until_prompt(stdout, vcfg["prompt_pattern"], timeout=5)

                cfg_enter = "system-view" if "huawei" in vendor else "configure terminal"
                stdin.write(f"{cfg_enter}\n")
                session_log.append(f"\nDevice> {cfg_enter}")
                await read_until_prompt(stdout, vcfg["prompt_pattern"], timeout=5)

                for line in config_text.splitlines():
                    if line.strip() and not line.strip().startswith("#"):
                        stdin.write(f"{line}\n")
                        session_log.append(f"\nDevice(config)> {line}")
                        raw_out = await read_until_prompt(stdout, vcfg["prompt_pattern"], timeout=15)
                        session_log.append(raw_out)

                if "huawei" in vendor.lower():
                    cfg_exit = "commit\nreturn"
                elif "xr" in vendor.lower():
                    cfg_exit = "commit\nend"
                else:
                    cfg_exit = "end\nwrite memory"
                stdin.write(f"{cfg_exit}\n")
                session_log.append(f"\nSaving configs...")
                raw_out = await read_until_prompt(stdout, vcfg["prompt_pattern"], timeout=15)
                session_log.append(raw_out)

                stdin.write(f"exit\n")
                stdin.close()

        elapsed = time.time() - t0
        raw_session = "".join([str(x) for x in session_log])
        return {
            "status": "success",
            "duration": elapsed,
            "session_log": raw_session,
        }
    except Exception as e:
        logger.error("Failed pushing configs to %s: %s", target_ip, e, exc_info=True)
        return {
            "status": "failed",
            "duration": time.time() - t0,
            "error": str(e),
            "session_log": "".join([str(x) for x in session_log]) + f"\n\n[PUSH FAIL EXCEPTION]: {repr(e)}",
        }
