# 기여 가이드

이 프로젝트에 기여해주셔서 감사합니다.

## 개발 환경

- [mise](https://mise.jdx.dev/)로 도구 버전을 맞춥니다: `mise install` (Go, sqlc, Node — `mise.toml`)
- Node는 위젯 JS 린트와 Git 훅에만 씁니다.

```bash
mise install
cp .env.example .env               # 값을 채워주세요 (로컬은 DEV=1 권장)
go run ./cmd/server                # http://localhost:8000
npm install                        # prepare 스크립트가 Git 훅(husky)을 설치합니다
```

## 품질 검사

Go 코드를 바꾼 뒤:

```bash
sqlc generate && gofmt -w cmd internal && go vet ./... && go test ./...
```

위젯/페이지 JS(`internal/web/static/`)를 바꾼 뒤:

```bash
npm run lint:fix && npm run format && node tests/widget-smoke.cjs
```

Git 훅(`npm install` 시 설치): **pre-commit** — `lint-staged`가 `*.go` → `gofmt -w`, `*.js` → `eslint --fix` + `prettier --write`; **pre-push** — `npm run lint`.

## CI 게이트

`build` 잡: Go 버전 고정 일치(mise · go.mod · Dockerfile), gofmt, `sqlc diff`, `go vet`, `go test -race`, ESLint, 위젯 스모크 테스트. `go-image` 잡: 운영 이미지 빌드. 두 잡 모두 필수 체크입니다. `main`에 머지된 커밋은 CI가 GHCR에 이미지로 게시하고(문서만 바뀐 커밋 제외) 운영 호스트가 받아 배포합니다.

## 규칙

- 모든 사용자 노출 문구는 **한국어**로 작성합니다.
- 설정 페이지 UI는 **daisyUI + Tailwind 유틸리티(CDN)** 와 htmx/Alpine으로 작성합니다. OBS 오버레이 위젯은 빌드 없는 바닐라 JS(`widget.js`) + `chat.css`입니다 (`AGENTS.md` 참고).
- 커밋 메시지는 `feat:`, `fix:`, `docs:`, `security:`, `chore:`, `ci:`, `refactor:` 접두사를 사용합니다.
- 변경이 `AGENTS.md`에 문서화된 규칙에 영향을 주면 해당 문서도 함께 업데이트합니다.

## Pull Request

`main` 브랜치는 보호되어 있어 직접 푸시할 수 없습니다. 모든 변경은 PR로 진행합니다.

1. `main`에서 브랜치를 생성합니다: `git switch -c <type>/<설명>`
2. 변경 후 브랜치를 푸시하고 `main`을 대상으로 PR을 엽니다.
3. CI(`build`, `go-image`)가 통과해야 머지할 수 있습니다.
4. 머지되면 운영에 배포됩니다(운영 컨테이너 재시작 — 위젯은 스스로 재연결).

- 하나의 PR은 하나의 목적에 집중합니다.
- `main` 보호는 관리자에게도 적용됩니다.
