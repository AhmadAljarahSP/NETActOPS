# -*- coding: utf-8 -*-
"""Shared HTTP helper for netact.solidserver modules. Every call goes to
NETAct_backend's sanitized IPAM gateway — never to the SOLIDserver
appliance directly. Uses ansible.module_utils.urls.fetch_url so no extra
Python dependency is needed inside the Ansible controller."""
from __future__ import absolute_import, division, print_function
__metaclass__ = type

import json

from ansible.module_utils.urls import fetch_url


def post_to_backend(module, backend_url, api_key, path, method, params, edit=None):
    payload = {"method": method, "params": params or {}}
    if edit is not None:
        payload["edit"] = edit
    body = json.dumps(payload)
    headers = {
        "Content-Type": "application/json",
        "X-Api-Key": api_key,
    }
    resp, info = fetch_url(
        module,
        backend_url.rstrip("/") + path,
        data=body,
        headers=headers,
        method="POST",
        timeout=60,
    )
    status = info.get("status", -1)
    if resp is None or status != 200:
        error_body = info.get("body")
        detail = error_body.decode("utf-8", errors="replace") if error_body else info.get("msg", "unknown error")
        module.fail_json(msg="backend call to %s failed: HTTP %s: %s" % (path, status, detail))

    try:
        return json.loads(resp.read())
    except (ValueError, AttributeError) as e:
        module.fail_json(msg="backend returned non-JSON response from %s: %s" % (path, e))
