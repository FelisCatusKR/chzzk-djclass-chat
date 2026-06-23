"""Validate a `next` redirect target as a safe, same-origin relative path.

Port of src/lib/safe-redirect.ts. Rejects absolute and protocol-relative URLs
("//host", "/\\host") to prevent open redirects.
"""


def safe_next_path(next_path: str, fallback: str = "/dashboard/") -> str:
    if not next_path:
        return fallback
    if not next_path.startswith("/"):
        return fallback
    # Reject protocol-relative ("//") and backslash tricks ("/\") that browsers
    # may treat as a scheme-relative URL to another host.
    if next_path[1:2] in ("/", "\\"):
        return fallback
    return next_path
