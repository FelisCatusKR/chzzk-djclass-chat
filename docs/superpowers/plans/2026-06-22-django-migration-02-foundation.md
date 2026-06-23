# Django Foundation — Implementation Plan (migration plan 2/8)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Django 6.0 project on PostgreSQL with the 4 domain models (custom `User`, `Channel`, `VarchiveToken`, `DjClass`), Django admin, and a tested AES-256-GCM crypto module. No prod data (Plan 3), no auth flow (Plan 4), no realtime (Plan 5).

**Architecture:** cookiecutter-django-style 2-tier layout (`config/` settings package + `djclass_overlay/` package of domain apps), settings split via `django-environ`, Postgres in Docker for local dev, deps via `uv` + `pyproject.toml`. Custom `User(AbstractBaseUser, PermissionsMixin)` keyed on `chzzk_id` (passwordless — OAuth lands in Plan 4). Django files coexist with the legacy Node app at the repo root until cutover.

**Tech Stack:** Python 3.13.5, Django 6.0.6, psycopg 3, django-environ, cryptography, pytest-django, uv, Docker Compose (`postgres:18`).

---

> **TDD where it matters** (crypto, models). Run everything from the **repo root** on branch `feat/django-migration`. Django files (`manage.py`, `config/`, `djclass_overlay/`, `pyproject.toml`, `docker-compose.yml`) do not collide with the Node files (`package.json`, `src/`, …). Management commands run via `uv run`.

## Prerequisites
- Python 3.13.5, Docker + Compose (verified available).
- On branch `feat/django-migration`.
- `VARCHIVE_TOKEN_KEY` and `SECRET_KEY` values (any 32+ char strings for dev).

## File structure (created by this plan)

```
manage.py
pyproject.toml                       # uv-managed deps + pytest config
uv.lock
docker-compose.yml                   # local Postgres
.env                                 # local env (django-environ) — add to .gitignore
config/
  __init__.py  urls.py  asgi.py  wsgi.py
  settings/__init__.py  base.py  local.py  production.py
djclass_overlay/
  __init__.py
  common/    __init__.py apps.py crypto.py tests/test_crypto.py
  users/     __init__.py apps.py models.py admin.py migrations/ tests/test_models.py
  streamers/ __init__.py apps.py models.py admin.py migrations/ tests/test_models.py
  viewers/   __init__.py apps.py models.py admin.py migrations/ tests/test_models.py
  djclass/   __init__.py apps.py models.py admin.py migrations/ tests/test_models.py
```

---

### Task 1: Project bootstrap (uv + Django + app skeletons)

**Files:** Create `pyproject.toml`, `manage.py`, `config/`, `djclass_overlay/` apps.

- [ ] **Step 1: Install uv (standalone, no system-pip needed)**

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"   # add to shell rc too
uv --version    # expect: uv 0.x
```

- [ ] **Step 2: Init project + add deps**

```bash
uv init --bare --python 3.13
uv add "django==6.0.6" "psycopg[binary]" django-environ cryptography
uv add --dev pytest pytest-django
uv run django-admin --version   # expect: 6.0.6
```

- [ ] **Step 3: Scaffold the config project + the app package**

```bash
uv run django-admin startproject config .
mkdir -p djclass_overlay/common djclass_overlay/users djclass_overlay/streamers djclass_overlay/viewers djclass_overlay/djclass
touch djclass_overlay/__init__.py
for app in common users streamers viewers djclass; do
  uv run python manage.py startapp $app djclass_overlay/$app
done
```

- [ ] **Step 4: Point each app's `apps.py` at its dotted path** (startapp writes the bare label). For every app, edit `djclass_overlay/<app>/apps.py` so `name = "djclass_overlay.<app>"`, e.g.:

```python
# djclass_overlay/users/apps.py
from django.apps import AppConfig


class UsersConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "djclass_overlay.users"
```

(Repeat for `common`, `streamers`, `viewers`, `djclass` with matching class names.)

- [ ] **Step 5: Verify the project imports** (settings split comes next, so a bare check):

Run: `uv run python -c "import django; print(django.get_version())"`
Expected: `6.0.6`

---

### Task 2: Docker Postgres + settings split

**Files:** Create `docker-compose.yml`, `.env`; split `config/settings/`.

- [ ] **Step 1: Local Postgres**

`docker-compose.yml`:

```yaml
services:
  db:
    image: postgres:18
    environment:
      POSTGRES_DB: djclass_overlay
      POSTGRES_USER: djclass
      POSTGRES_PASSWORD: devpassword
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```

Run: `docker compose up -d && docker compose ps`
Expected: the `db` service is `running` / healthy.

- [ ] **Step 2: `.env`** (add `.env` to `.gitignore`):

```
DJANGO_SETTINGS_MODULE=config.settings.local
DJANGO_SECRET_KEY=dev-only-change-me-32-characters-min
DATABASE_URL=postgres://djclass:devpassword@localhost:5432/djclass_overlay
VARCHIVE_TOKEN_KEY=dev-token-key-32-characters-minimum
```

- [ ] **Step 3: Replace `config/settings.py` with a package**

```bash
rm config/settings.py
mkdir config/settings
touch config/settings/__init__.py
```

`config/settings/base.py`:

```python
from pathlib import Path
import environ

