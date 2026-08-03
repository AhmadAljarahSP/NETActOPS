FROM python:3.11-slim

WORKDIR /app

# Install system dependencies (git, ssh client, curl)
RUN apt-get update && apt-get install -y \
    git \
    openssh-client \
    curl \
    && rm -rf /var/lib/apt/lists/*

ENV PIP_TIMEOUT=120
ENV PIP_RETRIES=5

COPY requirements.txt .
# Layer 1: core requirements (with retry for corporate proxy)
RUN pip install --upgrade pip --quiet && \
    for i in 1 2 3 4 5; do \
        if pip install \
            --trusted-host pypi.org \
            --trusted-host files.pythonhosted.org \
            --trusted-host pypi.python.org \
            --no-cache-dir \
            --timeout 120 \
            -r requirements.txt; then \
            break; \
        fi; \
        if [ $i -eq 5 ]; then \
            echo "pip requirements install failed after 5 attempts"; \
            exit 1; \
        fi; \
        echo "pip attempt $i failed, retrying in 10s..." && sleep 10; \
    done

# Layer 2: asyncssh installed without its heavy Twisted transitive deps
# (asyncssh is pure-Python; cryptography is pre-installed by mcp above)
RUN for i in 1 2 3 4 5; do \
        if pip install \
            --trusted-host pypi.org \
            --trusted-host files.pythonhosted.org \
            --trusted-host pypi.python.org \
            --no-cache-dir \
            --no-deps \
            --timeout 120 \
            "asyncssh>=2.14.0"; then \
            break; \
        fi; \
        if [ $i -eq 5 ]; then \
            echo "asyncssh install failed after 5 attempts"; \
            exit 1; \
        fi; \
        echo "asyncssh attempt $i failed, retrying..." && sleep 10; \
    done


COPY . .

EXPOSE 5001

# Default command runs as SSE server on port 5001
CMD ["python", "server.py", "sse"]
