# Django 마이그레이션 설계 — chzzk-djclass-overlay

- **Date:** 2026-06-22
- **Status:** Draft (리뷰 대기)
- **대상:** 현 Next.js/Node 앱을 기능 동등하게 Python/Django로 재작성

---

## 1. 배경 & 목표

**현 스택:** Next.js 15 (App Router) / React 19 / TypeScript / better-sqlite3 / 커스텀 Node HTTP+WebSocket 서버(`server.ts`) / node-cron worker. 배포는 Dokku + Docker, TLS는 Cloudflare Tunnel에서 종단.

**무엇을 하는 앱인가:** V-ARCHIVE의 DJ CLASS 뱃지를 Chzzk 채팅에 얹어 OBS 브라우저 소스로 보여주는 **실시간 채팅 오버레이**. 본질은 페이지가 아니라 **채널당 Chzzk 채팅을 받아 위젯들로 fan-out하는 실시간 중계**다.

**동기 (Decision 0):** 소유자가 Next/React 생태계에 익숙하지 않아 유지보수를 전적으로 AI에 의존 중. 목표는 **소유자가 직접 읽고·리뷰·디버깅할 수 있는 스택(Python/Django)으로 이전**하는 것. 기능은 동등, **UI 모양은 동등할 필요 없음.**

**비목표:** 성능/신규 기능. (단 SSE·배치·서버사이드 뱃지는 부수적으로 단순화와 효율을 동반한다.)

---

## 2. 확정 결정 (Decision Log)

| # | 결정 | 근거 |
|---|------|------|
| 1 | **전면 재작성** (점진 빌드 후 컷오버). Node를 거치는 throwaway 중간 단계 없음 | 중간 Node 변경은 소유자가 못 읽는 코드 + Django에서 버려짐 |
| 2 | DB: SQLite → **PostgreSQL** | ASGI/async에서 SQLite write-lock 회피, web/worker 공유볼륨 결합 제거, long-term 유지보수 |
| 3 | 데이터: **일회성 마이그레이션 스크립트**로 재암호화 이전. 사용자 **재연동 0** | 기존 암호화 토큰 보존 + idiomatic 재구성의 균형 |
| 4 | 실시간 전송: **SSE** (위젯은 수신 전용 → WebSocket 불필요 → **Django Channels 불필요**) | 위젯이 `ws.send()`를 전혀 안 함. `EventSource` 자동 재연결 + `StreamingHttpResponse`로 충분 |
| 5 | 프로세스: **단일 ASGI 프로세스 + 인메모리** (Redis 없음), `uvicorn --workers 1` | 현 Node 단일 프로세스 구조의 충실한 포팅, 무빙파츠 최소 |
| 6 | **서버사이드 뱃지 계산**: resolved 뱃지 필드를 SSE 이벤트에 동봉 | 위젯의 서버 호출 0 → 클라 캐시/디덥/패치 로직 + dj-class API 제거 |
| 7 | **배치 전송**: 채널별 버퍼 적재, ~250ms마다 1회 flush로 묶음 전송 | 버스트 시 SSE write/DOM 렌더 thrash 감소, flush 시점 sender 디덥 |
| 8 | **Chzzk OAuth 직접 구현(hand-roll), allauth 미사용.** 커스텀 `User(AbstractBaseUser)` + 커스텀 auth 백엔드 | allauth 기능 전무 사용 + Chzzk 비표준 OAuth(camelCase/JSON/envelope) + 토큰 암호화 저장 → allauth는 비용↑·가독성↓. Django 세션/CSRF/secrets 위 ~100줄 포팅이 더 읽기 쉬움 |

---

## 3. 목표 아키텍처

```
┌─ ASGI 프로세스 (uvicorn --workers 1) ─────────────────────────┐
│  Django HTTP 뷰    (랜딩·대시보드·연동·로그인·API)              │
│  SSE 뷰 /widget/<ch>/stream → StreamingHttpResponse(async gen) │
│     └ 채널별 구독자 큐를 await → text/event-stream yield        │
│  Chzzk 인제스터: python-socketio(4.x) async client (채널당 1)  │
│     └ CHAT 수신 → 채널 버퍼에 적재                              │
│  flush 루프 (~250ms): 버퍼 → 뱃지 resolve → 배치 이벤트 → 큐들  │
│  in-memory 레지스트리: 채널→{socket, buffer, 구독자들}          │
│  in-memory: LRU 뱃지 캐시 · IP 레이트리밋                       │
└───────────────┬─────────────────────────────┬────────────────┘
                │                             │
          [PostgreSQL]                  [Chzzk 채팅 서버]
                │
┌─ cron 프로세스 ┘
│  manage.py sync_djclass   (매일 03:00 KST = 18:00 UTC, V-ARCHIVE)
└──────────────
```