BASE_DIR = Path(__file__).resolve().parent.parent.parent
env = environ.Env()
environ.Env.read_env(BASE_DIR / ".env")

SECRET_KEY = env("DJANGO_SECRET_KEY")
VARCHIVE_TOKEN_KEY = env("VARCHIVE_TOKEN_KEY")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "djclass_overlay.common",
    "djclass_overlay.users",
    "djclass_overlay.streamers",
    "djclass_overlay.viewers",
    "djclass_overlay.djclass",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "djclass_overlay" / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {"context_processors": [
            "django.template.context_processors.request",
            "django.contrib.auth.context_processors.auth",
            "django.contrib.messages.context_processors.messages",
        ]},
    },
]

DATABASES = {"default": env.db("DATABASE_URL")}
AUTH_USER_MODEL = "users.User"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
LANGUAGE_CODE = "ko-kr"
TIME_ZONE = "Asia/Seoul"
USE_TZ = True
STATIC_URL = "static/"
```

`config/settings/local.py`:

```python
from .base import *  # noqa

DEBUG = True
ALLOWED_HOSTS = ["localhost", "127.0.0.1"]
```

`config/settings/production.py`:

```python
from .base import *  # noqa

DEBUG = False
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=[])  # noqa: F405
```

- [ ] **Step 4: Verify Django connects to Postgres**

Run: `uv run python manage.py check && uv run python manage.py migrate`
Expected: `System check identified no issues`, then the built-in migrations apply against Postgres with no errors.

---

### Task 3: `common.crypto` — AES-256-GCM (TDD)

**Files:** Create `djclass_overlay/common/crypto.py`, `djclass_overlay/common/tests/test_crypto.py`.

- [ ] **Step 1: Configure pytest** — append to `pyproject.toml`:

```toml
[tool.pytest.ini_options]
DJANGO_SETTINGS_MODULE = "config.settings.local"
python_files = ["test_*.py"]
```

Also `mkdir -p djclass_overlay/common/tests && touch djclass_overlay/common/tests/__init__.py`.

- [ ] **Step 2: Write the failing test**

`djclass_overlay/common/tests/test_crypto.py`:

```python
import pytest
from djclass_overlay.common import crypto


def test_round_trip():
    assert crypto.decrypt(crypto.encrypt("hello-token")) == "hello-token"


def test_nonce_makes_ciphertext_unique():
    # same plaintext -> different ciphertext (random per-record nonce)
    assert crypto.encrypt("x") != crypto.encrypt("x")


def test_tamper_is_rejected():
    import base64

    token = crypto.encrypt("secret")
    raw = bytearray(base64.b64decode(token))
    raw[-1] ^= 0x01  # flip a ciphertext bit
    with pytest.raises(Exception):
        crypto.decrypt(base64.b64encode(bytes(raw)).decode())
```

- [ ] **Step 3: Run — expect failure**

Run: `uv run pytest djclass_overlay/common/tests/test_crypto.py -q`
Expected: FAIL — `ModuleNotFoundError` / `AttributeError: module 'crypto' has no attribute 'encrypt'`.

- [ ] **Step 4: Implement**

`djclass_overlay/common/crypto.py`:

```python
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
```

- [ ] **Step 5: Run — expect pass**

Run: `uv run pytest djclass_overlay/common/tests/test_crypto.py -q`
Expected: `3 passed`.

- [ ] **Step 6: Commit**

```bash
git add pyproject.toml uv.lock manage.py config djclass_overlay docker-compose.yml
git commit -m "feat: scaffold Django project + AES-256-GCM crypto"
```

---

### Task 4: `users.User` — custom user model (TDD)

**Files:** `djclass_overlay/users/models.py`, `djclass_overlay/users/tests/test_models.py`.

- [ ] **Step 1: Write the failing test** (`mkdir -p djclass_overlay/users/tests && touch djclass_overlay/users/tests/__init__.py`)

```python
import pytest
from djclass_overlay.users.models import User


