"""Utility functions."""

MAX_NAME_LENGTH = 100


def validate_email(email):
    """Check if an email address is valid."""
    return "@" in email and "." in email


def truncate_name(name, max_length=MAX_NAME_LENGTH):
    """Truncate a name to max_length characters."""
    if len(name) > max_length:
        return name[:max_length]
    return name
