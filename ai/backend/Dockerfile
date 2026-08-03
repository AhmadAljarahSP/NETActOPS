FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    curl \
    git \
 && rm -rf /var/lib/apt/lists/*

ENV PIP_TIMEOUT=120
ENV PIP_RETRIES=5

COPY requirements.txt .
RUN pip install --upgrade pip --quiet && \
    for i in 1 2 3 4 5; do \
        pip install \
            --trusted-host pypi.org \
            --trusted-host files.pythonhosted.org \
            --trusted-host pypi.python.org \
            --no-cache-dir \
            --timeout 120 \
            -r requirements.txt \
        && break \
        || echo "pip attempt $i failed, retrying in 10s..." && sleep 10; \
    done

COPY . .

EXPOSE 8002

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8002"]
