# 기여 가이드

이 프로젝트에 기여해주셔서 감사합니다.

## 개발 환경

- Python 3.14+ (`uv`로 관리, `.python-version` 참고)
- PostgreSQL (개발용은 `docker compose`로 실행)
- Node.js 24+ (`.nvmrc` 참고) — JS 린트/포맷 Git 훅에만 사용합니다

## 설정

```bash
uv sync                              # 의존성 설치 (.venv 생성)
cp .env.example .env.django          # 값을 채워주세요
docker compose up -d                 # 개발용 PostgreSQL
uv run python manage.py migrate
uv run python manage.py runasgi      # ASGI 서버 (HTTP + SSE + Chzzk 인제스터)

npm install                          # prepare 스크립트가 Git 훅(husky)을 설치합니다
```

## 품질 검사 (Git 훅 자동 실행)

`npm install` 시 설치되는 Git 훅이 아래를 자동으로 수행합니다.

- **pre-commit** — `lint-staged`가 스테이징된 파일에 적용합니다: `*.py` → `ruff format` + `ruff check --fix`, `*.html` → `djlint --reformat`, `*.js` → `eslint --fix` + `prettier --write`.
- **pre-push** — `npm run lint`(ESLint)을 실행합니다.

직접 실행하려면:

```bash
uv run ruff format                                # 포맷
uv run ruff check                                 # 린트
uv run djlint djclass_overlay/templates --lint    # 템플릿 린트
uv run mypy djclass_overlay config                # 타입 체크 (strict)
uv run pytest                                      # 테스트
npm run lint                                       # ESLint (위젯/페이지 JS)
```

## CI 게이트

CI(`build` 잡)는 모든 PR에서 Python 게이트를 실행합니다: `ruff check`, `ruff format --check`, `djlint --check` / `--lint`, `mypy`, `manage.py check`, `makemigrations --check`, `pytest`, `collectstatic`, `check --deploy`. ESLint/Prettier는 CI가 아니라 **로컬 Git 훅에서만** 검사합니다.

## 규칙

- 모든 사용자 노출 문구는 **한국어**로 작성합니다.
- 설정 페이지 UI는 **daisyUI + Tailwind 유틸리티(CDN)** 와 htmx/Alpine으로 작성합니다. OBS 오버레이 위젯은 빌드 없는 바닐라 JS(`widget.js`) + `badge.css`를 사용합니다 (`AGENTS.md` 참고).
- 커밋 메시지는 `feat:`, `fix:`, `docs:`, `security:`, `chore:`, `style:` 접두사를 사용합니다.
- 변경이 `AGENTS.md`에 문서화된 규칙에 영향을 주면 해당 문서도 함께 업데이트합니다.

## Pull Request

`main` 브랜치는 보호되어 있어 직접 푸시할 수 없습니다. 모든 변경은 PR로 진행합니다.

1. `main`에서 브랜치를 생성합니다: `git checkout -b <type>/<설명>`
   (예: `feat/badge-cache`, `fix/glint-phase`, `chore/deps`).
2. 변경 후 브랜치를 푸시하고 `main`을 대상으로 PR을 엽니다.
3. CI(`build`)가 통과해야 머지할 수 있습니다.
4. 머지되면 `main` 푸시가 운영 배포를 트리거합니다.

- 하나의 PR은 하나의 목적에 집중합니다.
- `main` 보호는 관리자에게도 적용됩니다. PR로 처리할 수 없는 긴급 상황에서는
  관리자가 일시적으로 보호를 해제하고 푸시한 뒤 다시 활성화할 수 있습니다.
