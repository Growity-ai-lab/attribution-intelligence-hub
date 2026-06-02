"""Symmetric encryption for persisting sensitive data (BQ credentials)."""

import os
from pathlib import Path

from cryptography.fernet import Fernet

_KEY_FILE = Path("attribution_hub.key")


def _get_key() -> bytes:
    env_key = os.environ.get("ENCRYPTION_KEY", "")
    if env_key:
        return env_key.encode() if isinstance(env_key, str) else env_key
    if _KEY_FILE.exists():
        return _KEY_FILE.read_bytes().strip()
    key = Fernet.generate_key()
    _KEY_FILE.write_bytes(key)
    return key


def encrypt(plaintext: str) -> str:
    return Fernet(_get_key()).encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    return Fernet(_get_key()).decrypt(ciphertext.encode()).decode()
