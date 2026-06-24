# 위젯 커스터마이즈 5종 — 설계 문서

- 작성일: 2026-06-24
- 상태: 승인됨 (브레인스토밍 완료, 시각 검증 완료)
- 대상 앱: `djclass_overlay` (Django, chatoverlay.felis.kr)

## 1. 개요 / 목표

방송 화면에서의 채팅 오버레이 가독성과 커스터마이즈성을 높이는 5가지 기능을 추가한다.

1. **가독성** — 흰 글씨에 그림자/외곽선을 넣어 밝은 배경에서도 읽히게
2. **미인증 반투명 토글** — 미인증 채팅의 반투명 처리를 빌더에서 on/off
3. **폰트 선택** — 한글 웹폰트 9종(jsDelivr) 중 선택
4. **닉네임 표시 토글** — 치지직 닉네임 표시(신규)를 on/off, 색은 무지개 순환
5. **빌더 레이아웃 개편** — URL을 상단 전체 너비·고정으로 올리고 미리보기 확대

## 2. 범위

모든 변경은 **기존 두 표면 + 서버 payload 한 필드**에 한정된다.

- 오버레이 렌더: `templates/overlay/widget.html`, `overlay/static/overlay/widget.js`, `static/css/chat.css`(← `badge.css`에서 리네임, §6)
- 빌더: `templates/users/dashboard.html`, `static/js/components.js`
- 서버: `overlay/flush.py` (SSE payload에 `nickname` 추가)

**범위 밖(변경 없음):** 새 URL/엔드포인트, DB/모델, CSP 정책, SSE 프로토콜 골격(필드 1개 추가뿐), 인증/세션, 스케줄러/ingestor.

## 3. URL 파라미터 명세

위젯 URL: `/widget/<channel_id>/?<params>`. 파서는 모두 클라이언트(`widget.js`)에 있고, 기본값일 때 파라미터를 **생략**한다(전부 기본이면 쿼리 스트링 없음).

| 파라미터 | 값 | 기본(생략 시) | URL에 기록하는 시점 | 상태 |
|---|---|---|---|---|
| `mode` | `short` / `threshold` / `power` | `short` | 기본 아닐 때만 | 변경(옵셔널화) |
| `fontSize` | 정수 12–28 | `14` | 기본 아닐 때만 | 변경(옵셔널화) |
| `buttonSel` | `auto` / `viewer` | `auto` | `viewer`일 때만 | 기존 |
| `fadeout` | 정수 5–60 | 꺼짐 | 켰을 때만 | 기존 |
| `font` | 9종 키(아래) | `pretendard` | 기본 아닐 때만 | 신규 |
| `textStyle` | `shadow` / `outline` | `shadow` | 기본 아닐 때만 | 신규 |
| `nickname` | `on` | `off` | 켰을 때만 | 신규 |
| `dimUnverified` | `off` | `on` | 껐을 때만 | 신규 |

검증 규칙: 알 수 없는 값은 조용히 기본값으로 폴백(기존 `mode`/`buttonSel` 파싱과 동일 방식). `font`는 화이트리스트 키에 없으면 `pretendard`.

## 4. 기능별 상세

### (1) 가독성 — `textStyle`

`text-shadow`는 상속 속성이므로 `#chat`에 클래스로 적용하면 닉네임·메시지 텍스트에 모두 자동 적용된다. 뱃지는 자체 `text-shadow`(흰 글로우)를 가지므로 영향 없음.

- `#chat`의 기존 하드코딩 `text-shadow`(`0 1px 1px rgba(0,0,0,.8)`)를 제거하고 클래스로 대체.
- `.ts-shadow` (기본): `text-shadow: 0 1px 2px rgba(0,0,0,1), 0 0 4px rgba(0,0,0,.9);`
- `.ts-outline`: 8방향 외곽선 + 옅은 후광
  ```css
  text-shadow:
    -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000,
    -1px 0 0 #000, 1px 0 0 #000, 0 -1px 0 #000, 0 1px 0 #000,
    0 0 4px rgba(0,0,0,.55);
  ```
- `widget.js`가 `textStyle` 값에 따라 `#chat`에 `ts-shadow`/`ts-outline` 클래스를 부여(기본 `ts-shadow`).
- 한글 복잡 자소 때문에 `-webkit-text-stroke`가 아니라 8방향 그림자로 외곽선을 구현한다.

### (2) 미인증 반투명 — `dimUnverified`

현재 `badge.css`의 `.row.unverified-row { opacity: .75 }`를 조건부로 바꾼다.

- `#chat`에 기본 클래스 `dim-unverified` 부여. CSS를 `.dim-unverified .row.unverified-row { opacity: .75 }`로 스코프.
- `dimUnverified=off`면 `widget.js`가 `dim-unverified` 클래스를 제거 → 미인증 줄 불투명.
- 페이드아웃(`.row.fading`) 동작과 독립적으로 유지.
- 미리보기도 동일 규칙 반영.

### (3) 폰트 — `font`

