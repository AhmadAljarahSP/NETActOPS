# Stop existing core containers
docker compose -f docker-compose.core.yml down

# Rebuild with new changes
docker compose -f docker-compose.core.yml build

# Start fresh
docker compose -f docker-compose.core.yml up -d

# Check git directory structure
docker exec NETAct_git ls -la /git/repo/
docker exec NETAct_git ls -la /git/repo/backups/
docker exec NETAct_git ls -la /git/repo/healthchecks/

# Test API
curl http://localhost:8000/health