@echo off
echo [1/1] Starting Core Platform (git, backend, automation, frontend, mcp-server)...
docker compose -f docker-compose.core.yml up -d --build
echo.
echo Core stack running. Ports:
echo   NETAct GUI      : https://localhost:3000
echo   Backend API     : http://localhost:8000
echo   Git API         : http://localhost:8002
echo   Automation API  : http://localhost:8003
echo   MCP Server      : http://localhost:5001
