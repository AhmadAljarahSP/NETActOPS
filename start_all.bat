@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================================
echo  NETAct Full Stack Startup
echo  Start order: Core -^> AI + Topology -^> Knowledge -^> Monitoring
echo ============================================================
echo.

REM ---------------------------------------------------------------------
REM 0. Prerequisite checks
REM ---------------------------------------------------------------------
where docker >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  echo ERROR: docker is not installed or not on PATH. Install Docker Desktop first.
  pause
  exit /b 1
)

docker info >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  echo ERROR: Cannot talk to the Docker daemon. Start Docker Desktop and try again.
  pause
  exit /b 1
)

REM ---------------------------------------------------------------------
REM 1. First-run .env setup
REM ---------------------------------------------------------------------
if exist ".env" goto ENV_OK
echo ------------------------------------------------------------
echo  No .env found — copying .env.example to .env
echo ------------------------------------------------------------
copy /Y ".env.example" ".env" >nul
echo.
echo A new .env has been created from .env.example.
echo Please open it now and fill in: USE_JUMP_SERVER, JUMP_HOST, JUMP_USER, JUMP_PASSWORD,
echo DEVICE_USER, DEVICE_PASS, APP_PASSWORD, and ENCRYPTION_KEY at minimum.
echo.
echo Generate ENCRYPTION_KEY with (in WSL/Git Bash/PowerShell with Python):
echo   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
echo.
echo Then re-run this script.
notepad ".env"
pause
exit /b 0

:ENV_OK

REM ---------------------------------------------------------------------
REM 2. TLS certificate for the frontend (nginx) — self-signed if missing
REM ---------------------------------------------------------------------
if exist "DeepConsol\certs\server.crt" goto CERT_OK
echo ------------------------------------------------------------
echo  No TLS certificate found for the web UI — generating...
echo ------------------------------------------------------------
set "OPENSSL_CMD=openssl"
where openssl >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  if exist "%PROGRAMFILES%\Git\usr\bin\openssl.exe" (
    set "OPENSSL_CMD=%PROGRAMFILES%\Git\usr\bin\openssl.exe"
  ) else if exist "%PROGRAMFILES(x86)%\Git\usr\bin\openssl.exe" (
    set "OPENSSL_CMD=%PROGRAMFILES(x86)%\Git\usr\bin\openssl.exe"
  ) else if exist "%USERPROFILE%\AppData\Local\Programs\Git\usr\bin\openssl.exe" (
    set "OPENSSL_CMD=%USERPROFILE%\AppData\Local\Programs\Git\usr\bin\openssl.exe"
  ) else (
    echo ERROR: openssl was not found on PATH or in Git directories. Generate DeepConsol\certs\server.crt manually.
    pause
    exit /b 1
  )
)

if not exist "DeepConsol\certs" mkdir "DeepConsol\certs"
"%OPENSSL_CMD%" req -x509 -newkey rsa:2048 -nodes -keyout "DeepConsol\certs\server.key" -out "DeepConsol\certs\server.crt" -days 825 -subj "/CN=netact.local" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" 2>nul
echo Certificate generated.
echo.

:CERT_OK

REM ---------------------------------------------------------------------
REM 3. Start all stacks
REM ---------------------------------------------------------------------
echo [1/5] Core Platform (creates shared volume + network)...
docker compose -f docker-compose.core.yml up -d --build
if %ERRORLEVEL% NEQ 0 (
  echo ERROR: Core failed. Aborting.
  pause
  exit /b 1
)
echo Core OK.
echo.

echo [2/5] AI Stack (ollama, qdrant, copilot)...
docker compose -f docker-compose.ai.yml up -d --build
echo.

echo [3/5] Topology Stack...
docker compose -f docker-compose.topology.yml up -d --build
echo.

echo [4/5] Knowledge Stack (brain importer + obsidian)...
docker compose -f docker-compose.knowledge.yml up -d --build
echo.

echo [5/5] Monitoring Stack (prometheus + grafana)...
docker compose -f docker-compose.monitoring.yml up -d
echo.

echo ============================================================
echo  All stacks started. Service endpoints:
echo ============================================================
echo   NETAct GUI         : https://localhost:3000
echo   Backend API        : http://localhost:8000
echo   Automation API     : http://localhost:8003
echo   MCP Server         : http://localhost:5001
echo   Topology           : http://localhost:3001
echo   Copilot AI         : http://localhost:8011
echo   Copilot Backend    : http://localhost:8010
echo   Obsidian Web       : http://localhost:8085
echo   Ollama             : http://localhost:11434
echo   Qdrant             : http://localhost:6333
echo   Prometheus         : http://localhost:9090
echo   Grafana            : http://127.0.0.1:3002
echo ============================================================
echo  First visit to the GUI: choose your own admin username and
echo  password there to create your account (there's no default account).
echo.
echo  The device inventory ships empty — add devices from the
echo  Inventory page once you're logged in.
echo ============================================================
pause