@pytest.mark.django_db
def test_create_user_is_passwordless():
    u = User.objects.create_user(chzzk_id="abc", chzzk_nickname="Nick")
    assert u.chzzk_id == "abc"
    assert u.has_usable_password() is False
    assert u.is_authenticated is True


@pytest.mark.django_db
def test_chzzk_id_unique():
    User.objects.create_user(chzzk_id="dup", chzzk_nickname="A")
    with pytest.raises(Exception):
        User.objects.create_user(chzzk_id="dup", chzzk_nickname="B")
```

- [ ] **Step 2: Run — expect fail** (`ImportError` / no table)

Run: `uv run pytest djclass_overlay/users/tests/test_models.py -q`

- [ ] **Step 3: Implement the model + manager**

`djclass_overlay/users/models.py`:

```python
from django.contrib.auth.models import (
    AbstractBaseUser,
    BaseUserManager,
    PermissionsMixin,
)
from django.db import models


class UserManager(BaseUserManager):
    use_in_migrations = True

    def create_user(self, chzzk_id, chzzk_nickname="", **extra):
        if not chzzk_id:
            raise ValueError("chzzk_id is required")
        user = self.model(chzzk_id=chzzk_id, chzzk_nickname=chzzk_nickname, **extra)
        user.set_unusable_password()
        user.save(using=self._db)
        return user

    def create_superuser(self, chzzk_id, chzzk_nickname="admin", password=None, **extra):
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        user = self.model(chzzk_id=chzzk_id, chzzk_nickname=chzzk_nickname, **extra)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save(using=self._db)
        return user


class User(AbstractBaseUser, PermissionsMixin):
    chzzk_id = models.CharField(max_length=64, unique=True)
    chzzk_nickname = models.CharField(max_length=255)
    preferred_button = models.PositiveSmallIntegerField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    USERNAME_FIELD = "chzzk_id"
    REQUIRED_FIELDS = ["chzzk_nickname"]
    objects = UserManager()

    class Meta:
        db_table = "users"

    def __str__(self):
        return self.chzzk_nickname
```

- [ ] **Step 4: Make + apply the migration, run tests**

```bash
uv run python manage.py makemigrations users
uv run python manage.py migrate
uv run pytest djclass_overlay/users/tests/test_models.py -q   # expect: 2 passed
```

- [ ] **Step 5: Commit**

```bash
git add djclass_overlay/users
git commit -m "feat: custom Chzzk User model (passwordless, chzzk_id key)"
```

---

### Task 5: `streamers.Channel` (TDD)

**Files:** `djclass_overlay/streamers/models.py`, `.../tests/test_models.py`.

- [ ] **Step 1: Failing test** (`mkdir -p .../tests && touch __init__.py`)

```python
import pytest
from djclass_overlay.users.models import User
from djclass_overlay.streamers.models import Channel


@pytest.mark.django_db
def test_channel_one_per_user():
    u = User.objects.create_user(chzzk_id="s1", chzzk_nickname="S")
    Channel.objects.create(user=u, chzzk_channel_id="chan1")
    with pytest.raises(Exception):
        Channel.objects.create(user=u, chzzk_channel_id="chan2")
```

- [ ] **Step 2: Implement** `djclass_overlay/streamers/models.py`:

```python
from django.conf import settings
from django.db import models