위젯(브라우저): `new EventSource('/widget/<ch>/stream')` 수신만. 별도 HTTP 호출 없음.

---

## 4. 컴포넌트

### 4.1 프로젝트 레이아웃 (cookiecutter-django 2-tier 관례)

> 근거(cookiecutter-django): `config/`에 설정·URL·asgi, **프로젝트 패키지** 아래에 도메인별 app, 설정은 `base/local/production` 분할 + `django-environ`. 새 app은 `startapp` 후 패키지로 이동.
> Django 앱 이름에 `channels` 금지(Django Channels 혼동 방지).

```
manage.py
pyproject.toml                 # 의존성: uv + pyproject (cookiecutter 관례)
config/
  settings/{base,local,production}.py   # django-environ 12-factor
  urls.py · asgi.py · wsgi.py
djclass_overlay/               # 프로젝트 패키지 (slug) — app들이 여기 거주
  users/        # User(AUTH_USER_MODEL), Chzzk OAuth(직접구현·no allauth) + 커스텀 백엔드, login/logout
  streamers/    # Channel 모델, 대시보드 페이지, 위젯 URL 발급
  viewers/      # VarchiveToken 모델, 연동 페이지, preferred_button
  djclass/      # DjClass 모델, V-ARCHIVE 클라이언트, 선택 로직, sync 커맨드
  overlay/      # SSE 스트림 뷰, 인제스터, flush, 레지스트리, 위젯 페이지
  common/       # 공유: crypto · cache · ratelimit · Chzzk API 클라이언트 (모델 없음)
  templates/base.html          # 프로젝트 베이스 (+ 앱별 templates/<app>/)
  static/                      # 공유 정적 (+ 앱별, 예: overlay/static/overlay/widget.js)
```

- 각 app = `models.py · views.py · urls.py · admin.py · apps.py · migrations/ · tests/ · templates/<app>/`.
- 도메인 분리가 README의 **"스트리머 / 시청자"** 구분과 그대로 매핑 → 읽기 직관적.
- 실시간 모듈은 `overlay/` 안: `ingestor.py · flush.py · registry.py · sse.py`. sync 커맨드는 `djclass/management/commands/sync_djclass.py`.
- 더 적은 app을 원하면 `users`+`streamers` 병합·`common` 순수 패키지화 가능(§11.4).

### 4.2 데이터 모델 (현 스키마 1:1)

Django ORM 모델 4개 = 현 SQLite 스키마. `makemigrations`가 손으로 짠 ALTER 마이그레이션을 대체. **앱 배치:** `User`→`users`, `Channel`→`streamers`, `VarchiveToken`→`viewers`, `DjClass`→`djclass` (cross-app FK는 `settings.AUTH_USER_MODEL` 참조).

- **User**: `chzzk_id`(unique), `chzzk_nickname`, `preferred_button`(nullable), `created_at`
- **Channel**: `user`(1:1), `chzzk_channel_id`(unique), `chzzk_access_token_encrypted`, `chzzk_refresh_token_encrypted`, `token_expires_at`, `created_at`
- **VarchiveToken**: `user`(1:1), `token_encrypted`, `varchive_nickname`, `is_active`, timestamps
- **DjClass**: `user`(FK), `button`(4/5/6/8), `dj_class`, `dj_power_sum`, `max_dj_power`, `dj_power_conversion`, `synced_at`, **unique(user, button)**

> 참고: 현 코드에 `users.preferred_button` 컬럼이 존재(뷰어가 link 페이지에서 고른 버튼). 모델에 포함.

### 4.3 인증 · 암호화 · 세션

- **인증(Chzzk OAuth): 직접 구현(hand-roll), allauth 미사용.** `users`에 커스텀 `User(AbstractBaseUser)` + **커스텀 auth 백엔드**(~20줄)로 `login()`·`request.user`·`@login_required`·admin을 네이티브로 사용. OAuth 뷰(login/callback/logout)는 `common/chzzk.py` 호출. **보안 체크리스트(현 Node에서 포팅):** state/CSRF 검증 · `redirect_uri` 정확 일치 · 안전한 `next` 리다이렉트(open-redirect 방지, `safe-redirect` 포팅) · 토큰 암호화 저장 · 8s timeout.
- **암호화:** Python `cryptography`의 `AESGCM`(256-bit, per-record 랜덤 nonce). 현 보안 수준 유지하되 idiomatic. 키는 `VARCHIVE_TOKEN_KEY` 환경변수.
- **세션:** Django 기본 세션 프레임워크(**DB 백엔드**) — 손으로 짠 HMAC 서명 쿠키 대체. 7일 만료. (대안: signed-cookie 백엔드가 현 동작에 더 가깝지만, DB 백엔드가 더 idiomatic + admin에서 가시성↑)
- **OAuth state / CSRF:** Django 내장 CSRF + 세션 기반 state 검증.

