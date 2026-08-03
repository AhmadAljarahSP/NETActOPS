# NETAct Ansible Automation Layer

## Status: built and validated, **never executed against real infrastructure**

Every file in this directory was written and syntax-validated
(`ansible-playbook --syntax-check` — YAML structure + module argument specs
only) but **no playbook here has ever been run against a live device**.
`ansible-galaxy collection list` and the `/ansible/flows/*/syntax-check`
results confirming this are reproducible at any time via the endpoints below.

## Architecture: Ansible never touches a device — only NETAct_backend does

This was corrected from an earlier version of this layer that had Ansible
connecting directly to devices (network_cli/netconf, holding real device
credentials). That's gone. **Every task in every playbook here runs
`connection: local` and calls back into NETAct_backend's own gateway
endpoints** — `POST /devices/{id}/run-command` for read-only diagnostics,
`POST /devices/{id}/push-config` for config writes. Ansible holds zero
device credentials anywhere in this tree; `group_vars/all.yml` only knows
backend's URL and API key.

Why: backend is the one place command sanitization already exists and is
proven (mirrors `core/mcp_server/server.py`'s `run_device_diagnostic` —
same forbidden-keyword blocklist, same vendor CLI-prefix enforcement). A
second caller opening its own direct connections would bypass that
entirely. Now it can't — `run-command` rejects `reload`/`reboot`/
`shutdown`/`configure`/etc. outright before anything reaches a device,
regardless of which layer is calling it.

```
Ansible playbook (connection: local)
        │  ansible.builtin.uri, X-Api-Key header
        ▼
NETAct_backend  POST /devices/{id}/run-command   (sanitized, read-only)
                POST /devices/{id}/push-config    (write, logged)
        │  collector.py: collect_from_device() / push_config_to_device()
        ▼
   jump host (JUMP_HOST) → real device
```

Also additive, not a replacement: the existing hand-built async SSH engine
(`core/automation/executors/`, `/run-flow`, the visual ReactFlow builder)
is untouched and still what actually drives it.

## Layout

```
ansible/
  ansible.cfg              # points at inventory/dynamic_inventory.py
  requirements.yml          # vendor collections (see below) — currently
                             # unused by the rewritten playbooks (no vendor
                             # modules connect directly anymore) but kept
                             # installed/available for any future custom
                             # flow that needs one, and installable/
                             # extendable live via POST /ansible/collections/install
  inventory/
    dynamic_inventory.py    # pulls hosts + netact_device_id live from
                             # GET /devices — no separate, driftable list
  group_vars/
    all.yml                 # netact_backend_url + netact_app_password ONLY.
                             # No device credentials, no connection plugin,
                             # no jump-host proxy — none of that lives in
                             # Ansible anymore.
    cisco_iosxr.yml          # just a netact_vendor_label per group now
    cisco_ios.yml
    junos.yml
    huawei.yml               # CLI-over-SSH via backend now, NOT NETCONF
                              # (backend's push_config_to_device enters
                              # "system-view" automatically for Huawei)
    arista_eos.yml           # no hosts yet
    f5.yml                   # netact_reachable_via_backend: false — REST/
                              # iControl device, backend's gateway is
                              # CLI-over-SSH only, honestly not wired yet
    cisco_aci.yml             # same caveat as f5.yml — REST/APIC-based
  playbooks/                # the "custom flows" — all backend-routed now
    gather_facts.yml         # read-only: show/display version
    healthcheck_facts.yml    # read-only: interfaces, BGP/OSPF neighbor status
    backup_config.yml        # orchestrates backend's EXISTING POST
                              # /backup/{id} — reuses it, doesn't reimplement
    push_bgp_config.yml      # WRITE — parameterized, asserts required vars
    push_ospf_config.yml     # WRITE — parameterized, asserts required vars
    solidserver_ipam_read.yml   # read-only: generic IPAM query pass-through
    solidserver_ipam_write.yml  # WRITE — generic IPAM write pass-through
    solidserver_dns_read.yml    # read-only: generic DNS query pass-through
    solidserver_dns_write.yml   # WRITE — generic DNS write pass-through
    solidserver_dns_manage.yml  # WRITE — full workflow: pre-check, TSIG,
                                 # view, zone, records, DNSSEC, verify
  examples/                 # focused single-purpose playbooks using the
                             # netact.solidserver collection's module
                             # syntax — NOT registered flows (kept out of
                             # GET /ansible/flows on purpose), see its own
                             # README.md
    dns_create_view.yml
    dns_create_zone.yml
    dns_add_record.yml
    dns_deploy_tsig_key.yml
    dns_sign_dnssec.yml
    ipam_reserve_and_register.yml
  collections_src/          # source for LOCAL (unpublished) collections —
                             # built + installed into the image at build
                             # time, same pipeline a Galaxy collection uses
    netact/solidserver/     # netact.solidserver — native modules wrapping
                             # the same backend IPAM/DNS gateways as the
                             # playbooks above (see its own README.md)
      galaxy.yml
      README.md
      CHANGELOG.rst
      meta/runtime.yml
      plugins/
        modules/ipam_read.py
        modules/ipam_write.py
        modules/dns_read.py
        modules/dns_write.py
        module_utils/backend_gateway.py
  README.md
```

