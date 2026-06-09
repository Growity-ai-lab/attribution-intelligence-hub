"""Symmetric encryption for persisting sensitive data (BQ credentials)."""

import logging
import os

from cryptography.fernet import Fernet

_log = logging.getLogger(__name__)

_cached_key: bytes | None = None


def _get_key() -> bytes:
    global _cached_key
    if _cached_key is not None:
        return _cached_key

    env_key = os.environ.get("ENCRYPTION_KEY", "")
    if env_key:
        _cached_key = env_key.encode() if isinstance(env_key, str) else env_key
        return _cached_key

    _cached_key = Fernet.generate_key()
    _log.warning(
        "ENCRYPTION_KEY not set — using random ephemeral key. "
        "Encrypted data will NOT be decryptable after restart. "
        "Set ENCRYPTION_KEY in production."
    )
    return _cached_key


def encrypt(plaintext: str) -> str:
    return Fernet(_get_key()).encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    return Fernet(_get_key()).decrypt(ciphertext.encode()).decode()
