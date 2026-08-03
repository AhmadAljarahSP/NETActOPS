#!/usr/bin/python
# -*- coding: utf-8 -*-
from __future__ import absolute_import, division, print_function
__metaclass__ = type

DOCUMENTATION = r'''
---
module: ipam_write
short_description: Write action against SOLIDserver IPAM via NETAct_backend
description:
  - Sends an IPAM write action (add-or-edit / delete) to NETAct_backend's
    sanitized SOLIDserver gateway (C(POST /ipam/solidserver/write)).
  - Never connects to the SOLIDserver appliance directly — NETAct_backend
    does, and enforces its own method allowlist regardless of what is sent
    here (see core/backend/ipam_solidserver.py). This IS the deliberate
    write path — the safety property is the method allowlist itself, not
    a runtime filter layered on top of it.
  - Method names and their Mandatory Input Parameters are taken from
    EfficientIP's official I(SOLIDserver API - REST Reference Guide)
    (version 7.3, revision #100648), not inferred from a third-party SDK.
  - "Per the reference guide's own \"SOLIDserver Key Services\" chapter,
    creation and update of an object are the SAME service (C(*_add)) —
    distinguished by HTTP verb (C(POST)=create, C(PUT)=edit, Table 2.1)
    rather than by a separate service name. Set I(edit) to choose which."
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
        param already in I(params), e.g. C(site_id) or a matching name).
        Ignored for C(*_delete) methods.
    type: bool
    required: false
    default: false
  method:
    description:
      - SOLIDserver REST service name to call.
      - "C(ip_site_add) — add/edit a space. Addition requires C(site_name); edition requires C(site_id) or C(site_name)."
      - "C(ip_site_delete) — requires C(site_id) or C(site_name)."
      - "C(ip_subnet_add) — add/edit an IPv4 block/subnet. Requires C(subnet_addr) plus one of C(subnet_end_addr)/C(subnet_size)/C(subnet_mask)/C(subnet_prefix), plus one of C(site_id)/C(site_name)/C(parent_subnet_id). Set C(subnet_level=0) to add a block instead of a subnet."
      - "C(ip_subnet_delete) — requires C(subnet_id), or the same combination as C(ip_subnet_add)'s addition case."
      - "C(ip_add) — add/edit an IPv4 address. Addition requires C(hostaddr) plus one of C(site_id)/C(site_name); edition requires C(ip_id) or the addition combination."
      - "C(ip_delete) — requires C(ip_id), or C(hostaddr) plus one of C(site_id)/C(site_name)."
    type: str
    required: true
    choices:
      - ip_site_add
      - ip_site_delete
      - ip_subnet_add
      - ip_subnet_delete
      - ip_add
      - ip_delete
  params:
    description: >-
      Parameters for the write action (e.g. C(site_name)/C(subnet_addr)/
      C(hostaddr) — see I(method) descriptions above for what each one
      needs). Required — an empty-params write is refused by this module
      before it ever reaches backend. Optionally include C(add_flag) set
      to C(new_only) or C(edit_only) as an extra, appliance-side guard on
      top of I(edit)'s HTTP-verb selection — e.g. I(edit)=false plus
      C(add_flag: new_only) refuses to silently edit an existing object
      even if its identifying params happen to match one.
    type: dict
    required: true
author:
  - NETAct
'''

EXAMPLES = r'''
- name: Create a new space
  netact.solidserver.ipam_write:
    backend_url: "{{ netact_backend_url }}"
    api_key: "{{ netact_app_password }}"
    method: ip_site_add
    params:
      site_name: Default
      add_flag: new_only

- name: Add a /24 subnet under an existing space
  netact.solidserver.ipam_write:
    backend_url: "{{ netact_backend_url }}"
    api_key: "{{ netact_app_password }}"
    method: ip_subnet_add
    params:
      site_name: Default
      subnet_name: lab-net
      subnet_addr: 10.1.1.0
      subnet_prefix: "24"

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

- name: Delete that IP address
  netact.solidserver.ipam_write:
    backend_url: "{{ netact_backend_url }}"
    api_key: "{{ netact_app_password }}"
    method: ip_delete
    params:
      ip_id: "{{ result.result.ret_oid }}"

- name: Edit that space's description (PUT, not POST)
  netact.solidserver.ipam_write:
    backend_url: "{{ netact_backend_url }}"
    api_key: "{{ netact_app_password }}"
    method: ip_site_add
    edit: true
    params:
      site_name: Default
      site_description: "Updated via Ansible"
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
    "ip_site_add", "ip_site_delete",
    "ip_subnet_add", "ip_subnet_delete",
    "ip_add", "ip_delete",
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
        "/ipam/solidserver/write",
        module.params['method'],
        module.params['params'],
        edit=module.params['edit'],
    )

    if payload.get("status") != "success":
        module.fail_json(msg="IPAM write failed: %s" % payload.get('error'), **payload)
        return

    module.exit_json(changed=True, **payload)


def main():
    run_module()


if __name__ == '__main__':
    main()
