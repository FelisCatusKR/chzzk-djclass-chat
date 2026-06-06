# 기여 가이드

이 프로젝트에 기여해주셔서 감사합니다.

## 개발 환경

- Node.js 24+ (`.nvmrc` 참고)
- SQLite

## 설정

```bash
npm install
cp .env.example .env   # 값을 채워주세요
npm run dev            # 웹 서버 (WebSocket 포함)
npm run worker         # 동기화 워커 (별도 터미널)
```

## 커밋 전 필수 확인

```bash
npm run lint:fix
npm run format
npm test
```

## 규칙

- 모든 사용자 노출 문구는 **한국어**로 작성합니다.
- UI 컴포넌트는 shadcn/ui를 우선 사용합니다 (`AGENTS.md` 참고).
- 커밋 메시지는 `feat:`, `fix:`, `docs:`, `security:`, `chore:`, `style:` 접두사를 사용합니다.
- 변경이 `AGENTS.md`에 문서화된 규칙에 영향을 주면 해당 문서도 함께 업데이트합니다.

## Pull Request

- 하나의 PR은 하나의 목적에 집중합니다.
- 테스트가 통과하는지 확인 후 PR을 보냅니다.
