#!/usr/bin/env python3
"""Managed HubSpot read-only entrypoint."""

import os
import sys

from connect_contract import command, fields, text
from connect_transport import (
    ConnectFailure,
    execute,
    managed_credentials,
    mark_untrusted,
    read_command,
    write_result,
)


CONNECTION_ENV = "MEDO_CONNECT_HUBSPOT"
ROUTES = {
    "search_contacts": "https://app-dz8miw66l2wx-api-connect-hubspot-search-contacts.gateway.appmedo.com/",
    "search_companies": "https://app-dz8miw66l2wx-api-connect-hubspot-search-companies.gateway.appmedo.com/",
    "search_deals": "https://app-dz8miw66l2wx-api-connect-hubspot-search-deals.gateway.appmedo.com/",
}


def validate(action, arguments):
    """Validate the public arguments for one fixed action."""
    fields(arguments, ("query", "after"), ("query",))
    text(arguments, "query", required=True, max_length=2_048)
    text(arguments, "after")


def handle(value, environ=os.environ, sender=execute):
    """Validate and execute one managed Connect command."""
    action, arguments = command(value, ROUTES)
    validate(action, arguments)
    gateway_jwt, connection = managed_credentials(environ, CONNECTION_ENV)
    return mark_untrusted(sender(ROUTES[action], gateway_jwt, connection, arguments))


def main():
    """Run the stdin-to-stdout command entrypoint."""
    try:
        result = handle(read_command(sys.stdin.buffer))
        exit_code = 0
    except ConnectFailure as failure:
        result = failure.as_result()
        exit_code = 1
    except Exception:
        result = ConnectFailure("RESULT_UNKNOWN", "The provider result is unknown").as_result()
        exit_code = 1
    write_result(sys.stdout, result)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
