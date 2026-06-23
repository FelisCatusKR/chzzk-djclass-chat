import base64

import pytest

from djclass_overlay.common import crypto


def test_round_trip():
    assert crypto.decrypt(crypto.encrypt("hello-token")) == "hello-token"


def test_nonce_makes_ciphertext_unique():
    # same plaintext -> different ciphertext (random per-record nonce)
    assert crypto.encrypt("x") != crypto.encrypt("x")


def test_tamper_is_rejected():
    token = crypto.encrypt("secret")
    raw = bytearray(base64.b64decode(token))
    raw[-1] ^= 0x01  # flip a ciphertext bit
    with pytest.raises(Exception):
        crypto.decrypt(base64.b64encode(bytes(raw)).decode())
