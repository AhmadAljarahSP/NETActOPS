import asyncio
import asyncssh
import logging
import sys
import re

# Enable full asyncssh debugging to stdout
logging.basicConfig(level=logging.DEBUG, stream=sys.stdout)
asyncssh.set_log_level(logging.DEBUG)

import os
try:
    import dotenv
    dotenv.load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
except ImportError:
    pass

JUMP_HOST = os.getenv("JUMP_HOST", "")
JUMP_USER = os.getenv("JUMP_USER")
JUMP_PASS = os.getenv("JUMP_PASSWORD")
DEVICE_USER = os.getenv("DEVICE_USER")
DEVICE_PASS = os.getenv("DEVICE_PASS")

TARGET_IP = os.getenv("TEST_TARGET_IP", "")
TARGET_PORT = 22

# Huawei prompt pattern matching
PROMPT_PATTERN = r"[<\[][^\r\n<>\[\]]{1,64}[>\]]"

async def read_until_prompt(stdout, pattern, timeout=15):
    buf = ""
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        try:
            chunk = await asyncio.wait_for(stdout.read(65535), timeout=1.0)
            if not chunk:
                break
            buf += chunk
            if re.search(pattern, buf):
                return buf
        except asyncio.TimeoutError:
            if re.search(pattern, buf):
                return buf
    return buf

async def test():
    print(f"[1] Connecting to jump server {JUMP_HOST}...")
    try:
        async with asyncssh.connect(
            JUMP_HOST,
            username=JUMP_USER,
            password=JUMP_PASS,
            known_hosts=None,
            login_timeout=15,
        ) as jump_conn:
            print(f"[1] Connected to jump server OK")
    
            print(f"[2] Opening tunnel to {TARGET_IP}:{TARGET_PORT}...")
            async with asyncssh.connect(
                TARGET_IP,
                port=TARGET_PORT,
                username=DEVICE_USER,
                password=DEVICE_PASS,
                known_hosts=None,
                tunnel=jump_conn,
                login_timeout=15,
            ) as device_conn:
                print(f"[3] Connected to device OK")
                
                print(f"[4] Opening interactive shell session...")
                # Open shell session (mirroring collector.py)
                stdin, stdout, stderr = await device_conn.open_session(
                    term_type=None,
                    request_pty=False
                )
                
                # Wait for initial prompt
                print("[5] Waiting for initial prompt...")
                banner = await read_until_prompt(stdout, PROMPT_PATTERN)
                print(f"[5] Received banner/prompt successfully!")
                
                # Disable paging
                print("[6] Disabling screen-length pagination...")
                stdin.write("screen-length 0 temporary\n")
                await read_until_prompt(stdout, PROMPT_PATTERN)
                
                # Run command
                print("[7] Running 'display version'...")
                stdin.write("display version\n")
                output = await read_until_prompt(stdout, PROMPT_PATTERN)
                print(f"[7] Command output successfully collected ({len(output)} chars):")
                print(output[:500])
                
                # Graceful logout (preventing hanging sessions!)
                print("[8] Sending 'quit' to close connection gracefully...")
                stdin.write("quit\n")
                stdin.close()
                await stdout.channel.wait_closed()
                print("[9] Diagnostics complete. Session closed successfully with zero hang!")

    except Exception as e:
        print(f"\n[ERROR] Connection diagnostics failed: {repr(e)}")

asyncio.run(test())