# NETAct — Operational Runbooks & Troubleshooting Guide

This document provides step-by-step troubleshooting procedures for network engineers and system operators running NETAct in production.

---

## 1. SSH & Bastion Jump Host Failures

### Symptom:
Device health checks or backups fail with `SSH connection timeout` or `Authentication failed (jump_host)`.

### Diagnostic Steps:
1. Verify `JUMP_HOST`, `JUMP_USER`, and `JUMP_PASSWORD` in `.env`.
2. Test SSH connectivity from inside the `backend` container directly to the jump host:
   ```bash
   docker exec -it NETAct_backend ssh -o ConnectTimeout=5 testuser@test-jump.example.com
   ```
3. Check backend container logs:
   ```bash
   netact logs backend --tail 50
   ```

### Resolution:
Update `.env` with correct bastion credentials and execute:
```bash
docker compose -f docker-compose.core.yml restart backend automation
```

---

## 2. Qdrant Vector Sync & Ollama Embedding Recovery

### Symptom:
AI Copilot responses state `"Knowledge Base embedding unavailable"` or Qdrant search returns 0 results.

### Diagnostic Steps:
1. Check if Ollama has downloaded `nomic-embed-text`:
   ```bash
   docker exec NETAct_ollama ollama list
   ```
   If `nomic-embed-text` is missing, pull it manually:
   ```bash
   docker exec NETAct_ollama ollama pull nomic-embed-text
   ```

2. Check Qdrant collection status:
   ```bash
   curl -s http://localhost:6333/collections/netact_knowledgebase
   ```

3. Force a fresh vector sync pass:
   ```bash
   curl -X POST http://localhost:8010/api/copilot/sync -H "X-Api-Key: YOUR_APP_PASSWORD"
   ```

---

## 3. Workflow Rollback & Playbook Failure Recovery

### Symptom:
A visual workflow fails mid-execution and the network device is left in a partial configuration state.

### Diagnostic Steps:
1. View task execution status:
   ```bash
   netact workflow status <task_id>
   ```
2. Open the web UI at `/automation` and inspect the node execution timeline.
3. Check the version-controlled Git baseline backup in `/git/repo`.

### Resolution:
Execute manual rollback via the UI or CLI:
```bash
netact workflow run rollback-device --device-id CORE-RTR-01
```

---

## 4. Resetting Secrets & API Passwords

### How to reset `APP_PASSWORD`:
1. Edit `.env` and update `APP_PASSWORD=new_password_here`.
2. Restart Core and AI stacks:
   ```bash
   docker compose -f docker-compose.core.yml restart
   docker compose -f docker-compose.ai.yml restart
   ```

### How to regenerate `ENCRYPTION_KEY`:
```python
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```
Copy the generated key into `ENCRYPTION_KEY=` in `.env`.
