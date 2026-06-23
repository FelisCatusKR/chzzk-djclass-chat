# Data Migration (SQLite → Postgres) — Implementation Plan (migration plan 3/8)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Move the existing `data/app.db` (SQLite, Node-encrypted tokens) into Postgres via Django, re-encrypting tokens with the new Python AES-GCM scheme — **no user re-link**.

**Architecture (2-script — eliminates R4):** A Node **export** script reads `data/app.db` and decrypts tokens with the *existing, proven* `src/lib/crypto.ts`, emitting a nested JSON (one entry per user with their channel/varchive_token/dj_classes and **plaintext** tokens). A Django **import** management command re-encrypts with `djclass_overlay.common.crypto` and `update_or_create`s the rows. Neither side reimplements the other's crypto, so the risky "replicate Node format in Python" task disappears.

**Tech Stack:** Node `tsx` + `better-sqlite3` + `src/lib/crypto` (export); Django management command + `common.crypto` (import).

---

> **Secret handling:** the intermediate JSON contains **plaintext tokens**. Write it to a tmp path, never commit it, delete it after import. One-time local migration on the owner's machine.

### Task 1: Node export script

**Files:** Create `scripts/migration-export.ts`.

- [ ] **Step 1: Write the export** (`scripts/migration-export.ts`):

```ts
// One-time migration export: decrypt with the app's own crypto, emit nested JSON.
//   npx tsx scripts/migration-export.ts > /tmp/legacy.json
process.loadEnvFile('.env')

async function main() {
  const { default: Database } = await import('better-sqlite3')
  const { decrypt } = await import('../src/lib/crypto')
  const db = new Database('data/app.db', { readonly: true })

  const users = db.prepare('SELECT * FROM users').all() as any[]
  const out = users.map((u) => {
    const ch = db.prepare('SELECT * FROM channels WHERE user_id=?').get(u.id) as any
    const vt = db.prepare('SELECT * FROM varchive_tokens WHERE user_id=?').get(u.id) as any
    const djs = db.prepare('SELECT * FROM dj_classes WHERE user_id=?').all(u.id) as any[]
    return {
      chzzk_id: u.chzzk_id,
      chzzk_nickname: u.chzzk_nickname,
      preferred_button: u.preferred_button ?? null,
      channel: ch
        ? {
            chzzk_channel_id: ch.chzzk_channel_id,
            access_token: ch.chzzk_access_token_encrypted
              ? decrypt(ch.chzzk_access_token_encrypted)
              : null,
            refresh_token: ch.chzzk_refresh_token_encrypted
              ? decrypt(ch.chzzk_refresh_token_encrypted)
              : null,
            token_expires_at: ch.token_expires_at ?? null,
          }
        : null,
      varchive_token: vt
        ? {
            token: decrypt(vt.token_encrypted),
            varchive_nickname: vt.varchive_nickname,
            is_active: !!vt.is_active,
          }
        : null,
      dj_classes: djs.map((d) => ({
        button: d.button,
        dj_class: d.dj_class,
        dj_power_sum: d.dj_power_sum,
        max_dj_power: d.max_dj_power,
        dj_power_conversion: d.dj_power_conversion,
      })),
    }
  })
  process.stdout.write(JSON.stringify(out, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 2: Run it + sanity-check** (counts, no plaintext leak to console)

```bash
npx tsx scripts/migration-export.ts > /tmp/legacy.json
node -e "const d=require('/tmp/legacy.json');console.log('users:',d.length,'| channels:',d.filter(x=>x.channel).length,'| varchive:',d.filter(x=>x.varchive_token).length)"
```

Expected: counts matching the SQLite tables (2 users etc.).

---

### Task 2: Django import management command (TDD)

**Files:** Create `djclass_overlay/common/management/commands/import_legacy.py`, `djclass_overlay/common/tests/test_import.py`. (Also `mkdir -p djclass_overlay/common/management/commands` + `__init__.py` in `management/` and `management/commands/`.)

- [ ] **Step 1: Write the failing test** (`djclass_overlay/common/tests/test_import.py`):

```python
import json

import pytest
from django.core.management import call_command

from djclass_overlay.common import crypto
from djclass_overlay.streamers.models import Channel
from djclass_overlay.users.models import User


@pytest.mark.django_db
def test_import_legacy(tmp_path):
    data = [
        {
            "chzzk_id": "u1",
            "chzzk_nickname": "Nick",
            "preferred_button": 6,
            "channel": {
                "chzzk_channel_id": "c1",
                "access_token": "ACCESS",
                "refresh_token": "REFRESH",
                "token_expires_at": None,
            },
            "varchive_token": {
                "token": "VTOKEN",
                "varchive_nickname": "vn",
                "is_active": True,
            },
            "dj_classes": [{"button": 4, "dj_class": "SS II"}],
        }
    ]
    p = tmp_path / "legacy.json"
    p.write_text(json.dumps(data))

    call_command("import_legacy", str(p))

    u = User.objects.get(chzzk_id="u1")
    assert u.preferred_button == 6
    assert u.has_usable_password() is False
    ch = Channel.objects.get(user=u)
    # token was re-encrypted with the Python scheme and round-trips
    assert crypto.decrypt(ch.chzzk_access_token_encrypted) == "ACCESS"
    assert u.djclass_set.count() == 1
