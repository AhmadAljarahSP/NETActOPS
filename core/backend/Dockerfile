FROM python:3.12-slim

# Install system dependencies including git
RUN apt-get update && apt-get install -y \
    openssh-client \
    netcat-openbsd \
    iputils-ping \
    curl \
    git \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --trusted-host pypi.org --trusted-host pypi.python.org --trusted-host files.pythonhosted.org -r requirements.txt

COPY . .

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]