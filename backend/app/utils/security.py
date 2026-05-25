"""
OmniBot SaaS — AES-256 Encryption Utility
Encrypts Facebook / Instagram page access tokens before storing in DB.
"""
import base64
import hashlib
import os
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
from app.config import settings


def _get_key() -> bytes:
    """Derive a 32-byte key from the configured secret."""
    raw = settings.AES_SECRET_KEY.encode()
    return hashlib.sha256(raw).digest()


def encrypt_token(plain_text: str) -> str:
    """AES-256-CBC encrypt → base64 string (iv:ciphertext)."""
    key = _get_key()
    iv = os.urandom(16)
    padded = _pad(plain_text.encode())
    cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
    enc = cipher.encryptor()
    ct = enc.update(padded) + enc.finalize()
    combined = iv + ct
    return base64.b64encode(combined).decode()


def decrypt_token(encrypted: str) -> str:
    """Reverse of encrypt_token — returns plain-text string."""
    key = _get_key()
    combined = base64.b64decode(encrypted.encode())
    iv = combined[:16]
    ct = combined[16:]
    cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
    dec = cipher.decryptor()
    padded = dec.update(ct) + dec.finalize()
    return _unpad(padded).decode()


def _pad(data: bytes) -> bytes:
    pad_len = 16 - (len(data) % 16)
    return data + bytes([pad_len] * pad_len)


def _unpad(data: bytes) -> bytes:
    return data[: -data[-1]]
