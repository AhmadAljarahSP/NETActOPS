#!/bin/bash
cd ~/NETAct/NETActgit
docker compose \
  -f docker-compose.core.yml \
  -f docker-compose.ai.yml \
  -f docker-compose.topology.yml \
  -f docker-compose.knowledge.yml \
  -f docker-compose.monitoring.yml \
  down -v --rmi all --remove-orphans