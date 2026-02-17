"""Service layer for user operations."""

from models import User, Admin


def create_user(name, email):
    """Create a new user."""
    return User(name, email)


def create_admin(name, email, level=1):
    """Create a new admin."""
    return Admin(name, email, level)


def get_greeting(user):
    """Get a greeting for a user."""
    return user.greet()
