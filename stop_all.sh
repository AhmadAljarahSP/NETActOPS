#!/bin/bash
echo "Stopping all NETAct stacks..."

# Resolve current directory of the script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

docker compose -f docker-compose.monitoring.yml down
docker compose -f docker-compose.knowledge.yml down
docker compose -f docker-compose.topology.yml down
docker compose -f docker-compose.ai.yml down
docker compose -f docker-compose.core.yml down

echo "All stacks stopped."