### 4.4 실시간 계층 (심장)

**인제스터** (`ingestor.py`) — 현 `chat-proxy.ts`의 충실한 포팅:
- 채널당 `python-socketio` AsyncClient 1개. `getSessionUrl` → `?auth=` → connect(websocket only).
- `SYSTEM:connected` → `subscribeToChat` 호출; `CHAT` 수신 → **채널 버퍼에 raw 메시지 적재**(여기선 뱃지 계산 안 함 — flush에서).
- 토큰 만료 시 `refreshAccessToken` 후 DB 갱신. 중복 연결 방지(connectingPromise 등가), disconnect 시 5s 후 재연결(구독자 있으면).
- 모든 구독자 이탈 시 **30초 후** 정리(현 동작).

**flush 루프** (`flush.py`) — ~250ms 주기, 채널별:
1. 버퍼 swap & clear (비었으면 skip)
2. 배치 내 **unique sender** 추출 → 각 1회 뱃지 resolve (캐시 → DB → `resolveDisplayedClass`). `auto`·`viewer` 두 결과 모두 산출(같은 DB read에서).
3. 배치 이벤트 빌드(아래 4.4.1) → 각 구독자 큐에 push. 비정상 대량은 batch 상한으로 컷.

**SSE 뷰** (`sse.py`):
- async 제너레이터가 구독자 큐를 `await` → `data: {json}\n\n` yield. `event: chat`.
- 연결 시 레지스트리에 구독자 등록(필요 시 인제스터 연결 트리거 = 현 `addWidget`).
- `asyncio.CancelledError`(클라 끊김) → 구독 해제 + 30s 정리 스케줄(현 `removeWidget`).
- 주기적 `: keepalive\n\n` 코멘트로 idle 타임아웃 방지. 헤더: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`.

#### 4.4.1 SSE 배치 이벤트 형식

서버가 **원자 구성요소를 전부** 보내고, 위젯은 `mode`대로 **조립만** 한다(포맷 문자열을 서버가 박지 않음).

```jsonc
event: chat
data: {
  "messages": [
    {
      "id": "server-generated",
      "text": "메시지 본문",
      "emojis": { "emojiKey": "url" },
      "status": "linked",          // "linked" | "unlinked" | "unsynced"
      "badge": {                    // status=linked일 때만 (아니면 null)
        "auto":   { "button": 4, "class": "SS II", "rank": "SS", "power": 9810, "threshold": 9800, "isTheory": false },
        "viewer": { "button": 8, "class": "SS II", "rank": "SS", "power": 9810, "threshold": 9800, "isTheory": false }
      }
    }
  ]
}
```

**원자 필드:** `button`(4/5/6/8) · `class`(랭크+레벨 합본 텍스트: `"SS II"` / 레벨 없는 `"LoD"`) · `rank`(색상 키, 권위값 `"SS"`/`"LoD"`) · `power`(정수, 이론치=10000) · `threshold`(근사 파워|null) · `isTheory`(glint 여부).

**위젯 mode별 조립** (전부 직접 필드 읽기 — 문자열 조작 없음):
- `short` → `{button}B {class}` = `4B SS II` (LoD면 `8B LoD`)
- `power` → `{button}B {power}` = `4B 9810`
- `threshold` → `isTheory ? "{button}B 10000" : threshold!=null ? "{button}B {threshold}+" : "{button}B {rank}"` = `4B 9800+`
- 색상 = `rank` 기반 CSS 클래스(권위값, split·밴드룩업 불필요), `isTheory`면 glint.

- `status=unlinked` → 25% opacity, 뱃지 없음. `unsynced` → 뱃지 없음(미인증 표시).
- 서버가 `class`·`rank`·`threshold`·`isTheory`를 미리 계산(합본 텍스트, 권위 랭크, RANK_THRESHOLDS, theory 룰) → 위젯은 **레벨 분기·문자열 split**·임계값 테이블·이론치 상수를 들 필요 없음(최대한 얇음).
- 예: LoD 이론치 → `{ button:8, class:"LoD", rank:"LoD", power:10000, threshold:9980, isTheory:true }` — 레벨 없음을 `class`가, 색상은 `rank`가 직접 처리. (색은 권위 랭크 기반이라 floor 경계 버그 없음)
- §11.1: `buttonSel`을 채널 설정으로 바꾸면 `badge`는 단일 객체로 축소 가능.

### 4.5 위젯 프런트 (vanilla JS + EventSource)

프레임워크/빌드 없음. `web/static/widget.js`:
- URL 파라미터 파싱: `mode`(short/threshold/power), `buttonSel`(auto/viewer), `fontSize`(12~28, 기본14), `fadeout`(5~60, off).
- `EventSource` onmessage → 배치 순회 → 행 DOM 생성(뱃지는 `badge[buttonSel]`을 `mode`로 포맷; 이론치=DJ POWER 10000 → LoD 반짝임 클래스) → append, 최근 100개 유지, 하단 스크롤(`auto`).
- fadeout 타이머(현 클라 로직 그대로, 순수 프리젠테이션).
- **제거됨:** 클라 캐시, in-flight 디덥, pending/patch, 재연결 retry 카운터(EventSource가 대체), `/api/widget/dj-class` fetch.

### 4.6 페이지 / 템플릿

- **랜딩·대시보드·연동·로그인:** Django 템플릿 + **daisyUI**(Tailwind 플러그인, 프레임워크 무관) + 라이트 인터랙션은 **Alpine.js**(대시보드 2-pane 라이브 프리뷰 등). 폼은 **Django Forms**로 단순화.
- **컴포넌트 재사용:** 우선 순수 템플릿 `{% include %}` 파셜(뱃지/메시지 미리보기 등). **django-cotton은 보류** — 의존성 최소가 학습·리뷰에 유리. ergonomics가 아쉬우면 후속 도입.
- **비즈니스 로직 포팅:** dj-class 선택 우선순위, SHORT_NAMES, threshold/power, emoji, font-size, fadeout → 순수 Python(`core/djclass.py` 등). 현 Vitest 케이스가 parity 가드.

### 4.7 백그라운드 동기화

- `manage.py sync_djclass`: 활성 VarchiveToken 순회 → 복호화 → V-ARCHIVE `lookupUser`/`getAllDjClasses` → `persistUserDjClasses`(upsert + stale 삭제) → 닉네임 갱신 → 캐시 무효화. (현 `sync-djclass.ts` 동등)
- 스케줄: Dokku/호스트 **cron**이 매일 18:00 UTC에 트리거. Celery 불필요.

---

## 5. 데이터 흐름 (요약)

1. 스트리머: Chzzk OAuth → 토큰 암호화 저장(Channel) → 위젯 URL 발급.
2. 뷰어: Chzzk OAuth + V-ARCHIVE 토큰 연동 → 암호화 저장 → (sync가) DJ CLASS 적재.
3. OBS 위젯: `/widget/<ch>/stream` SSE 연결 → 인제스터가 Chzzk 연결 → CHAT 버퍼 적재 → 250ms flush가 뱃지 동봉 배치 전송 → 위젯 렌더.

---

## 6. 에러 처리 & 엣지

- Chzzk: 연결 실패/`disconnect` → 구독자 있으면 5s 재연결, 없으면 정리. 토큰 만료 → refresh 후 갱신, 실패 → 중단.
- SSE: 클라 끊김 `CancelledError` → 구독 해제 + 30s 디바운스 정리. keepalive로 프록시 idle 타임아웃 방지.
- flush: 빈 배치 skip, batch 상한, sender 디덥(배치 내 1회).
- 캐시 TTL: linked+data 5분 / linked+no-data 15s / unlinked 10s, `updateAgeOnGet=false`.
- 레이트리밋: auth·link-varchive·sync 라우트 per-IP, 위반 429.
- outbound: Chzzk/V-ARCHIVE 호출 8s timeout(httpx).
- 보안 헤더(CSP 포함) 전역 적용(미들웨어). 토큰/세션키/시크릿 **로깅 금지**.

---

## 7. 배포

- **Dokku + Docker**(멀티스테이지, Python 3.13). 프로세스 2종: **web** = `uvicorn config.asgi:application --workers 1`, **worker/cron** = `sync_djclass`.
- **PostgreSQL** = `dokku postgres:create` + link(`DATABASE_URL`). 공유 볼륨 결합 제거.
- 기존 **Cloudflare Tunnel** 유지(SSE는 평범한 HTTP 스트림 → 통과 OK, 무버퍼링 헤더 필수).
- 환경변수: `CHZZK_CLIENT_ID/SECRET`, `BASE_URL`, `VARCHIVE_TOKEN_KEY`, `SESSION/SECRET_KEY`, `DATABASE_URL`, `DJANGO_SETTINGS/DEBUG`.
- **설정/의존성:** `config/settings/{base,local,production}.py` 분할 + `django-environ`(12-factor). 의존성은 `uv` + `pyproject.toml`(cookiecutter-django 관례).
- **단일 워커 강제**(인메모리 상태) — 문서화. 현 Node 단일 프로세스와 동일 제약.

---

## 8. 테스트 (pytest-django)

- **포팅:** crypto 라운드트립, 모델/제약, Chzzk OAuth URL/토큰 교환, V-ARCHIVE 파싱 + 버튼 선택, 세션, sync 배치 로직. (현 Vitest 커버리지 등가)
- **신규:** dj-class 선택 우선순위, 배치 flush(디덥·빈배치·상한), SSE 뷰(연결/이벤트/끊김 정리), 인제스터(재연결·토큰리프레시 mock).
- **parity 체크리스트**(§9)로 동작 동등성 수동 검증.

---

## 9. 실행 순서 (당신 4-스텝 재배치)

- **Step 0 — 스파이크 (착수 게이트):** Python `python-socketio`(4.x) → 라이브 Chzzk 접속 → 한 채널 CHAT을 미니 SSE로 브라우저까지. **실시간 심장을 목표 스택에서 직접 증명.** Cloudflare Tunnel 통과(R2)도 여기서 확인. 실패 시 폴백(R1).
- **Step 1 — 마이그레이션 스크립트:** SQLite 읽기 → Node AES-256-GCM 포맷 복호화(`crypto.ts` 정독) → Python AESGCM 재암호화 → Postgres 적재. 행 수·복호화 라운드트립 검증.
- **Step 2 — Django 점진 구축:** models+admin → auth/OAuth → 페이지(daisyUI) → API → SSE 위젯+인제스터+flush. 구 Node 앱은 prod 유지.
- **Step 3 — 컷오버:** parity 검증 후 DNS/프록시 전환. Node 앱은 즉시 롤백용 보존.

**Parity 체크리스트:** 뱃지 3모드 · buttonSel auto/viewer · fontSize 클램프 · fadeout · 이론치 반짝임 · unlinked 25% · emoji · 토큰 리프레시 · 30s 정리 · 일일 sync.

---

## 10. 리스크 & 완화

| # | 리스크 | 완화 |
|---|--------|------|
| R1 | `python-socketio` 4.x가 Python 3.13에서 동작 안 할 수 있음 | **Step 0가 판정.** 폴백: Python 3.12(Django 6.0 지원), 또는 5.x+EIO3 호환 조사 |
| R2 | SSE가 Cloudflare Tunnel을 통과 못/버퍼링 | keepalive + `X-Accel-Buffering: no`. Step 0에서 끝까지 확인 |
| R3 | 단일 워커 강제(인메모리 상태) | 문서화, 현 Node와 동일 제약. 확장 필요 시 §11의 멀티프로세스+Redis 경로 |
| R4 | 마이그레이션 스크립트가 Node 암호화 포맷 복호화 실패 | `crypto.ts` 정독, DB 사본에 대해 일회성 검증 |
| R5 | 하드원 버그픽스 재유입(dedup·debounce·TTL) | 기존 테스트 이식 + parity 체크리스트 |

---

## 11. Open Questions

1. **buttonSel 범위:** 위젯별(URL 파라미터, 현행) 유지 → 이벤트에 auto·viewer 동봉. vs **채널(스트리머) 설정**으로 단순화 → 단일 뱃지 객체. (기본 제안: 현행 유지)
2. **세션 백엔드:** DB(idiomatic, 제안) vs signed-cookie(현 동작에 근접).
3. **Python 버전:** 3.13 우선, R1 결과에 따라 3.12 폴백.
4. ~~User 모델 통합~~ **→ 해결(Decision 8):** 커스텀 `User(AbstractBaseUser)` + 커스텀 auth 백엔드 + hand-rolled Chzzk OAuth(allauth 미사용).
5. **앱 granularity:** 5 도메인 app + `common`(제안) vs `users`+`streamers` 병합·`common` 순수 패키지화한 leaner 변형.
