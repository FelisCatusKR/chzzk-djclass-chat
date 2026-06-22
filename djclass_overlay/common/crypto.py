import base64
import hashlib
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from django.conf import settings


def _key() -> bytes:
    # 32-byte AES-256 key derived from the env secret (any length in, 32 bytes out)
    return hashlib.sha256(settings.VARCHIVE_TOKEN_KEY.encode()).digest()


def encrypt(plaintext: str) -> str:
    nonce = os.urandom(12)
    ct = AESGCM(_key()).encrypt(nonce, plaintext.encode(), None)
    return base64.b64encode(nonce + ct).decode()


def decrypt(token: str) -> str:
    raw = base64.b64decode(token)
    nonce, ct = raw[:12], raw[12:]
    return AESGCM(_key()).decrypt(nonce, ct, None).decode()