키 → `{family, cssUrl}` 화이트리스트. 오버레이는 **선택된 폰트 1개만** 로드한다. CSP 무변경(`cdn.jsdelivr.net`이 이미 `style-src`/`font-src`에 허용됨).

| 키 | font-family | jsDelivr CSS |
|---|---|---|
| `pretendard` (기본) | `Pretendard` | `…/pretendard@1.3.9/dist/web/static/pretendard.css` |
| `gothic-a1` | `Gothic A1` | `…/@fontsource/gothic-a1/index.css` |
| `nanum-gothic` | `Nanum Gothic` | `…/@fontsource/nanum-gothic/index.css` |
| `do-hyeon` | `Do Hyeon` | `…/@fontsource/do-hyeon/index.css` |
| `black-han-sans` | `Black Han Sans` | `…/@fontsource/black-han-sans/index.css` |
| `jua` | `Jua` | `…/@fontsource/jua/index.css` |
| `nanum-pen-script` | `Nanum Pen Script` | `…/@fontsource/nanum-pen-script/index.css` |
| `gamja-flower` | `Gamja Flower` | `…/@fontsource/gamja-flower/index.css` |
| `nanum-myeongjo` | `Nanum Myeongjo` | `…/@fontsource/nanum-myeongjo/index.css` |

(jsDelivr 베이스: `https://cdn.jsdelivr.net/npm`. fontsource v5는 유니코드 레인지로 글리프를 분할 제공하므로 실제 사용 글자만 다운로드된다.)

- 폴백 스택: `<선택 family>, "Pretendard", system-ui, "Apple SD Gothic Neo", sans-serif`.
- **기본 폰트 로딩:** `widget.html`에 Pretendard `@font-face`를 인라인(버전 고정, `base.html`과 동일)으로 두어 기본값은 추가 요청 없이 적용. `font`가 비-기본이면 `widget.js`가 해당 fontsource `<link>`를 주입하고 `#chat` font-family를 덮어쓴다.
- 화이트리스트 매핑으로만 URL을 구성하므로 임의 URL 주입 불가.
- **빌더 미리보기:** 드롭다운에서 폰트를 고르는 순간 해당 폰트 CSS를 지연 주입(이미 주입된 건 스킵)하고 미리보기 컨테이너 font-family를 갱신. 9종을 한꺼번에 선로딩하지 않는다.

### (4) 닉네임 — `nickname`

**신규 표시 요소.** 현재 오버레이는 닉네임을 전혀 그리지 않고, SSE payload(`BatchMessage`)에도 없다. 기본 OFF(생략 시 미표시, 기존 위젯 모양 유지).

- **형식:** `[뱃지] 닉네임: 메시지` (뱃지 → 닉네임+콜론 → 메시지 순). linked/미인증 모두 닉네임 표시(미인증은 반투명만 추가됨).
- **색(무지개 순환):** 닉네임 단위가 아니라 **메시지 도착 순서**로 8색 파스텔을 부드러운 스펙트럼 순서로 순환. `widget.js`에 모듈 레벨 카운터를 두고 닉네임을 그릴 때마다 `PALETTE[idx++ % 8]`.
  - 팔레트(중간 톤 파스텔, 스펙트럼 순):
    ```js
    ['#f1a7b4','#f0c68a','#f2d97e','#a7d99b','#8ed9c4','#8fc9ec','#a3b6ef','#c4abe9']
    ```
  - 닉네임 span: `font-weight:700; margin-right:4px;` + 인라인 `color`. 메시지는 `#chat`의 흰색 상속. 그림자/외곽선은 `#chat`에서 상속.
- **서버 변경(`flush.py`):**
  - `BatchMessage` TypedDict에 `nickname: str` 추가.
  - `build_batch`의 메시지 dict에 `"nickname": m["nickname"]` 추가 (원천 `ChatMessage["nickname"]`는 이미 존재).
- **렌더(`widget.js` `addMessage`):** `nickname=on`이면 뱃지 뒤에 `<span class="nick" style="color:…">{nickname}:</span>` 삽입 후 메시지 span. off면 기존과 동일.

### (5) 빌더 레이아웃 — A안 + 카드 구성

`dashboard.html` 구조 개편:

- 제목 아래 **전체 너비 URL 바**를 두고 `position: sticky; top: 0`(+배경/z-index)로 스크롤 시 상단 고정. URL 입력(readonly) + 복사 버튼 + "위젯 열기" 링크 포함.
- 그 아래 2단 그리드 `[옵션 메이슨리(좌, ~1.6fr) | 미리보기(우, ~1fr, sticky)]`.
- 미리보기 높이 확대, sticky `top`은 URL 바 높이만큼 오프셋. OBS 설명 카드는 미리보기 아래.
- **옵션 카드 7장**(클러터 방지로 신규 토글 2개를 한 카드에 묶음):
  1. 뱃지 모드 (기존)
  2. 버튼 선택 모드 (기존)
  3. 글자 크기 (기존)
  4. 비활성 페이드아웃 (기존)
  5. **폰트** (신규, 드롭다운 9종)
  6. **가독성** (신규, 라디오 `그림자`/`외곽선`, 기본 그림자)
  7. **표시 옵션** (신규, 토글 2개: `닉네임 표시`, `미인증 반투명`)

