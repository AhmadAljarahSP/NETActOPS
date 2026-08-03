@echo off
echo Stopping all NETAct stacks...
docker compose -f docker-compose.monitoring.yml down
docker compose -f docker-compose.knowledge.yml down
docker compose -f docker-compose.topology.yml down
docker compose -f docker-compose.ai.yml down
docker compose -f docker-compose.core.yml down
echo All stacks stopped.
pause
