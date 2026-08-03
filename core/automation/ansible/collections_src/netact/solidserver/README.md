# netact.solidserver

Local, unpublished Ansible collection providing native modules for
EfficientIP SOLIDserver operations — `ipam_read`/`ipam_write` (IPAM) and
`dns_read`/`dns_write` (DNS: servers, views, zones, records, ACLs, TSIG
keys, DNSSEC).

None of the four modules connect to the SOLIDserver appliance directly.
All send an HTTPS `POST` to `NETAct_backend`'s gateways
(`/ipam/solidserver/read|write`, `/dns/solidserver/read|write`) — backend
is the only place appliance credentials exist
(`SOLIDSERVER_HOST`/`SOLIDSERVER_USER`/`SOLIDSERVER_PASSWORD`) and the
only place that talks to the appliance's REST API, via
`core/backend/solidserver_client.py`'s direct HTTP calls (no third-party
SDK — see "Source of truth" below for why). Backend enforces an explicit
method allowlist before doing anything else — see
`core/backend/ipam_solidserver.py` / `dns_solidserver.py`.

This mirrors the equivalent `solidserver_ipam_*.yml`/`solidserver_dns_*.yml`
playbooks in `core/automation/ansible/playbooks/` (which use
`ansible.builtin.uri` directly) — those are unchanged and still work
through the visual flow designer. This collection is an additive,
alternate way to reach the same gateways using proper module syntax
instead of a raw `uri` task, for anyone writing custom playbooks by hand
— see `ansible/examples/` for real usage of every module below.

## Source of truth

Every method name, parameter name, and add-vs-edit semantic documented
here and in the module `DOCUMENTATION` blocks comes from EfficientIP's
own **"SOLIDserver API: REST Reference Guide", version 7.3, revision
#100648** — Part II "IPAM Services" (chapters 5 Space, 6 IPv4 Network, 10
IPv4 Address) and Part IV "DNS Services" (chapters 33-39: DNS Server, DNS
View, DNS Zone, DNS Resource Record, DNS ACL, TSIG Key, DNSSEC) — not
guessed, and not inferred from any SDK's internal naming. `GET
/ipam/solidserver/methods` and `GET /dns/solidserver/methods` on backend
serve the same reference data live (allowed methods + their Mandatory
Input Parameters), so an operator never has to re-open the PDF to know
what's callable.

**This collection previously depended on the third-party `SOLIDserverRest`
Python SDK; it no longer does.** That SDK carried its own internal
service-name translation table (`SERVICE_MAPPER`) mapping convenience
names like `ip_site_create` to the real wire-level service `ip_site_add`,
plus a suffix-based HTTP-verb heuristic (`METHOD_MAPPER`) — meaning what
request actually got sent wasn't obvious without reading the SDK's own
source. Backend now calls the documented REST API directly instead: exact
URL (`https://<host>/<rest-or-rpc>/<service>`), exact HTTP verb per the
reference guide's own Table 2.1 (`POST`=create, `PUT`=edit,
`GET`=list/info/count, `DELETE`=delete), exact auth headers
(`X-IPM-Username`/`X-IPM-Password`, base64-encoded). See
`core/backend/solidserver_client.py`.

**Object creation and update are the same REST service.** Per the
reference guide's own "SOLIDserver Key Services" chapter: "Services
`*_add`" — the HTTP verb decides create vs. edit, not a different service
name. Every write module here takes an `edit` option (default `false` =
`POST`/create; `true` = `PUT`/edit) for exactly this reason. There is
**no** separate `*_create`/`*_update` service anywhere in the official API.

## IPAM modules

### `netact.solidserver.ipam_read`

```yaml
- name: List IP addresses in the Default site
  netact.solidserver.ipam_read:
    backend_url: "{{ netact_backend_url }}"
    api_key: "{{ netact_app_password }}"
    method: ip_address_list
    params:
      WHERE: "site_name='Default'"
  register: result
```

| `method` | Chapter | Mandatory `params` |
|---|---|---|
| `ip_site_list` | Space | *(none — `WHERE`/`ORDERBY` optional filters)* |
| `ip_site_info` | Space | `site_id` |
| `ip_block_subnet_list` | IPv4 Network | *(none)* |
| `ip_block_subnet_info` | IPv4 Network | `subnet_id` |
| `ip_find_free_subnet` | IPv4 Network | `prefix` or `size` |
| `ip_address_list` | IPv4 Address | *(none)* |
| `ip_address_info` | IPv4 Address | `ip_id` |
| `ip_find_free_address` | IPv4 Address | `subnet_id`, `pool_id`, or `parent_subnet_id` |

### `netact.solidserver.ipam_write`

```yaml
- name: Reserve an IP address
  netact.solidserver.ipam_write:
    backend_url: "{{ netact_backend_url }}"
    api_key: "{{ netact_app_password }}"
    method: ip_add
    params:
      site_name: Default
      hostaddr: 10.1.1.50
      name: new-host
  register: result

- name: Edit that space's description (PUT, not POST)
  netact.solidserver.ipam_write:
    backend_url: "{{ netact_backend_url }}"
    api_key: "{{ netact_app_password }}"
    method: ip_site_add
    edit: true
    params:
      site_name: Default
      site_description: "Updated via Ansible"
```

| `method` | Chapter | Mandatory `params` |
|---|---|---|
| `ip_site_add` | Space | Add: `site_name`. Edit: `site_id` or `site_name`. |
| `ip_site_delete` | Space | `site_id` or `site_name` |
| `ip_subnet_add` | IPv4 Network | `subnet_addr` + one of `subnet_end_addr`/`subnet_size`/`subnet_mask`/`subnet_prefix` + one of `site_id`/`site_name`/`parent_subnet_id`. Set `subnet_level: 0` to add a block instead of a subnet. |
| `ip_subnet_delete` | IPv4 Network | `subnet_id`, or the same combination as `ip_subnet_add`'s Add case |
| `ip_add` | IPv4 Address | Add: `hostaddr` + one of `site_id`/`site_name`. Edit: `ip_id`, or the Add combination. |
| `ip_delete` | IPv4 Address | `ip_id`, or `hostaddr` + one of `site_id`/`site_name` |