## 5. 미리보기 패리티

빌더 미리보기가 실제 오버레이와 동일하게 보이도록:

- `widgetConfig`에 신규 상태 `font`, `textStyle`, `nicknameOn`, `dimUnverified` 추가. `widgetUrl()`은 기본 아닐 때만 파라미터를 기록(+ 기존 `mode`/`fontSize`도 옵셔널화).
- `widgetPreview`는 `widgetConfig` 안에 중첩되어 부모 상태(이미 `mode`/`fontSize` 사용 중)에 접근하므로, 위 신규 필드를 그대로 읽어 `font`(컨테이너 font-family + 선택 시 CSS 지연 로드), `textStyle`(컨테이너 클래스), `nickname`(무지개 순환), `dimUnverified`, `fontSize`, `mode`를 오버레이와 같은 규칙으로 적용한다.
- `FAKE_CHAT_MESSAGES` 각 항목에 `nickname` 필드 추가(미인증 항목 포함).
- **무지개 색 안정성:** 미리보기는 `rows` 배열에서 반복 렌더되므로, 색은 메시지를 push하는 시점에 카운터로 정해 **행 객체에 저장**한다(매 렌더마다 재계산하지 않음). 실제 오버레이도 생성 시점에 span 인라인 색으로 고정한다.

## 6. 파일별 변경 요약

- `overlay/flush.py` — `BatchMessage`에 `nickname` 추가, `build_batch`에서 전달.
- `templates/overlay/widget.html` — `#chat` 하드코딩 그림자 제거→클래스, Pretendard `@font-face` 인라인, 기본 클래스(`ts-shadow dim-unverified`) 부여 지점.
- `overlay/static/overlay/widget.js` — 신규 파라미터 파싱(`font`/`textStyle`/`nickname`/`dimUnverified`), 폰트 `<link>` 주입, 텍스트 스타일/반투명 클래스 토글, 닉네임 렌더 + 무지개 카운터.
- `static/css/badge.css` → **`static/css/chat.css`로 리네임** — 더 이상 뱃지 전용이 아니라 채팅 표현 전반(뱃지·행·텍스트 스타일·닉네임)을 담으므로. 신규 규칙 `.ts-shadow`/`.ts-outline`, `.dim-unverified` 스코프, `.nick` 추가. 참조 업데이트: `base.html:37`·`widget.html:9`(`<link>`)·`widget.html:11`(주석 "→ badge.css"). `git mv`로 이력 보존.
- `templates/users/dashboard.html` — A안 레이아웃, 카드 7장(폰트/가독성/표시 옵션 신규).
- `static/js/components.js` — `widgetConfig`/`widgetPreview` 신규 상태·URL 조립·폰트 지연 로드, `FAKE_CHAT_MESSAGES` 닉네임 추가.

## 7. 데이터 구조 변경

```python
class BatchMessage(TypedDict):
    id: int
    text: str
    emojis: dict[str, str]
    status: str
    badge: dict[str, BadgeDict] | None
    nickname: str   # 신규
```

페이로드 크기 영향: 메시지당 닉네임 문자열 1개(미미함).

## 8. 테스트 전략 (TDD)

- **서버:** `build_batch`가 각 메시지에 `nickname`을 싣는지 검증. 기존 `flush`/`build_batch` 테스트가 있으면 새 필드에 맞게 업데이트하고, 닉네임 전달 케이스를 추가.
- **클라이언트:** 무지개 색 선택(`idx % palette.length`)과 파라미터 파서(폰트 화이트리스트 폴백, 옵셔널 기본값)를 순수 함수로 분리해 검증 가능하게 한다. (현 레포에 JS 단위 테스트 러너는 없으므로, 최소한 함수를 순수하게 뽑아 수동/추후 검증이 쉽도록 구조화.)
- mypy `--strict`, ruff, djlint 통과 유지.

## 9. 기존 위젯 영향 (의도된 기본값 변경)

파라미터 없는 기존 OBS URL의 모양이 자동으로 바뀌는 두 가지 — 둘 다 의도된 개선:

1. **가독성 기본값**: 옅은 그림자(`0 1px 1px`) → 더 진한 그림자. (기능 1의 목적)
2. **폰트 기본값**: `system-ui` → `Pretendard`. 사이트 브랜드 폰트와 일치, `font-display:swap` + 폴백 스택으로 안전. (원하면 추후 기본을 `system-ui`로 되돌리고 Pretendard를 선택지로만 둘 수 있음 — 현 설계는 Pretendard 기본.)

닉네임(기본 off)·미인증 반투명(기본 on, 현행 유지)·신규 옵셔널 파라미터는 기존 위젯 모양을 바꾸지 않는다.

## 10. 향후(범위 밖)

- 치지직 사용자별 닉네임 **색** 수집(현재 데이터에 없음) — 추가되면 무지개 순환 대신/병행 적용 가능.
- 팔레트 색 개수·구성 조정(현 8색).
- 폰트 목록 확장(Google Fonts까지 열면 CSP 확장 필요).