class Channel(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    chzzk_channel_id = models.CharField(max_length=64, unique=True)
    chzzk_access_token_encrypted = models.TextField(null=True, blank=True)
    chzzk_refresh_token_encrypted = models.TextField(null=True, blank=True)
    token_expires_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "channels"

    def __str__(self):
        return self.chzzk_channel_id
```

- [ ] **Step 3:** `uv run python manage.py makemigrations streamers && uv run python manage.py migrate && uv run pytest djclass_overlay/streamers -q` → expect pass. Commit `feat: Channel model`.

---

### Task 6: `viewers.VarchiveToken` (TDD)

**Files:** `djclass_overlay/viewers/models.py`, `.../tests/test_models.py`.

- [ ] **Step 1: Failing test**

```python
import pytest
from djclass_overlay.users.models import User
from djclass_overlay.viewers.models import VarchiveToken


@pytest.mark.django_db
def test_varchive_token_defaults_active():
    u = User.objects.create_user(chzzk_id="v1", chzzk_nickname="V")
    t = VarchiveToken.objects.create(user=u, token_encrypted="enc", varchive_nickname="vnick")
    assert t.is_active is True
```

- [ ] **Step 2: Implement** `djclass_overlay/viewers/models.py`:

```python
from django.conf import settings
from django.db import models


class VarchiveToken(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    token_encrypted = models.TextField()
    varchive_nickname = models.CharField(max_length=255)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "varchive_tokens"
```

- [ ] **Step 3:** makemigrations viewers → migrate → `uv run pytest djclass_overlay/viewers -q` → pass. Commit `feat: VarchiveToken model`.

---

### Task 7: `djclass.DjClass` (TDD)

**Files:** `djclass_overlay/djclass/models.py`, `.../tests/test_models.py`.

- [ ] **Step 1: Failing test**

```python
import pytest
from djclass_overlay.users.models import User
from djclass_overlay.djclass.models import DjClass


@pytest.mark.django_db
def test_unique_user_button():
    u = User.objects.create_user(chzzk_id="d1", chzzk_nickname="D")
    DjClass.objects.create(user=u, button=4, dj_class="SS II")
    with pytest.raises(Exception):
        DjClass.objects.create(user=u, button=4, dj_class="HL I")


@pytest.mark.django_db
def test_button_must_be_valid():
    u = User.objects.create_user(chzzk_id="d2", chzzk_nickname="D")
    with pytest.raises(Exception):
        DjClass.objects.create(user=u, button=7, dj_class="SS II")  # 7 not in {4,5,6,8}
```

- [ ] **Step 2: Implement** `djclass_overlay/djclass/models.py`:

```python
from django.conf import settings
from django.db import models


class DjClass(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    button = models.PositiveSmallIntegerField()
    dj_class = models.CharField(max_length=64)
    dj_power_sum = models.FloatField(null=True, blank=True)
    max_dj_power = models.FloatField(null=True, blank=True)
    dj_power_conversion = models.FloatField(null=True, blank=True)
    synced_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "dj_classes"
        constraints = [
            models.UniqueConstraint(fields=["user", "button"], name="uniq_user_button"),
            models.CheckConstraint(
                condition=models.Q(button__in=[4, 5, 6, 8]), name="button_valid"
            ),
        ]
```

> Note: `test_button_must_be_valid` requires the DB-level check, so the test does `DjClass.objects.create(...)` (which hits the DB). Django 6.0 uses `condition=` (not the pre-5.1 `check=`).

- [ ] **Step 3:** makemigrations djclass → migrate → `uv run pytest djclass_overlay/djclass -q` → pass. Commit `feat: DjClass model with unique(user,button) + button check`.

---

### Task 8: Admin registration + boot verification

**Files:** `djclass_overlay/<app>/admin.py` for users/streamers/viewers/djclass.

- [ ] **Step 1: Register each model.** Example `djclass_overlay/users/admin.py`:

```python
from django.contrib import admin
from .models import User


@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    list_display = ("chzzk_id", "chzzk_nickname", "preferred_button", "created_at")
    search_fields = ("chzzk_id", "chzzk_nickname")
```

Repeat for `Channel` (list_display: chzzk_channel_id, user, token_expires_at), `VarchiveToken` (varchive_nickname, user, is_active), `DjClass` (user, button, dj_class, synced_at). **Never** put the encrypted-token fields in `list_display`/`search_fields`.

- [ ] **Step 2: Create an admin login + boot the server**

```bash
uv run python manage.py createsuperuser   # chzzk_id = any, set a password
uv run python manage.py runserver 0.0.0.0:8001
```

Open `http://localhost:8001/admin`, log in. Expected: all four models listed and browsable.

- [ ] **Step 3: Full test sweep + commit**

```bash
uv run pytest -q                       # expect: all green
uv run python manage.py check          # no issues
git add djclass_overlay
git commit -m "feat: register models in Django admin"
```

---

## Self-Review

- **Spec coverage:** §4.1 layout (2-tier, 5 apps + common) ✓ · §4.2 four models + db_table + unique(user,button) + button check ✓ · §4.3 crypto AESGCM 256-bit + per-record nonce ✓ · §7 settings split + uv + Postgres ✓. Deferred by design: auth flow (Plan 4), realtime (Plan 5), data import (Plan 3).
- **Placeholders:** none — every model/crypto/settings block is complete code.
- **Type consistency:** `crypto.encrypt/decrypt`, `User.objects.create_user`, `settings.AUTH_USER_MODEL` used consistently across tasks; table names (`users`/`channels`/`varchive_tokens`/`dj_classes`) match the legacy schema for a clean Plan 3 import.
- **Deliverable:** `uv run pytest` green + `/admin` shows 4 models on Postgres = a bootable, tested Django foundation.
