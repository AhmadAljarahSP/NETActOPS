from .. import __cli_package_version__, __platform_version__


def version() -> None:
    """Show netact CLI and platform version."""
    print(f"netact-cli {__cli_package_version__}")
    print(f"NETAct platform {__platform_version__}")
