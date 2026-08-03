from importlib.metadata import PackageNotFoundError, version as _pkg_version

from .config import VERSION_FILE

try:
    __cli_package_version__ = _pkg_version("netact-cli")
except PackageNotFoundError:
    __cli_package_version__ = "0.0.0-dev"

try:
    __platform_version__ = VERSION_FILE.read_text().strip()
except FileNotFoundError:
    __platform_version__ = "unknown"
