import importlib
import sys


def test_production_uses_whitenoise_manifest_storage(monkeypatch):
    monkeypatch.setenv("DJANGO_SECRET_KEY", "x" * 50)
    monkeypatch.setenv("VARCHIVE_TOKEN_KEY", "k" * 32)
    monkeypatch.setenv("CHZZK_CLIENT_ID", "x")
    monkeypatch.setenv("CHZZK_CLIENT_SECRET", "x")
    monkeypatch.setenv("DATABASE_URL", "sqlite:////tmp/x.db")
    monkeypatch.setenv("DJANGO_ALLOWED_HOSTS", "example.com")
    monkeypatch.setenv("BASE_URL", "https://example.com")  # required in production.py
    sys.modules.pop(
        "config.settings.production", None
    )  # fresh import under the patched env
    prod = importlib.import_module("config.settings.production")
    assert (
        prod.STORAGES["staticfiles"]["BACKEND"]
        == "whitenoise.storage.CompressedManifestStaticFilesStorage"
    )
