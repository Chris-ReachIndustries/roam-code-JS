"""Data models for the application."""


class User:
    """A user model."""

    def __init__(self, name, email):
        self.name = name
        self.email = email

    def greet(self):
        return f"Hello, {self.name}!"


class Admin(User):
    """An admin user with extra permissions."""

    role = "admin"

    def __init__(self, name, email, level=1):
        super().__init__(name, email)
        self.level = level

    def promote(self):
        self.level += 1
