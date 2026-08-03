"""Direct REST client for EfficientIP SOLIDserver.

Replaces an earlier version of this integration that depended on the
third-party `SOLIDserverRest` Python SDK. That SDK carries its own
internal service-name translation table (mapping convenience names like
`ip_site_create` to the real wire-level service `ip_site_add`, and
picking an HTTP verb via a suffix-matching heuristic) which made it hard
to know, without reading the SDK's own source, exactly what request this
project's code would actually send. Talking to the documented REST API
directly removes that layer of indirection entirely — every call this
module makes is fully explicit: exact URL, exact HTTP verb, exact params.

Everything here follows EfficientIP's own "SOLIDserver API: REST
Reference Guide" (version 7.3, revision #100648), specifically:
  - Chapter 2 "Calling SOLIDserver Services" — URL format
    `https://<host>/<rest-or-rpc>/<service-name>?<params>`, and
    authentication via the X-IPM-Username / X-IPM-Password headers
    (base64-encoded credentials) or HTTP Basic Auth.
  - Chapter 3 "SOLIDserver Key Services", Table 2.1 "Supported HTTP
    Verbs": POST creates (`*_add`, not idempotent), PUT edits (`*_add`,
    idempotent), GET reads (`*_list`/`*_info`/`*_count`), DELETE removes
    (`*_delete`). `/rest/` is used for exactly those five key-service
    families; `/rpc/` is used for every other service (e.g. `*_find_free`,
    `dnssec_enable_sign_zone`).
"""
import os
import base64
import logging
import requests

logger = logging.getLogger("backend.solidserver_client")

SOLIDSERVER_HOST = os.getenv("SOLIDSERVER_HOST", "")
SOLIDSERVER_USER = os.getenv("SOLIDSERVER_USER", "")
SOLIDSERVER_PASSWORD = os.getenv("SOLIDSERVER_PASSWORD", "")
# SOLIDserver appliances ship with a self-signed certificate by default;
# the reference guide itself tells REST GUI clients to "ignore the
# self-signed certificate" unless one has been imported. Verification is
# opt-in via env var once a real certificate is in place.
SOLIDSERVER_VERIFY_SSL = os.getenv("SOLIDSERVER_VERIFY_SSL", "false").strip().lower() in ("1", "true", "yes")


def is_configured() -> bool:
    return bool(SOLIDSERVER_HOST and SOLIDSERVER_USER and SOLIDSERVER_PASSWORD)


def _auth_headers() -> dict:
    user_b64 = base64.b64encode(SOLIDSERVER_USER.encode("utf-8")).decode("ascii")
    pass_b64 = base64.b64encode(SOLIDSERVER_PASSWORD.encode("utf-8")).decode("ascii")
    return {"X-IPM-Username": user_b64, "X-IPM-Password": pass_b64}


class SolidserverAPIError(Exception):
    """Raised when SOLIDserver itself returns an HTTP error status. Carries
    the parsed error body (errno/errmsg/severity per the reference guide's
    Output Parameters convention) so callers can surface it verbatim."""
    def __init__(self, status_code: int, body):
        self.status_code = status_code
        self.body = body
        super().__init__(f"SOLIDserver returned HTTP {status_code}: {body}")


def _verb_and_path_kind(service: str, edit: bool) -> tuple:
    """Table 2.1 mapping, from the service name's own suffix — no
    alias/translation table, just the documented convention every *_add/
    *_list/*_info/*_count/*_delete service follows."""
    if service.endswith("_add"):
        return ("PUT" if edit else "POST"), "rest"
    if service.endswith("_delete"):
        return "DELETE", "rest"
    if service.endswith("_list") or service.endswith("_info") or service.endswith("_count"):
        return "GET", "rest"
    # Everything else (find_free services, dnssec_enable_sign_zone, ...)
    # is an /rpc/ action service, called with POST per the reference guide.
    return "POST", "rpc"


def call(service: str, params: dict = None, edit: bool = False, timeout: int = 30) -> dict:
    """Executes one SOLIDserver REST/RPC call and returns the parsed JSON
    body. `edit` only matters for `*_add` services — False (default)
    issues POST (create), True issues PUT (edit an existing object,
    identified by an id/name param already present in `params`).

    Raises RuntimeError if SOLIDSERVER_HOST/USER/PASSWORD aren't set,
    SolidserverAPIError if the appliance itself returns >=400, and
    requests.RequestException on a transport-level failure (DNS, TCP,
    TLS, timeout)."""
    if not is_configured():
        raise RuntimeError(
            "SOLIDserver integration not configured — set SOLIDSERVER_HOST, "
            "SOLIDSERVER_USER, SOLIDSERVER_PASSWORD in the backend environment."
        )
    verb, path_kind = _verb_and_path_kind(service, edit)
    url = f"https://{SOLIDSERVER_HOST}/{path_kind}/{service}"

    logger.info("SOLIDserver call: %s %s params=%s", verb, url, params)
    resp = requests.request(
        verb,
        url,
        params=params or {},
        headers=_auth_headers(),
        verify=SOLIDSERVER_VERIFY_SSL,
        timeout=timeout,
    )

    try:
        body = resp.json()
    except ValueError:
        body = {"raw": resp.text}

    if resp.status_code >= 400:
        raise SolidserverAPIError(resp.status_code, body)

    return body
