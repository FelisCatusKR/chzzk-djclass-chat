# 기여 가이드

이 프로젝트에 기여해주셔서 감사합니다.

## 개발 환경

- Node.js 24+ (`.nvmrc` 참고)
- SQLite

## 설정

```bash
npm install            # prepare 스크립트가 Git 훅(husky)을 자동 설치합니다
cp .env.example .env   # 값을 채워주세요
npm run dev            # 웹 서버 (WebSocket 포함)
npm run worker         # 동기화 워커 (별도 터미널)
```

## 품질 검사 (Git 훅 자동 실행)

`npm install` 시 설치되는 Git 훅이 아래를 자동으로 수행하므로 별도로 신경 쓸 필요가 없습니다.

- **pre-commit** — `lint-staged`가 스테이징된 파일에 `eslint --fix`와 `prettier --write`를
  적용합니다. 포맷 문제가 커밋에 섞여 들어가지 않습니다.
- **pre-push** — 푸시 전에 `npm run lint && npm test`를 실행합니다.

직접 실행하려면:

```bash
npm run lint          # ESLint
npm run format:check  # Prettier (CI 게이트)
npm test              # Vitest
npm run build         # next build (CI 게이트)
```

CI는 모든 PR에서 `lint`, `format:check`, `test`, `build`를 동일하게 실행합니다.

## 규칙

- 모든 사용자 노출 문구는 **한국어**로 작성합니다.
- UI 컴포넌트는 shadcn/ui를 우선 사용합니다 (`AGENTS.md` 참고).
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