## DNS modules

### `netact.solidserver.dns_read`

```yaml
- name: List zones on a DNS server
  netact.solidserver.dns_read:
    backend_url: "{{ netact_backend_url }}"
    api_key: "{{ netact_app_password }}"
    method: dns_zone_list
    params:
      WHERE: "dns_name='ns1.example.com'"
```

| `method` | Chapter | Mandatory `params` |
|---|---|---|
| `dns_server_list` / `_info` / `_count` | DNS Server | `_info` needs `dns_id` |
| `dns_view_list` / `_info` / `_count` | DNS View | `_info` needs `dnsview_id` |
| `dns_view_param_list` / `_info` / `_count` | DNS View Options | see reference guide ch. 34 |
| `dns_zone_list` / `_info` / `_count` | DNS Zone | `_info` needs `dnszone_id` |
| `dns_zone_param_list` / `_info` / `_count` | DNS Zone Options | see reference guide ch. 35 |
| `dns_rr_list` / `_info` / `_count` | Resource Record | `_info` needs `rr_id` |
| `dns_acl_list` / `_info` / `_count` | DNS ACL | `_info` needs `dnsacl_id` |
| `dns_key_list` / `_info` / `_count` | TSIG Key | `_info` needs `dnskey_id` |
| `dnssec_zone_keys_list` / `_info` | DNSSEC | see reference guide ch. 39 |

### `netact.solidserver.dns_write`

```yaml
- name: Create an authoritative master zone
  netact.solidserver.dns_write:
    backend_url: "{{ netact_backend_url }}"
    api_key: "{{ netact_app_password }}"
    method: dns_zone_add
    params:
      dnszone_name: example.com
      dnszone_type: master
      dnsview_name: default
      dns_name: ns1.example.com
      add_flag: new_only
  register: zone

- name: Add an A record
  netact.solidserver.dns_write:
    backend_url: "{{ netact_backend_url }}"
    api_key: "{{ netact_app_password }}"
    method: dns_rr_add
    params:
      dnszone_name: example.com
      rr_name: www.example.com
      rr_type: A
      value1: 10.1.1.50
      dns_name: ns1.example.com

- name: Sign the zone with DNSSEC
  netact.solidserver.dns_write:
    backend_url: "{{ netact_backend_url }}"
    api_key: "{{ netact_app_password }}"
    method: dnssec_enable_sign_zone
    params:
      dnszone_id: "{{ zone.result.ret_oid }}"
```

| `method` | Chapter | Mandatory `params` |
|---|---|---|
| `dns_view_add` | DNS View | Add: `dnsview_name` + server id. Edit: `dnsview_id` or the Add combination. |
| `dns_view_delete` | DNS View | `dnsview_id`, or `dnsview_name` + server id |
| `dns_view_param_add` / `_delete` | DNS View Options | see reference guide ch. 34 |
| `dns_zone_add` | DNS Zone | Add: `dnszone_name` + `dnszone_type` + view id + server id. Edit: `dnszone_id` or the Add combination. |
| `dns_zone_delete` | DNS Zone | `dnszone_id`, or `dnszone_name` + view + server ids |
| `dns_zone_param_add` / `_delete` | DNS Zone Options | see reference guide ch. 35 |
| `dns_rr_add` | Resource Record | Add: `rr_name` + `rr_type` + `value1` + server id. Edit: `rr_id` or the Add combination. `value1`'s meaning depends on `rr_type` (Table 36.1). |
| `dns_rr_delete` | Resource Record | `rr_id`, or `rr_name` + zone + server ids |
| `dns_acl_add` | DNS ACL | `dnsacl_value` + (`dnsacl_name` + server id for Add, or `dnsacl_id` for Edit) |
| `dns_acl_delete` | DNS ACL | `dnsacl_id` |
| `dns_key_add` | TSIG Key | `dnskey_name` + server id (same for Add and Edit) |
| `dns_key_delete` | TSIG Key | `dnskey_id`, or `dnskey_name` + server id |
| `dnssec_enable_sign_zone` | DNSSEC | `dnszone_id`, or `dnszone_name` + server id. Only zones on a smart architecture or an EfficientIP DNS server can be signed. |

Deliberately **not** included: `dns_add`/`dns_delete` (provisions or
decommissions a physical DNS server entry itself — a distinct,
higher-risk infrastructure operation) and `group_dnsview_add`/
`group_dnszone_add` (assigns a view/zone to a user group's resources —
access control, not DNS content).

## Common to all four modules

Both write modules (`ipam_write`, `dns_write`) support check mode
(reports intent without calling backend when run with `--check`) and
require `params` — an empty-params write is refused before it ever
reaches backend. Any `method` outside the tables above is rejected by
backend with `400` before it reaches this collection's own allowlist
logic — the module's `choices` restriction is a first line of defense,
not the only one.

## What's intentionally not covered

The reference guide documents dozens of additional services (IPv6
networks/addresses/pools/aliases, DHCP server management, VLANs, device
management, application load-balancing, and more). This collection wraps
only the IPAM and DNS *content-management* services listed above.
Extending `READ_METHODS`/`WRITE_METHODS` in `core/backend/
ipam_solidserver.py`/`dns_solidserver.py` (and this collection's
`choices` lists) to cover more of the reference guide is a deliberate,
reviewable change, not something any module attempts to guess at.
