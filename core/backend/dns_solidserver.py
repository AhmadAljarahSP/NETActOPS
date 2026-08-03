"""SOLIDserver DNS gateway — the only place NETAct talks to an
EfficientIP SOLIDserver appliance's DNS services (views, zones, resource
records, ACLs, TSIG keys, DNSSEC). Same posture as ipam_solidserver.py
and run-command/push-config for network devices: Ansible (or anything
else) reaches the appliance through backend only, never directly, and
every call is checked against an explicit allowlist of REST service
names rather than trusting a caller's claim about what's safe.

Talks to the appliance via solidserver_client.py's direct REST calls —
see that module's docstring for why the third-party SOLIDserverRest SDK
was dropped in favor of calling the documented API directly.

Method names and Mandatory Input Parameters below are verified against
EfficientIP's own "SOLIDserver API: REST Reference Guide" (version 7.3,
revision #100648), Part IV "DNS Services", chapters 33-39 (DNS Server,
DNS View, DNS Zone, DNS Resource Record, DNS ACL, TSIG Key, DNSSEC).

Deliberately NOT included (out of scope — DNS *content* management, not
appliance/access-control administration):
  - dns_add / dns_delete: provisions or decommissions a physical DNS
    server entry itself (SERVICE_MAPPER's dns_server_create/_delete in
    the old SDK dependency, but genuinely a distinct, higher-risk
    infrastructure operation from managing views/zones/records on an
    already-provisioned server).
  - group_dnsview_add/_delete, group_dnszone_add/_delete: assigns a
    view/zone to a user group's resources — an access-control concern,
    not DNS content.
"""
import logging
import solidserver_client

logger = logging.getLogger("backend.dns_solidserver")

is_configured = solidserver_client.is_configured

# dns_server_*        = DNS Server    (chapter 33, read-only here — see module docstring)
# dns_view_*           = DNS View      (chapter 34)
# dns_view_param_*     = DNS View Options (chapter 34)
# dns_zone_*           = DNS Zone      (chapter 35)
# dns_zone_param_*     = DNS Zone Options (chapter 35)
# dns_rr_*             = DNS Resource Record (chapter 36)
# dns_acl_*            = DNS ACL       (chapter 37)
# dns_key_*            = TSIG Key      (chapter 38)
# dnssec_*             = DNSSEC        (chapter 39)
READ_METHODS = {
    "dns_server_list", "dns_server_info", "dns_server_count",
    "dns_view_list", "dns_view_info", "dns_view_count",
    "dns_view_param_list", "dns_view_param_info", "dns_view_param_count",
    "dns_zone_list", "dns_zone_info", "dns_zone_count",
    "dns_zone_param_list", "dns_zone_param_info", "dns_zone_param_count",
    "dns_rr_list", "dns_rr_info", "dns_rr_count",
    "dns_acl_list", "dns_acl_info", "dns_acl_count",
    "dns_key_list", "dns_key_info", "dns_key_count",
    "dnssec_zone_keys_list", "dnssec_zone_keys_info",
}
WRITE_METHODS = {
    "dns_view_add", "dns_view_delete",
    "dns_view_param_add", "dns_view_param_delete",
    "dns_zone_add", "dns_zone_delete",
    "dns_zone_param_add", "dns_zone_param_delete",
    "dns_rr_add", "dns_rr_delete",
    "dns_acl_add", "dns_acl_delete",
    "dns_key_add", "dns_key_delete",
    "dnssec_enable_sign_zone",
}

