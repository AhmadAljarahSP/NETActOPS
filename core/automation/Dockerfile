FROM python:3.12-slim

# Install system dependencies including git
# sshpass is required by Ansible's network_cli/paramiko connections when
# authenticating with a password (ansible_password) rather than an SSH key,
# which is how every device in this project's inventory currently connects.
RUN apt-get update && apt-get install -y \
    openssh-client \
    sshpass \
    netcat-openbsd \
    iputils-ping \
    curl \
    git \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Ansible network automation layer (see ansible/README.md). Installed at
# build time so the container always has it ready — nothing here executes
# anything against a device; ansible-core and the collections are just
# made available for an operator to invoke deliberately later.
RUN pip install --no-cache-dir "ansible-core>=2.16,<2.18" netaddr jxmlease ncclient paramiko

COPY ansible/requirements.yml /app/ansible/requirements.yml
RUN ansible-galaxy collection install -r /app/ansible/requirements.yml

# Local, unpublished collection (core/automation/ansible/collections_src/) —
# wraps NETAct_backend's SOLIDserver IPAM gateway as native modules
# (netact.solidserver.ipam_read / ipam_write). Built from source and
# installed the same way any Galaxy collection would be, so it shows up
# identically in `ansible-galaxy collection list`; it just isn't fetched
# from a remote index. See ansible/collections_src/netact/solidserver/README.md.
COPY ansible/collections_src /app/ansible/collections_src
RUN ansible-galaxy collection build /app/ansible/collections_src/netact/solidserver \
      --output-path /tmp/collection_build --force \
 && ansible-galaxy collection install /tmp/collection_build/netact-solidserver-*.tar.gz --force \
 && rm -rf /tmp/collection_build

# In development, the /app directory will be mounted as a volume.
# Copy is there as a fallback for standalone container builds.
COPY . .

EXPOSE 8003

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8003"]