## Vendor collections (`requirements.yml`)

Installed and available (`GET /ansible/collections` to verify), and
extendable at runtime via `POST /ansible/collections/install` (also
persisted back to `requirements.yml` so it survives a rebuild):
`cisco.iosxr`, `cisco.ios`, `cisco.nxos`, `cisco.aci`,
`junipernetworks.junos`, `arista.eos`, `f5networks.f5_modules`,
`ansible.netcommon`, `community.network`, `ansible.utils`. None of these
are actually invoked by the current playbooks (they all go through
backend's `uri` gateway instead) — they're here for any future custom flow
that does need a vendor module directly, and for parity with what a
network-automation Ansible setup is normally expected to have available.

## Vendor CLI syntax used by the write playbooks

Real, verified syntax (Huawei confirmed directly against the vendor's own
NE9000 config guide during this project's KB ingestion; Cisco/Junos are
standard, well-known syntax) — backend's `push_config_to_device` enters
config mode (`system-view` for Huawei, `configure terminal` otherwise) and
commits/saves (`commit`+`return`/`end` or `end`+`write memory`)
automatically; playbooks only supply the inner lines:

| Vendor | BGP | OSPF |
|---|---|---|
| Huawei | `bgp <as>` / `peer <ip> as-number <as>` | `ospf <id>` / `area <area>` / `network <ip> <wildcard>` |
| Cisco IOS-XR | `router bgp <as>` / `neighbor <ip> remote-as <as>` | `router ospf <id>` / `area <area>` / `network <ip>/<prefixlen>` |
| Cisco IOS | `router bgp <as>` / `neighbor <ip> remote-as <as>` | `router ospf <id>` / `network <ip> <wildcard> area <area>` |
| Juniper | **not implemented** — see note below | **not implemented** |

**Juniper is intentionally excluded from the write playbooks.** Backend's
`push_config_to_device` enters/exits config mode in a way that's
Cisco/Huawei-shaped (`configure terminal` / `end`) and doesn't match
Junos's actual paradigm (`configure` + `set ...` statements + `commit`).
This is a real, pre-existing gap in the function being reused — generating
config that *looks* right but would misbehave on a real Junos device would
be worse than leaving it out. Junos write support needs
`push_config_to_device` to grow a real branch first; read-only Junos
diagnostics (`gather_facts`, `healthcheck_facts`) work fine today since
those are just single show commands, no config-mode sequencing involved.

## SOLIDserver IPAM/DNS integration

`solidserver_ipam_read.yml` / `_write.yml` and `solidserver_dns_read.yml`
/ `_write.yml` are generic pass-throughs to appliance-level gateways on
backend (`core/backend/ipam_solidserver.py` + `dns_solidserver.py`,
`POST /ipam/solidserver/read|write` and `/dns/solidserver/read|write`)
for an EfficientIP SOLIDserver appliance. `solidserver_dns_manage.yml` is
a full provisioning workflow built on top of the DNS gateway (pre-check
server → optional TSIG key → view → zone → records → optional DNSSEC
signing → verify). Same rule as everywhere else in this layer: Ansible
never talks to the appliance directly.

Backend talks to the appliance via `core/backend/solidserver_client.py`
— **direct REST calls, no SDK**. An earlier version of this integration
depended on the third-party `SOLIDserverRest` Python library, which
carried its own internal service-name translation table and HTTP-verb
heuristic; what request it actually sent wasn't obvious without reading
the SDK's own source. Backend now constructs the exact URL
(`https://<host>/<rest-or-rpc>/<service>`) and picks the exact HTTP verb
itself, per the reference guide's own Table 2.1 (`POST`=create,
`PUT`=edit, `GET`=list/info/count, `DELETE`=delete), authenticating with
`X-IPM-Username`/`X-IPM-Password` (base64-encoded). None of this is
something to upload through "Upload a Custom Flow" — that endpoint only
accepts single `.yml` playbooks, and a Python SDK/client isn't one.

All four generic playbooks take `sds_method` (+ `sds_params` as a JSON
string, + `sds_edit: true` on write to issue `PUT` instead of `POST`) as
extra-vars and forward them verbatim to backend, which checks `sds_method`
against an explicit allowlist before doing anything else — an allowlist,
not a blocklist, because this is a structured method+params API rather
than free-text CLI:

| | Read | Write |
|---|---|---|
| IPAM (`solidserver_ipam_*.yml`) | `ip_site_list`, `ip_site_info`, `ip_block_subnet_list`, `ip_block_subnet_info`, `ip_find_free_subnet`, `ip_address_list`, `ip_address_info`, `ip_find_free_address` | `ip_site_add`, `ip_site_delete`, `ip_subnet_add`, `ip_subnet_delete`, `ip_add`, `ip_delete` |
| DNS (`solidserver_dns_*.yml`) | `dns_server_list/_info/_count`, `dns_view_list/_info/_count`, `dns_view_param_list/_info/_count`, `dns_zone_list/_info/_count`, `dns_zone_param_list/_info/_count`, `dns_rr_list/_info/_count`, `dns_acl_list/_info/_count`, `dns_key_list/_info/_count`, `dnssec_zone_keys_list/_info` | `dns_view_add/_delete`, `dns_view_param_add/_delete`, `dns_zone_add/_delete`, `dns_zone_param_add/_delete`, `dns_rr_add/_delete`, `dns_acl_add/_delete`, `dns_key_add/_delete`, `dnssec_enable_sign_zone` |

Method names and their Mandatory Input Parameters are verified against
EfficientIP's own **"SOLIDserver API: REST Reference Guide", version 7.3,
revision #100648** — Part II "IPAM Services" (chapters 5, 6, 10) and Part
IV "DNS Services" (chapters 33-39) — not guessed, and not inferred from
any SDK's internal naming. That distinction mattered in practice: an
earlier version of this integration *did* infer IPAM names from the SDK
source and got several wrong (see `collections_src/netact/solidserver/
CHANGELOG.rst`'s v1.1.0 entry for the full list). `GET
/ipam/solidserver/methods` and `GET /dns/solidserver/methods` on backend
serve the same reference data (allowed methods + required params) live,
so this never has to be re-derived from the PDF again. Full per-method
parameter tables live in `collections_src/netact/solidserver/README.md`.

Deliberately **not** included in the DNS allowlist: `dns_add`/`dns_delete`
(provisions/decommissions a physical DNS server entry — a distinct,
higher-risk infrastructure operation) and `group_dnsview_add`/
`group_dnszone_add` (assigns a view/zone to a user group's resources —
access control, not DNS content).

**Not yet configured** — `SOLIDSERVER_HOST`, `SOLIDSERVER_USER`,
`SOLIDSERVER_PASSWORD` are unset in backend's environment by design (no
appliance wired up yet); every endpoint returns `503` until they're set.
The allowlist check runs *before* the configured-check, so a disallowed
`sds_method` still gets `400` either way, not a misleading `503`.

**Known limitation:** the appliance isn't a "device" in NETAct's
registry, so these playbooks still run through the same per-device
`hosts: all` / `--limit` targeting every other playbook here uses — when
launched from the visual designer, select exactly one device in the
node's Device Select step to satisfy that requirement; the IPAM/DNS call
itself doesn't touch that device at all. The extra-vars form the designer
generates also only covers the method itself (from the `assert` clause)
— `sds_params` needs a JSON string typed in by hand for now.

### `netact.solidserver` — companion Ansible collection

Alongside the generic `uri`-based playbooks above, `collections_src/netact/
solidserver/` is a real, local Ansible collection providing native
modules — `ipam_read`/`ipam_write`/`dns_read`/`dns_write` — for anyone
writing custom playbooks by hand instead of a raw `uri` task. See
`ansible/examples/` for real usage of each one. Built and installed the
same way any Galaxy collection would be (`ansible-galaxy collection
build` + `install`, wired into the Dockerfile so it survives a rebuild),
so it shows up identically in `ansible-galaxy collection list` even
though it isn't fetched from a remote index. See `collections_src/netact/
solidserver/README.md` for full module docs and per-method parameter
tables.

## Safety properties built in, not bolted on

- **Sanitized by construction, not by convention.** `run-command` on
  backend blocks `conf t`/`configure`/`commit`/`delete`/`set`/`write`/
  `reload`/`reboot`/`shutdown`/`no shut` outright and enforces the real
  vendor read-only prefix (`show`/`display`) before anything reaches a
  device — confirmed live: a `reload` command sent to this endpoint
  returns `400` and never reaches `collect_from_device` at all.
- **Write playbooks require explicit `--extra-vars`** — both
  `push_bgp_config.yml` and `push_ospf_config.yml` `assert` their required
  variables exist before touching any host. No usable defaults, no silent
  no-op, no silent wrong-target.
- **`push_ospf_config.yml` implements the real baseline procedure
  (process + area + network statement) as the only default path** —
  `sham-hello` (a supplementary Huawei feature) is opt-in only via
  `ospf_enable_sham_hello=true`, never applied by default. Direct fix for a
  real bug traced earlier in this project: the local AI assistant once
  presented sham-hello as if it were the required neighborship mechanism,
  when the vendor's own docs describe it as optional reinforcement on top
  of the real baseline.
- **Every backend call is persisted.** `git_manager.save_automation_run()`
  writes a git-tracked record (`git-repo/automation_runs/<device>/`) for
  every `run-command`/`push-config` call, success or failure — queryable
  via `GET /devices/{id}/automation-runs`. `backup_config.yml` instead
  reuses backend's existing `/backup/{id}` (already durable, already
  diffed/versioned) rather than creating a second backup history.
- **No standalone execution endpoint exists in the Ansible layer itself.**
  `core/automation/app.py` exposes `GET /ansible/flows`,
  `GET /ansible/flows/{name}`, `POST /ansible/flows/{name}/syntax-check`,
  `POST /ansible/flows/upload` (rejects anything that fails syntax-check —
  never saves a broken playbook), and `POST /ansible/collections/install`
  — nothing here lets a caller invoke `ansible-playbook` directly. The
  frontend's "Ansible Flows" tab (Automation page) mirrors this exactly:
  list, view, syntax-check, upload, install — no run button.
  Execution is only reachable through the visual flow designer's node
  model instead (Pre-Check/Post-Check "Ansible Script" mode, Config
  Deploy "Ansible Playbook" mode — `executors/ansible_runner.py`), which
  scopes every run to the flow's explicitly selected devices via
  `--limit @<tempfile>` and requires a human to build and launch that flow
  deliberately. As of this writing no flow has actually been launched
  against real inventory — only `--syntax-check` and the negative/positive
  upload-verification tests documented above have run.

## How to actually run one, when that's a deliberate decision

Either through the visual flow designer (build a flow, target real
devices in its Device Select node, pick "Ansible Script"/"Ansible
Playbook" mode on the relevant node), or manually, inside the container,
by an operator who has read this file:

```bash
docker exec -it NETAct_Automation bash
cd /app/ansible

# Always syntax-check first (already done for all 5, but re-verify after
# any edit):
ansible-playbook playbooks/gather_facts.yml --syntax-check

# Confirm what the dynamic inventory actually sees before targeting anything:
ansible-inventory --list

# Read-only flows — safe to run for real once you're ready. Each task
# calls backend's sanitized /run-command; a genuinely dangerous command
# can't reach a device through this path even by mistake.
ansible-playbook playbooks/gather_facts.yml -l cisco_iosxr
ansible-playbook playbooks/healthcheck_facts.yml -l cisco_iosxr

# Write flows — follow this project's existing safety rule (CLAUDE.md #1):
# confirm a recent backup exists first (or just run backup_config.yml).
# Required vars are mandatory:
ansible-playbook playbooks/push_bgp_config.yml -l cisco_iosxr \
  -e bgp_local_as=65001 -e bgp_peer_ip=10.1.1.2 -e bgp_peer_remote_as=65002

# Check what happened afterward:
curl -H "X-Api-Key: $APP_PASSWORD" http://backend:8000/devices/<id>/automation-runs

# SOLIDserver IPAM (once SOLIDSERVER_HOST/USER/PASSWORD are set on backend):
ansible-playbook playbooks/solidserver_ipam_read.yml -l cisco_iosxr \
  -e sds_method=ip_address_list -e sds_params="{\"WHERE\": \"site_name='Default'\"}"

# GET /ipam/solidserver/methods on backend to see the full allowlist +
# required params for each method, straight from the official reference:
curl -H "X-Api-Key: $APP_PASSWORD" http://backend:8000/ipam/solidserver/methods

# SOLIDserver DNS (same prerequisite):
ansible-playbook playbooks/solidserver_dns_read.yml -l cisco_iosxr \
  -e sds_method=dns_zone_list -e sds_params="{\"WHERE\": \"dns_name='ns1.example.com'\"}"

# The full provisioning workflow:
ansible-playbook playbooks/solidserver_dns_manage.yml -l cisco_iosxr \
  -e dns_server_name=ns1.example.com -e dnszone_name=example.com \
  -e dns_records='[{"rr_name":"www.example.com","rr_type":"A","value1":"10.1.1.50"}]'

curl -H "X-Api-Key: $APP_PASSWORD" http://backend:8000/dns/solidserver/methods

# Collection-module examples (netact.solidserver):
ansible-playbook examples/dns_create_zone.yml \
  -e dns_server_name=ns1.example.com -e dnszone_name=example.com
```