# Mandatory Input Parameters exactly as documented per-service in the
# Reference Guide. Entries marked "see reference guide" were not
# individually re-derived from the PDF (unlike every other entry here) —
# they're included because their service names are directly confirmed
# in the guide's own table of contents/chapter index, but their exact
# param combinations weren't read in full; don't treat that note as a
# guess at the params themselves.
MANDATORY_PARAMS = {
    "dns_server_list": None,
    "dns_server_info": "dns_id",
    "dns_server_count": None,
    "dns_view_list": None,
    "dns_view_info": "dnsview_id",
    "dns_view_count": None,
    "dns_view_add": "Addition: (dnsview_name && (dns_id || dns_name || hostaddr)) | Edition: (dnsview_id || same combination as Addition)",
    "dns_view_delete": "(dnsview_id || (dnsview_name && (dns_id || dns_name || hostaddr)))",
    "dns_view_param_list": None,
    "dns_view_param_info": "see reference guide (chapter 34, DNS View Options)",
    "dns_view_param_count": None,
    "dns_view_param_add": "see reference guide (chapter 34, DNS View Options)",
    "dns_view_param_delete": "see reference guide (chapter 34, DNS View Options)",
    "dns_zone_list": None,
    "dns_zone_info": "dnszone_id",
    "dns_zone_count": None,
    "dns_zone_add": "Addition: (dnszone_name && dnszone_type && (dnsview_id || dnsview_name) && (dns_id || dns_name || hostaddr)) | Edition: (dnszone_id || same combination as Addition)",
    "dns_zone_delete": "(dnszone_id || (dnszone_name && (dnsview_id || (dnsview_name && (dns_id || dns_name || hostaddr)))))",
    "dns_zone_param_list": None,
    "dns_zone_param_info": "see reference guide (chapter 35, DNS Zone Options)",
    "dns_zone_param_count": None,
    "dns_zone_param_add": "see reference guide (chapter 35, DNS Zone Options)",
    "dns_zone_param_delete": "see reference guide (chapter 35, DNS Zone Options)",
    "dns_rr_list": None,
    "dns_rr_info": "rr_id",
    "dns_rr_count": None,
    "dns_rr_add": "Addition: (rr_name && rr_type && value1 && (dns_id || dns_name || hostaddr)) | Edition: (rr_id || same combination as Addition)",
    "dns_rr_delete": "(rr_id || (rr_name && (dnszone_id || (dnszone_name && (dns_id || dns_name || hostaddr)))))",
    "dns_acl_list": None,
    "dns_acl_info": "dnsacl_id",
    "dns_acl_count": None,
    "dns_acl_add": "Addition: ((dnsacl_name && (dns_id || dns_name || hostaddr)) && dnsacl_value) | Edition: ((dnsacl_id || same name combination) && dnsacl_value)",
    "dns_acl_delete": "dnsacl_id",
    "dns_key_list": None,
    "dns_key_info": "dnskey_id",
    "dns_key_count": None,
    "dns_key_add": "(dnskey_name && (dns_id || dns_name || hostaddr)) — same for Addition and Edition",
    "dns_key_delete": "(dnskey_id || (dnskey_name && (dns_id || dns_name || hostaddr)))",
    "dnssec_zone_keys_list": "see reference guide (chapter 39, DNSSEC)",
    "dnssec_zone_keys_info": "see reference guide (chapter 39, DNSSEC)",
    "dnssec_enable_sign_zone": "(dnszone_id || (dnszone_name && (dns_id || dns_name || dns_hostaddr)))",
}


def solidserver_query(method: str, params: dict, mode: str, edit: bool = False) -> dict:
    """mode must be 'read' or 'write'. Raises ValueError if `method` isn't
    on the allowlist for that mode. `edit` only matters for write calls
    to an `*_add` method: False (default) issues POST/create, True
    issues PUT/edit. `dnssec_enable_sign_zone` ignores `edit` — it's an
    /rpc/ action service, always POST regardless."""
    allowlist = READ_METHODS if mode == "read" else WRITE_METHODS
    if method not in allowlist:
        raise ValueError(
            f"'{method}' is not an allowed {mode} DNS operation. "
            f"Allowed: {', '.join(sorted(allowlist))}"
        )
    return solidserver_client.call(method, params=params or {}, edit=edit)
