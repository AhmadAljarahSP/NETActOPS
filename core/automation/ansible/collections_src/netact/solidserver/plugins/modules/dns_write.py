#!/usr/bin/python
# -*- coding: utf-8 -*-
from __future__ import absolute_import, division, print_function
__metaclass__ = type

DOCUMENTATION = r'''
---
module: dns_write
short_description: Write action against SOLIDserver DNS via NETAct_backend
description:
  - Sends a DNS write action (add-or-edit / delete a view, zone, resource
    record, ACL, or TSIG key; or sign a zone with DNSSEC) to
    NETAct_backend's sanitized SOLIDserver gateway
    (C(POST /dns/solidserver/write)).
  - Never connects to the SOLIDserver appliance directly — NETAct_backend
    does, and enforces its own method allowlist regardless of what is
    sent here (see core/backend/dns_solidserver.py). This IS the
    deliberate write path — the safety property is the method allowlist
    itself, not a runtime filter layered on top of it.
  - Method names and their Mandatory Input Parameters are taken from
    EfficientIP's official I(SOLIDserver API - REST Reference Guide)
    (version 7.3, revision #100648), Part IV "DNS Services".
  - "Per the reference guide's own \"SOLIDserver Key Services\" chapter,
    creation and update of an object are the SAME service (C(*_add)) —
    distinguished by HTTP verb (C(POST)=create, C(PUT)=edit, Table 2.1)
    rather than by a separate service name. Set I(edit) to choose which."
  - Deliberately does NOT include C(dns_add)/C(dns_delete) (provisioning
    or decommissioning a physical DNS server itself — a distinct,
    higher-risk infrastructure operation) or C(group_dnsview_add)/
    C(group_dnszone_add) (assigning a view/zone to a user group's
    resources — access control, not DNS content).
options:
  backend_url:
    description: Base URL of NETAct_backend (e.g. http://backend:8000).
    type: str
    required: true
  api_key:
    description: NETAct_backend API key, sent as the X-Api-Key header.
    type: str
    required: true
    no_log: true
  edit:
    description:
      - For C(*_add) methods, selects the HTTP verb backend uses to call
        SOLIDserver — C(false) (default) issues C(POST) (create a new
        object), C(true) issues C(PUT) (edit an object identified by a
        param already in I(params)). Ignored for C(*_delete) and
        C(dnssec_enable_sign_zone) (always C(POST) to C(/rpc/)).
    type: bool
    required: false
    default: false
  method:
    description:
      - SOLIDserver REST service name to call.
      - "C(dns_view_add) — add/edit a view. Addition requires C(dnsview_name) + one of C(dns_id)/C(dns_name)/C(hostaddr); edition requires C(dnsview_id) or the addition combination."
      - "C(dns_view_delete) — requires C(dnsview_id), or C(dnsview_name) + one of C(dns_id)/C(dns_name)/C(hostaddr)."
      - "C(dns_view_param_add)/C(dns_view_param_delete) — DNS View Options; see the reference guide chapter 34 for exact params."
      - "C(dns_zone_add) — add/edit a zone. Addition requires C(dnszone_name) + C(dnszone_type) + one of C(dnsview_id)/C(dnsview_name) + one of C(dns_id)/C(dns_name)/C(hostaddr); edition requires C(dnszone_id) or the addition combination. C(dnszone_type) is one of master/slave/forward/stub/hint/delegation-only."
      - "C(dns_zone_delete) — requires C(dnszone_id), or C(dnszone_name) + view + server identifiers."
      - "C(dns_zone_param_add)/C(dns_zone_param_delete) — DNS Zone Options; see the reference guide chapter 35 for exact params."
      - "C(dns_rr_add) — add/edit a resource record. Addition requires C(rr_name) + C(rr_type) + C(value1) + one of C(dns_id)/C(dns_name)/C(hostaddr); edition requires C(rr_id) or the addition combination. C(value1)'s meaning depends on C(rr_type) (target IPv4 for A, canonical name for CNAME, etc. — see reference guide Table 36.1)."
      - "C(dns_rr_delete) — requires C(rr_id), or C(rr_name) + zone + server identifiers."
      - "C(dns_acl_add) — add/edit a DNS ACL. Requires C(dnsacl_value) plus (C(dnsacl_name) + server identifiers) for addition, or C(dnsacl_id) for edition."
      - "C(dns_acl_delete) — requires C(dnsacl_id)."
      - "C(dns_key_add) — add/edit a TSIG key. Requires C(dnskey_name) + one of C(dns_id)/C(dns_name)/C(hostaddr) (same combination for both addition and edition)."
      - "C(dns_key_delete) — requires C(dnskey_id), or C(dnskey_name) + server identifiers."
      - "C(dnssec_enable_sign_zone) — signs a zone with DNSSEC. Requires C(dnszone_id), or C(dnszone_name) + one of C(dns_id)/C(dns_name)/C(dns_hostaddr). Only zones on a smart architecture or an EfficientIP DNS server can be signed."
    type: str
    required: true
    choices:
      - dns_view_add
      - dns_view_delete
      - dns_view_param_add
      - dns_view_param_delete
      - dns_zone_add
      - dns_zone_delete
      - dns_zone_param_add
      - dns_zone_param_delete
      - dns_rr_add
      - dns_rr_delete
      - dns_acl_add
      - dns_acl_delete
      - dns_key_add
      - dns_key_delete
      - dnssec_enable_sign_zone
  params:
    description: >-
      Parameters for the write action — see I(method) descriptions above
      for what each one needs. Required — an empty-params write is
      refused by this module before it ever reaches backend.
    type: dict
    required: true
author:
  - NETAct
'''

