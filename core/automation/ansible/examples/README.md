# Examples

Focused, single-purpose playbooks showing the `netact.solidserver`
collection's native module syntax (`netact.solidserver.dns_read` /
`dns_write` / `ipam_read` / `ipam_write`) instead of a raw
`ansible.builtin.uri` task — for anyone writing their own custom playbook
against the same backend gateway.

These are **not** registered "custom flows" — they live here
(`ansible/examples/`), not in `ansible/playbooks/`, specifically so they
don't show up in `GET /ansible/flows` or the frontend's Ansible Flows tab.
`../playbooks/solidserver_dns_read.yml` / `_write.yml` / `_manage.yml` are
the generic, extra-vars-driven equivalents meant to actually be run
through the visual designer or `ansible-playbook` directly; these are
reference material.

All of them call `NETAct_backend`'s sanitized gateway
(`/dns/solidserver/*`, `/ipam/solidserver/*`) — none connect to the
SOLIDserver appliance directly, and none have ever been run against a
real appliance (`SOLIDSERVER_HOST` is unconfigured by design).

| File | Shows |
|---|---|
| `dns_list_servers.yml` | `dns_read` with `method: dns_server_list` — the "list what's configured on the appliance" starting point. Header comment documents that the appliance itself (host/user/password) is a backend-wide env-var setting, not a per-call param. |
| `dns_create_view.yml` | `dns_write` with `method: dns_view_add`, idempotent `add_flag: new_edit` |
| `dns_create_zone.yml` | `dns_write` with `method: dns_zone_add` |
| `dns_add_record.yml` | `dns_write` with `method: dns_rr_add`, looping over multiple record types (A/CNAME/MX) |
| `dns_deploy_tsig_key.yml` | `dns_write` with `method: dns_key_add` then `dns_zone_param_add` to restrict transfers to it |
| `dns_sign_dnssec.yml` | `dns_write` with `method: dnssec_enable_sign_zone`, then `dns_read` with `method: dnssec_zone_keys_list` |
| `ipam_reserve_and_register.yml` | `ipam_write` (`ip_add`) and `dns_write` (`dns_rr_add`) used together — reserve an IP, then register its DNS record |

Run any of them directly, e.g.:

```bash
docker exec -it NETAct_Automation bash
cd /app/ansible
ansible-playbook examples/dns_create_zone.yml \
  -e dns_server_name=ns1.example.com -e dnszone_name=example.com
```

`dns_list_servers.yml` is read-only; the rest are **write** examples
except the read call inside `dns_sign_dnssec.yml`'s verification step —
set `SOLIDSERVER_HOST`/`SOLIDSERVER_USER`/`SOLIDSERVER_PASSWORD` on
backend first, or every call returns `503`.
