"""SOLIDserver IPAM gateway — the only place NETAct talks to an
EfficientIP SOLIDserver appliance's IPAM services. Same posture as
run-command/push-config for network devices in app.py: Ansible (or
anything else) reaches the appliance through backend only, never
directly, and every call is checked against an explicit allowlist of
REST service names rather than trusting a caller's claim about what's
safe. An allowlist (not a blocklist) is used here because this is a
structured method+params API, not free-text CLI — only operations this
project has actually vetted are reachable at all.

Talks to the appliance via solidserver_client.py's direct REST calls, not
the third-party SOLIDserverRest SDK (dropped — its internal service-name
translation table made it unclear what request was actually being sent;
see solidserver_client.py's module docstring for the full reasoning).

Method names and Mandatory Input Parameters below are verified against
EfficientIP's own "SOLIDserver API: REST Reference Guide" (version 7.3,
revision #100648), chapters 5 "Space", 6 "IPv4 Network", 10 "IPv4
Address") — not inferred from any SDK, and not guessed.
"""
import logging
import solidserver_client

logger = logging.getLogger("backend.ipam_solidserver")

is_configured = solidserver_client.is_configured

# ip_site_*    = Space          (Reference Guide chapter 5)
# ip_*subnet*  = IPv4 Network   (chapter 6)
# ip_*         = IPv4 Address   (chapter 10)
READ_METHODS = {
    "ip_site_list", "ip_site_info",
    "ip_block_subnet_list", "ip_block_subnet_info", "ip_find_free_subnet",
    "ip_address_list", "ip_address_info", "ip_find_free_address",
}
WRITE_METHODS = {
    "ip_site_add", "ip_site_delete",
    "ip_subnet_add", "ip_subnet_delete",
    "ip_add", "ip_delete",
}

# Mandatory Input Parameters exactly as documented per-service in the
# Reference Guide (informational only — this module does not re-implement
# SOLIDserver's own validation, it just gives callers/docs an accurate
# answer to "what does this method need" without going back to the PDF).
# "||" = alternative, "&&" = required-together, matching the guide's notation.
MANDATORY_PARAMS = {
    "ip_site_list": None,  # no mandatory params — WHERE/ORDERBY/etc. all optional filters
    "ip_site_info": "site_id",
    "ip_site_add": "Addition: site_name | Edition: (site_id || site_name)",
    "ip_site_delete": "(site_id || site_name)",
    "ip_block_subnet_list": None,
    "ip_block_subnet_info": "subnet_id",
    "ip_subnet_add": (
        "Addition: (subnet_addr && (subnet_end_addr || subnet_size || subnet_mask || "
        "subnet_prefix) && (site_id || site_name || parent_subnet_id)) | "
        "Edition: subnet_id or the same combination as Addition"
    ),
    "ip_subnet_delete": (
        "(subnet_id || (subnet_addr && (subnet_end_addr || subnet_size || subnet_mask || "
        "subnet_prefix) && (site_id || site_name || parent_subnet_id)))"
    ),
    "ip_find_free_subnet": "(prefix || size)",
    "ip_address_list": None,
    "ip_address_info": "ip_id",
    "ip_add": "Addition: (hostaddr && (site_id || site_name)) | Edition: (ip_id || (hostaddr && (site_id || site_name)))",
    "ip_delete": "(ip_id || (hostaddr && (site_id || site_name)))",
    "ip_find_free_address": "(subnet_id || pool_id || parent_subnet_id)",
}


def solidserver_query(method: str, params: dict, mode: str, edit: bool = False) -> dict:
    """mode must be 'read' or 'write'. Raises ValueError if `method` isn't
    on the allowlist for that mode — never falls through to an unvetted
    REST service name. `edit` only matters for write calls to an `*_add`
    method: False (default) issues POST/create, True issues PUT/edit."""
    allowlist = READ_METHODS if mode == "read" else WRITE_METHODS
    if method not in allowlist:
        raise ValueError(
            f"'{method}' is not an allowed {mode} IPAM operation. "
            f"Allowed: {', '.join(sorted(allowlist))}"
        )
    return solidserver_client.call(method, params=params or {}, edit=edit)