EXAMPLES = r'''
- name: Create a DNS view
  netact.solidserver.dns_write:
    backend_url: "{{ netact_backend_url }}"
    api_key: "{{ netact_app_password }}"
    method: dns_view_add
    params:
      dnsview_name: internal
      dns_name: ns1.example.com
      add_flag: new_only

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

- name: Add an A record to the zone
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

- name: Deploy a TSIG key for secured zone transfers
  netact.solidserver.dns_write:
    backend_url: "{{ netact_backend_url }}"
    api_key: "{{ netact_app_password }}"
    method: dns_key_add
    params:
      dnskey_name: transfer-key
      dns_name: ns1.example.com
      add_flag: new_only

- name: Sign the zone with DNSSEC
  netact.solidserver.dns_write:
    backend_url: "{{ netact_backend_url }}"
    api_key: "{{ netact_app_password }}"
    method: dnssec_enable_sign_zone
    params:
      dnszone_id: "{{ zone.result.ret_oid }}"
      zsk_encryption_type: rsasha256
      ksk_encryption_type: rsasha256

- name: Edit the zone's description (PUT, not POST)
  netact.solidserver.dns_write:
    backend_url: "{{ netact_backend_url }}"
    api_key: "{{ netact_app_password }}"
    method: dns_zone_add
    edit: true
    params:
      dnszone_id: "{{ zone.result.ret_oid }}"
'''

RETURN = r'''
result:
  description: >-
    Parsed JSON result returned by SOLIDserver, as forwarded by backend.
    For C(*_add)/C(*_delete) calls this includes C(errno), C(errmsg),
    C(severity), and — on success — C(ret_oid), the database ID of the
    object that was added or edited.
  type: raw
  returned: success
run_id:
  description: NETAct_backend automation_runs record id for this call.
  type: str
  returned: success
'''

from ansible.module_utils.basic import AnsibleModule
from ansible_collections.netact.solidserver.plugins.module_utils.backend_gateway import post_to_backend

_WRITE_METHODS = [
    "dns_view_add", "dns_view_delete",
    "dns_view_param_add", "dns_view_param_delete",
    "dns_zone_add", "dns_zone_delete",
    "dns_zone_param_add", "dns_zone_param_delete",
    "dns_rr_add", "dns_rr_delete",
    "dns_acl_add", "dns_acl_delete",
    "dns_key_add", "dns_key_delete",
    "dnssec_enable_sign_zone",
]


def run_module():
    module_args = dict(
        backend_url=dict(type='str', required=True),
        api_key=dict(type='str', required=True, no_log=True),
        method=dict(type='str', required=True, choices=_WRITE_METHODS),
        params=dict(type='dict', required=True),
        edit=dict(type='bool', required=False, default=False),
    )
    module = AnsibleModule(argument_spec=module_args, supports_check_mode=True)

    if module.check_mode:
        verb = "PUT (edit)" if module.params['edit'] else "POST (create)"
        module.exit_json(changed=True, result=None, msg="check mode: would call %s [%s] with params=%s" % (module.params['method'], verb, module.params['params']))
        return

    payload = post_to_backend(
        module,
        module.params['backend_url'],
        module.params['api_key'],
        "/dns/solidserver/write",
        module.params['method'],
        module.params['params'],
        edit=module.params['edit'],
    )

    if payload.get("status") != "success":
        module.fail_json(msg="DNS write failed: %s" % payload.get('error'), **payload)
        return

    module.exit_json(changed=True, **payload)


def main():
    run_module()


if __name__ == '__main__':
    main()
