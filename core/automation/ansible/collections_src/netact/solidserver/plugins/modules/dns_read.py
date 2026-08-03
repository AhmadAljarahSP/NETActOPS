#!/usr/bin/python
# -*- coding: utf-8 -*-
from __future__ import absolute_import, division, print_function
__metaclass__ = type

DOCUMENTATION = r'''
---
module: dns_read
short_description: Read-only query against SOLIDserver DNS via NETAct_backend
description:
  - Sends a read-only DNS query (list/info) to NETAct_backend's sanitized
    SOLIDserver gateway (C(POST /dns/solidserver/read)).
  - Never connects to the SOLIDserver appliance directly — NETAct_backend
    does, and enforces its own method allowlist regardless of what is sent
    here (see core/backend/dns_solidserver.py).
  - Method names and their Mandatory Input Parameters are taken from
    EfficientIP's official I(SOLIDserver API - REST Reference Guide)
    (version 7.3, revision #100648), Part IV "DNS Services".
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
  method:
    description:
      - SOLIDserver REST service name to call.
      - "C(dns_server_list)/C(dns_server_info)/C(dns_server_count) — DNS Server chapter. C(dns_server_info) requires C(dns_id)."
      - "C(dns_view_list)/C(dns_view_info)/C(dns_view_count) — DNS View chapter. C(dns_view_info) requires C(dnsview_id)."
      - "C(dns_view_param_list)/C(dns_view_param_info)/C(dns_view_param_count) — DNS View Options."
      - "C(dns_zone_list)/C(dns_zone_info)/C(dns_zone_count) — DNS Zone chapter. C(dns_zone_info) requires C(dnszone_id)."
      - "C(dns_zone_param_list)/C(dns_zone_param_info)/C(dns_zone_param_count) — DNS Zone Options."
      - "C(dns_rr_list)/C(dns_rr_info)/C(dns_rr_count) — Resource Record chapter. C(dns_rr_info) requires C(rr_id)."
      - "C(dns_acl_list)/C(dns_acl_info)/C(dns_acl_count) — DNS ACL chapter. C(dns_acl_info) requires C(dnsacl_id)."
      - "C(dns_key_list)/C(dns_key_info)/C(dns_key_count) — TSIG Key chapter. C(dns_key_info) requires C(dnskey_id)."
      - "C(dnssec_zone_keys_list)/C(dnssec_zone_keys_info) — DNSSEC chapter."
    type: str
    required: true
    choices:
      - dns_server_list
      - dns_server_info
      - dns_server_count
      - dns_view_list
      - dns_view_info
      - dns_view_count
      - dns_view_param_list
      - dns_view_param_info
      - dns_view_param_count
      - dns_zone_list
      - dns_zone_info
      - dns_zone_count
      - dns_zone_param_list
      - dns_zone_param_info
      - dns_zone_param_count
      - dns_rr_list
      - dns_rr_info
      - dns_rr_count
      - dns_acl_list
      - dns_acl_info
      - dns_acl_count
      - dns_key_list
      - dns_key_info
      - dns_key_count
      - dnssec_zone_keys_list
      - dnssec_zone_keys_info
  params:
    description: >-
      Query parameters passed through to the SOLIDserver REST call (e.g.
      C(WHERE), C(ORDERBY), or a method's specific mandatory parameters
      such as C(dns_id)/C(dnsview_id)/C(dnszone_id)/C(rr_id)).
    type: dict
    required: false
    default: {}
author:
  - NETAct
'''

EXAMPLES = r'''
- name: List all zones on a DNS server
  netact.solidserver.dns_read:
    backend_url: "{{ netact_backend_url }}"
    api_key: "{{ netact_app_password }}"
    method: dns_zone_list
    params:
      WHERE: "dns_name='ns1.example.com'"
  register: zones

- name: List resource records in a zone
  netact.solidserver.dns_read:
    backend_url: "{{ netact_backend_url }}"
    api_key: "{{ netact_app_password }}"
    method: dns_rr_list
    params:
      WHERE: "dnszone_name='example.com'"
  register: records

- name: Count records in a zone (verification step)
  netact.solidserver.dns_read:
    backend_url: "{{ netact_backend_url }}"
    api_key: "{{ netact_app_password }}"
    method: dns_rr_count
    params:
      WHERE: "dnszone_name='example.com'"
'''

RETURN = r'''
result:
  description: Parsed JSON result returned by SOLIDserver, as forwarded by backend.
  type: raw
  returned: success
run_id:
  description: NETAct_backend automation_runs record id for this call.
  type: str
  returned: success
'''

from ansible.module_utils.basic import AnsibleModule
from ansible_collections.netact.solidserver.plugins.module_utils.backend_gateway import post_to_backend

_READ_METHODS = [
    "dns_server_list", "dns_server_info", "dns_server_count",
    "dns_view_list", "dns_view_info", "dns_view_count",
    "dns_view_param_list", "dns_view_param_info", "dns_view_param_count",
    "dns_zone_list", "dns_zone_info", "dns_zone_count",
    "dns_zone_param_list", "dns_zone_param_info", "dns_zone_param_count",
    "dns_rr_list", "dns_rr_info", "dns_rr_count",
    "dns_acl_list", "dns_acl_info", "dns_acl_count",
    "dns_key_list", "dns_key_info", "dns_key_count",
    "dnssec_zone_keys_list", "dnssec_zone_keys_info",
]


def run_module():
    module_args = dict(
        backend_url=dict(type='str', required=True),
        api_key=dict(type='str', required=True, no_log=True),
        method=dict(type='str', required=True, choices=_READ_METHODS),
        params=dict(type='dict', required=False, default={}),
    )
    module = AnsibleModule(argument_spec=module_args, supports_check_mode=True)

    if module.check_mode:
        module.exit_json(changed=False, result=None, msg="check mode: read query not executed")
        return

    payload = post_to_backend(
        module,
        module.params['backend_url'],
        module.params['api_key'],
        "/dns/solidserver/read",
        module.params['method'],
        module.params['params'],
    )

    if payload.get("status") != "success":
        module.fail_json(msg="DNS read failed: %s" % payload.get('error'), **payload)
        return

    module.exit_json(changed=False, **payload)


def main():
    run_module()


if __name__ == '__main__':
    main()