```

- [ ] **Step 2: Run — expect fail** (`Unknown command: 'import_legacy'`)

Run: `uv run pytest djclass_overlay/common/tests/test_import.py -q`

- [ ] **Step 3: Implement** (`djclass_overlay/common/management/commands/import_legacy.py`):

```python
import json

from django.core.management.base import BaseCommand
from django.db import transaction

from djclass_overlay.common import crypto
from djclass_overlay.djclass.models import DjClass
from djclass_overlay.streamers.models import Channel
from djclass_overlay.users.models import User
from djclass_overlay.viewers.models import VarchiveToken


def _enc(value):
    return crypto.encrypt(value) if value else None


class Command(BaseCommand):
    help = "Import legacy data from the Node export JSON (re-encrypts tokens)."

    def add_arguments(self, parser):
        parser.add_argument("json_path")

    @transaction.atomic
    def handle(self, *args, **opts):
        with open(opts["json_path"], encoding="utf-8") as f:
            data = json.load(f)

        for row in data:
            user, created = User.objects.update_or_create(
                chzzk_id=row["chzzk_id"],
                defaults={
                    "chzzk_nickname": row["chzzk_nickname"],
                    "preferred_button": row.get("preferred_button"),
                },
            )
            if created:
                user.set_unusable_password()
                user.save(update_fields=["password"])

            ch = row.get("channel")
            if ch:
                Channel.objects.update_or_create(
                    user=user,
                    defaults={
                        "chzzk_channel_id": ch["chzzk_channel_id"],
                        "chzzk_access_token_encrypted": _enc(ch.get("access_token")),
                        "chzzk_refresh_token_encrypted": _enc(ch.get("refresh_token")),
                        "token_expires_at": ch.get("token_expires_at"),
                    },
                )

            vt = row.get("varchive_token")
            if vt:
                VarchiveToken.objects.update_or_create(
                    user=user,
                    defaults={
                        "token_encrypted": crypto.encrypt(vt["token"]),
                        "varchive_nickname": vt["varchive_nickname"],
                        "is_active": vt["is_active"],
                    },
                )

            for d in row.get("dj_classes", []):
                DjClass.objects.update_or_create(
                    user=user,
                    button=d["button"],
                    defaults={
                        "dj_class": d["dj_class"],
                        "dj_power_sum": d.get("dj_power_sum"),
                        "max_dj_power": d.get("max_dj_power"),
                        "dj_power_conversion": d.get("dj_power_conversion"),
                    },
                )

        self.stdout.write(self.style.SUCCESS(f"Imported {len(data)} users"))
```

- [ ] **Step 4: Run — expect pass**

Run: `uv run pytest djclass_overlay/common/tests/test_import.py -q` → `1 passed`.

> Note: timestamps (`created_at`/`synced_at`) are **not** preserved — they take migration time. Functional data (tokens, classes, nickname, preferred_button, channel id) is preserved; `synced_at` is refreshed by the daily sync anyway.

---

### Task 3: Run the real migration + verify

- [ ] **Step 1: Export → import**

```bash
npx tsx scripts/migration-export.ts > /tmp/legacy.json
uv run python manage.py import_legacy /tmp/legacy.json
```

Expected: `Imported N users`.

- [ ] **Step 2: Verify counts + a token round-trip + admin** (no plaintext printed)

```bash
uv run python manage.py shell -c "
from djclass_overlay.users.models import User
from djclass_overlay.streamers.models import Channel
from djclass_overlay.viewers.models import VarchiveToken
from djclass_overlay.djclass.models import DjClass
from djclass_overlay.common import crypto
print('users', User.objects.count(), 'channels', Channel.objects.count(), 'varchive', VarchiveToken.objects.count(), 'djclasses', DjClass.objects.count())
ch = Channel.objects.exclude(chzzk_access_token_encrypted=None).first()
print('token re-decrypts to non-empty:', bool(ch and crypto.decrypt(ch.chzzk_access_token_encrypted)))
"
```

Expected: counts match the SQLite source; token decrypts to a non-empty string.

- [ ] **Step 3: Clean up + commit**

```bash
rm -f /tmp/legacy.json
git add djclass_overlay scripts
git commit -m "feat: legacy SQLite -> Postgres data migration (2-script, re-encrypt)"
```

---

## Self-Review

- **Spec coverage:** §2 Decision 3 (one-time migration, re-encrypt, no re-link) ✓ · §10 R4 eliminated (Node decrypts with its own proven crypto; Python only encrypts) ✓.
- **Placeholders:** none — export + import + test are complete code.
- **Type consistency:** export emits `access_token`/`refresh_token`/`token` plaintext keys; import reads the same keys and re-encrypts via `common.crypto.encrypt`; test asserts round-trip via `common.crypto.decrypt`.
- **Deliverable:** real `data/app.db` rows present in Postgres with tokens re-encrypted under the Django key; no re-link.
