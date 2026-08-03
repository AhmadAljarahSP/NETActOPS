===========================================
netact.solidserver Release Notes
===========================================

.. contents:: Topics

v2.0.0
======

Major Changes
-------------

- Dropped the third-party ``SOLIDserverRest`` Python SDK entirely.
  ``core/backend`` now calls the documented REST API directly
  (``core/backend/solidserver_client.py``): explicit URL construction
  (``https://<host>/<rest-or-rpc>/<service>``) and explicit HTTP verb
  selection (``POST``=create, ``PUT``=edit, ``GET``=list/info/count,
  ``DELETE``=delete — Table 2.1 of the reference guide), with
  ``X-IPM-Username``/``X-IPM-Password`` (base64) authentication. The SDK's
  own internal service-name translation table made it unclear, without
  reading the SDK's own source, exactly what request this project's code
  actually sent — this removes that layer of indirection entirely.
- Added DNS support: ``dns_read``/``dns_write`` modules covering DNS
  servers (read-only), views (+ options), zones (+ options), resource
  records, ACLs, TSIG keys, and DNSSEC signing. See
  ``core/backend/dns_solidserver.py`` for the full allowlist and
  ``examples/`` for real usage.
- **Breaking**: the write endpoints' request shape changed. Creation vs.
  edit of an ``*_add`` object is no longer inferred — callers must pass
  ``edit: true`` explicitly to issue ``PUT`` instead of the default
  ``POST``. (Never a live/depended-upon behavior — ``SOLIDSERVER_HOST``
  has been unconfigured since this integration's first version, so no
  real caller is affected.)

Minor Changes
-------------

- Added ``ansible/examples/`` — six focused example playbooks
  demonstrating the collection's native module syntax for common DNS/IPAM
  workflows (create a view/zone, add records, deploy a TSIG key, sign a
  zone with DNSSEC, reserve an IP and register its DNS record together).
- Added ``dns`` to ``meta/runtime.yml``'s ``action_groups``.
- New ``GET /dns/solidserver/methods`` backend endpoint, mirroring the
  existing IPAM one — self-describing allowlist + Mandatory Input
  Parameters for every DNS method, sourced live from the same reference
  data as this changelog.

v1.1.0
======

Bugfixes
--------

- Corrected every SOLIDserver REST service name against EfficientIP's
  official "SOLIDserver API: REST Reference Guide" (version 7.3, revision
  #100648), replacing names that had been inferred from the third-party
  SOLIDserverRest Python SDK's internal call sites:

  - ``ip_site_create``/``ip_site_update`` and ``ip_subnet_create``/
    ``ip_subnet_update`` never existed as separate services — creation and
    update are the same ``*_add`` service (``ip_site_add``,
    ``ip_subnet_add``) per the reference guide's own key-services chapter.
  - ``ip_address_create``/``ip_address_update``/``ip_address_delete`` are
    actually named ``ip_add``/``ip_add``/``ip_delete``.
  - ``ip_subnet_find_free``/``ip_address_find_free`` are actually named
    ``ip_find_free_subnet``/``ip_find_free_address``.
  - ``ip_subnet_list``/``ip_subnet_info`` are actually named
    ``ip_block_subnet_list``/``ip_block_subnet_info``.
  - ``member_list`` does not appear anywhere in the official reference and
    was removed from the read allowlist rather than kept unverified.

- No integration built on this collection had been used against a real
  appliance before this correction (``SOLIDSERVER_HOST`` was never
  configured), so this is released as ``1.1.0`` rather than a major
  version bump — the corrected names are the only names this collection
  has ever actually been usable with.

Minor Changes
-------------

- Added ``meta/runtime.yml`` declaring the minimum supported
  ``ansible-core`` version and an ``ipam`` action group.
- Module ``DOCUMENTATION``/``EXAMPLES`` now cite each method's Mandatory
  Input Parameters directly from the official reference guide.

v1.0.0
======

Initial release — ``ipam_read``/``ipam_write`` modules wrapping
NETAct_backend's SOLIDserver IPAM gateway. Method names in this release
were inferred from the SOLIDserverRest Python SDK's internal ``sds.query()``
call sites rather than the vendor's own REST service catalog; several were
incorrect (see the v1.1.0 bugfix notes above) and no live calls were made
against a real appliance while this version was current.
