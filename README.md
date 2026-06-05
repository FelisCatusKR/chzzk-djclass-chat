# Chzzk DJ CLASS 채팅 위젯

V-ARCHIVE의 DJ CLASS를 Chzzk 채팅에 표시하는 OBS 위젯 서비스입니다.

## 기능

- **스트리머**: OBS Browser Source로 채팅 위젯을 추가할 수 있습니다.
- **시청자**: Chzzk 계정과 V-ARCHIVE 조회토큰을 연동하면 채팅에 DJ CLASS 뱃지가 표시됩니다.
- **뱃지 모드**: 짧은 이름 / 근사 파워 / 정수 파워 3가지 모드를 지원합니다.
- **이론치 뱃지**: DJ POWER가 10000 이상이면 반짝이는 빨간색 `이론치` 뱃지가 추가로 표시됩니다.
- **자동 동기화**: 매일 새벽 3시에 모든 연동된 사용자의 DJ CLASS가 자동으로 동기화됩니다.
- **수동 동기화**: `/link` 페이지에서 "DJ CLASS 동기화" 버튼을 눌러 즉시 갱신할 수 있습니다.

## 기술 스택

- Next.js 15 (App Router)
- TypeScript
- SQLite (better-sqlite3)
- Socket.IO-client v2.0.3 (Chzzk 채팅 연동)
- Tailwind CSS + shadcn/ui
- Docker + Dokku (배포)

## 설치 및 실행

### 요구사항

- Node.js 22+
- SQLite

### 환경 변수

`.env` 파일을 프로젝트 루트에 생성하세요:

```env
CHZZK_CLIENT_ID=your_chzzk_client_id
CHZZK_CLIENT_SECRET=your_chzzk_client_secret
NEXT_PUBLIC_BASE_URL=http://localhost:3000
VARCHIVE_TOKEN_KEY=your_32_byte_random_key
SESSION_SECRET=your_32_byte_random_key
DATABASE_URL=./data/app.db
NODE_ENV=development
```

### 로컬 개발

```bash
# 의존성 설치
npm install

# 개발 서버 실행 (WebSocket 서버 포함)
npm run dev

# 워커 실행 (별도 터미널)
npm run worker

# 테스트
npm test
```

## 사용 방법

### 스트리머

1. [대시보드](http://localhost:3000/dashboard)에 접속합니다.
2. Chzzk 계정으로 로그인합니다.
3. 위젯 URL을 복사합니다 (예: `http://localhost:3000/widget/abc123?mode=short`).
4. OBS에서 `소스 추가 → 브라우저`를 선택합니다.
5. URL에 복사한 위젯 URL을 입력하고, 너비 400, 높이 600을 설정합니다.
6. 뱃지 모드를 URL의 `?mode=` 파라미터로 변경할 수 있습니다. 모든 모드는 V-ARCHIVE 티어 색상의 단일 뱃지를 표시합니다:
   - `?mode=short` — 짧은 이름 (예: `4B SS II`)
   - `?mode=threshold` — 근사 파워 (예: `4B 9800+`)
   - `?mode=power` — 정수 파워 (예: `4B 9843`)

### 시청자

1. [연동 페이지](http://localhost:3000/link)에 접속합니다.
2. Chzzk 계정으로 로그인합니다.
3. [V-ARCHIVE 마이페이지](https://v-archive.net/mypage)에서 조회토큰을 발급받습니다.
4. 토큰을 입력하고 "연동하기"를 클릭합니다.
5. 스트리머의 위젯에 DJ CLASS 뱃지가 표시됩니다.

### OBS 설정 팁

- **배경 투명**: 위젯은 투명 배경을 사용합니다. OBS의 사용자 지정 CSS로 `body { background: transparent; }`를 추가하세요.
- **재연결**: OBS에서 위젯을 새로고침하면 자동으로 채팅 서버에 재연결됩니다.
- **모드 변경**: 위젯 URL의 `?mode=` 파라미터만 변경하면 모든 새 메시지의 뱃지 모드가 즉시 바뀝니다.

## DJ CLASS 랭크

| 랭크 | 짧은 이름 | IV | III | II | I |
|------|---------|----|-----|----|---|
| THE LORD OF DJMAX | LoD | — | — | — | 9980 |
| BEAT MAESTRO | BM | 9900 | 9930 | 9950 | 9970 |
| SHOWSTOPPER | SS | 9700 | 9750 | 9800 | 9850 |
| HEADLINER | HL | 9400 | 9500 | 9600 | 9650 |
| TREND SETTER | TS | 9000 | 9100 | 9200 | 9300 |
| PROFESSIONAL | PRO | 8600 | 8700 | 8800 | 8900 |
| HIGH CLASS | HC | 7800 | 8000 | 8200 | 8400 |
| PRO DJ | PD | 7000 | 7200 | 7400 | 7600 |
| MIDDLEMAN | MM | 6200 | 6400 | 6600 | 6800 |
| STREET DJ | SD | 5200 | 5500 | 5800 | 6000 |
| ROOKIE | RK | 4000 | 4300 | 4600 | 4900 |
| AMATEUR | AM | 2400 | 2800 | 3200 | 3600 |
| TRAINEE | TR | 500 | 1000 | 1500 | 2000 |
| BEGINNER | BG | — | — | — | 0 |

## 배포 (Dokku)

```bash
# Dokku 앱 생성
dokku apps:create chzzk-djclass-overlay

# 환경 변수 설정
dokku config:set chzzk-djclass-overlay \
  CHZZK_CLIENT_ID=xxx \
  CHZZK_CLIENT_SECRET=xxx \
  VARCHIVE_TOKEN_KEY=xxx \
  SESSION_SECRET=xxx \
  NEXT_PUBLIC_BASE_URL=https://your-domain.com

# SQLite 데이터 볼륨 마운트
dokku storage:mount chzzk-djclass-overlay \
  /var/lib/dokku/data/storage/chzzk-djclass-overlay:/app/data

# 배포
git push dokku main

# 워커 스케일링
dokku ps:scale chzzk-djclass-overlay web=1 worker=1
```

## API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/auth/chzzk` | Chzzk OAuth 시작 |
| GET | `/api/auth/chzzk/callback` | OAuth 콜백 |
| POST | `/api/auth/logout` | 로그아웃 |
| POST | `/api/user/link-varchive` | V-ARCHIVE 토큰 연동 |
| POST | `/api/user/sync-djclass` | DJ CLASS 수동 동기화 |
| GET | `/api/user/me` | 현재 사용자 정보 |
| GET | `/api/channel` | 채널 정보 및 위젯 URL |
| GET | `/api/widget/dj-class` | 특정 사용자의 DJ CLASS 조회 |
| WS | `/ws/chat?channelId=xxx` | 채팅 WebSocket (위젯용) |

## 보안

- V-ARCHIVE 토큰: AES-256-GCM 암호화 저장
- Chzzk 토큰: AES-256-GCM 암호화 저장
- 세션 쿠키: HMAC-SHA256 서명 (`session` 쿠키)
- SQLite: WAL 모드, 외래 키, CHECK 제약조건 사용

## 라이선스

MIT
