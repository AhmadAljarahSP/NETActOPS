import asyncio
import asyncssh
import logging

logger = logging.getLogger("async_jump_transport")

class AsyncJumpTransport:
    """
    Manages an async SSH connection to a jump server.
    Provides tunnelled connections for Scrapli.
    """
    def __init__(self, host, username, password, port=22):
        self.host = host
        self.username = username
        self.password = password
        self.port = port
        self._conn = None
        self._lock = asyncio.Lock()

    async def ensure_connection(self):
        async with self._lock:
            # Check if connection is None or has been closed/dropped
            if self._conn is not None and self._conn.is_closed:
                logger.info("Jump server connection was closed or dropped. Resetting...")
                self._conn = None

            if self._conn is None:
                logger.info(f"Connecting to jump server {self.host}...")
                self._conn = await asyncio.wait_for(
                    asyncssh.connect(
                        self.host,
                        port=self.port,
                        username=self.username,
                        password=self.password,
                        known_hosts=None  # In a production environment, you should use known_hosts
                    ),
                    timeout=5.0
                )
                # Set keep-alive every 10 seconds to prevent idle timeout drops (permanently resilient)
                self._conn.set_keepalive(interval=10, count_max=3)
                logger.info(f"Connected to jump server {self.host} (keepalives enabled)")
            return self._conn

    async def open_tunnel(self, dest_host, dest_port):
        """
        Opens a tunnel to a destination host/port via the jump server.
        Returns a pair of (reader, writer) that can be used by Scrapli.
        """
        conn = await self.ensure_connection()
        return await conn.open_connection(dest_host, dest_port)

    async def close(self):
        async with self._lock:
            if self._conn:
                self._conn.close()
                await self._conn.wait_closed()
                self._conn = None
                logger.info("Jump server connection closed")
