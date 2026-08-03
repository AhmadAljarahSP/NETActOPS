#!/usr/bin/python
# -*- coding: utf-8 -*-
from __future__ import absolute_import, division, print_function
__metaclass__ = type

DOCUMENTATION = r'''
---
module: ipam_read
short_description: Read-only query against SOLIDserver IPAM via NETAct_backend
description:
  - Sends a read-only IPAM query (list/info/find-free) to NETAct_backend's
    sanitized SOLIDserver gateway (C(POST /ipam/solidserver/read)).
  - Never connects to the SOLIDserver appliance directly — NETAct_backend
    does, and enforces its own method allowlist regardless of what is sent
    here (see core/backend/ipam_solidserver.py).
  - Method names and their Mandatory Input Parameters are taken from
    EfficientIP's official I(SOLIDserver API - REST Reference Guide)
    (version 7.3, revision #100648), not inferred from a third-party SDK.
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
      - "C(ip_site_list) / C(ip_site_info) — Space chapter. C(ip_site_info) requires C(site_id)."
      - "C(ip_block_subnet_list) / C(ip_block_subnet_info) — IPv4 Network chapter. C(ip_block_subnet_info) requires C(subnet_id)."
      - "C(ip_find_free_subnet) — requires C(prefix) or C(size) in I(params)."
      - "C(ip_address_list) / C(ip_address_info) — IPv4 Address chapter. C(ip_address_info) requires C(ip_id)."
      - "C(ip_find_free_address) — requires C(subnet_id), C(pool_id), or C(parent_subnet_id) in I(params)."
    type: str
    required: true
    choices:
      - ip_site_list
      - ip_site_info
      - ip_block_subnet_list
      - ip_block_subnet_info
      - ip_find_free_subnet
      - ip_address_list
      - ip_address_info
      - ip_find_free_address
  params:
    description:
      - Query parameters passed through to the SOLIDserver REST call
        (e.g. C(WHERE), C(ORDERBY), or a method's specific mandatory
        parameters such as C(site_id)/C(subnet_id)/C(ip_id)).
    type: dict
    required: false
    default: {}
author:
  - NETAct
'''

EXAMPLES = r'''
- name: List IP addresses in the Default site
  netact.solidserver.ipam_read:
    backend_url: "{{ netact_backend_url }}"
    api_key: "{{ netact_app_password }}"
    method: ip_address_list
    params:
      WHERE: "site_name='Default'"
  register: result

- name: Display the properties of one space
  netact.solidserver.ipam_read:
    backend_url: "{{ netact_backend_url }}"
    api_key: "{{ netact_app_password }}"
    method: ip_site_info
    params:
      site_id: "3"

- name: Find 10 free /29 subnets under a space
  netact.solidserver.ipam_read:
    backend_url: "{{ netact_backend_url }}"
    api_key: "{{ netact_app_password }}"
    method: ip_find_free_subnet
    params:
      site_id: "3"
      prefix: "29"
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
    "ip_site_list", "ip_site_info",
    "ip_block_subnet_list", "ip_block_subnet_info", "ip_find_free_subnet",
    "ip_address_list", "ip_address_info", "ip_find_free_address",
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
        "/ipam/solidserver/read",
        module.params['method'],
        module.params['params'],
    )

    if payload.get("status") != "success":
        module.fail_json(msg="IPAM read failed: %s" % payload.get('error'), **payload)
        return

    module.exit_json(changed=False, **payload)


def main():
    run_module()


if __name__ == '__main__':
    main()
