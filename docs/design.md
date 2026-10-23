# jev-router-plus 리네임 설계

원본(gargpratyush/jev-router, MIT)을 포크해 OpenRouter 지원 등을 추가한 버전을 `jev-router-plus`라는 이름으로 독립 배포한다.

## 바꾸는 것 (외부에 보이는 이름)

| 항목 | 현재 | 변경 |
|---|---|---|
| npm 패키지명 (`package.json`, `package-lock.json`의 `name`) | `jev-router` | `jev-router-plus` |
| 버전 | `0.3.0` | `0.4.0` (포크 첫 릴리스. lockfile 두 곳도 함께) |
| `bin` 명령 | `jev-claude`, `jev-codex`, `jev-explain` | `jev-plus-claude`, `jev-plus-codex`, `jev-plus-explain` |
| bin 파일명 | `bin/jev-claude.mjs` 등 | `bin/jev-plus-claude.mjs` 등 (`git mv`). `jev-statusline.mjs`, `jev-explain` 등 bin 안의 다른 파일은 코드가 참조하는 경로를 확인하고 필요한 것만 옮긴다 |
| 저장소 URL (`repository`, `homepage`, `bugs`) | `gargpratyush/jev-router` | `seogineer/jev-router-plus` |
| 사용자에게 보이는 안내 문구 | `restart jev-codex` 등 | 새 명령 이름 |
| README | 원본 그대로 | 아래 "README" 참고 |
| LICENSE | `Copyright (c) 2026 Jev Router contributors` | 그 줄은 유지하고 아래에 `Copyright (c) 2026 seogineer` 추가 |

## 바꾸지 않는 것 (호환성 유지)

기존 사용자 설정과 내부 동작이 깨지므로 그대로 둔다.

- 환경변수 이름 전부 (`JEV_API_KEY`, `OPENROUTER_API_KEY`, `JEV_PROVIDER`, `JEV_DEBUG` 등)
- 설정 파일 경로 `~/.jev-router.env`, `~/.jev-claude.env`, 로그 `~/.jev-claude.log`
- Claude Code 모델 선택기에 등록되는 모델 id `jev-router` (`src/config.mjs`의 `AUTO_MODEL`)와 표시 이름 "Jev Router"
- 스킬 이름 `jev-explain` (`$jev-explain`)과 스킬 폴더 이름
- `src/` 내부 변수·상태 파일 이름
- 테스트가 검증하는 위 항목들의 기대값

## README

- 맨 위에 포크 고지: "[gargpratyush/jev-router](https://github.com/gargpratyush/jev-router)를 포크해 OpenRouter 지원, 계정별 모델 목록 반영 등을 추가한 버전입니다. 원본과 같은 환경변수·설정 파일을 씁니다."
- 설치: `npm install -g jev-router-plus`, 실행: `jev-plus-claude`, `jev-plus-codex`
- 원본 `jev-router`와 같은 환경변수를 쓰지만 실행 명령 이름이 달라 함께 설치해도 충돌하지 않는다는 점을 한 줄로 안내
- 로컬 저장소 설치(clone) 주소, Issues 주소, 모든 명령 예시를 새 이름으로 교체
- 원본 저장소 주소는 포크 고지 문구 한 곳에만 남긴다

## 문서·스킬

- `docs/jev-claude-architecture.md`: 명령 이름 언급만 새 이름으로 교체 (파일명은 유지)
- `.claude/skills/jev-explain/SKILL.md`, `skills/codex/jev-explain/SKILL.md`: 안내 문구에 나오는 `jev-claude`/`jev-codex` 명령 이름만 교체

## 완료 기준

1. `npm test` 전체 통과
2. `node bin/jev-plus-claude.mjs -p "what is 2+2?"`가 설정된 키로 응답
3. `npm pack --dry-run`에 `bin/jev-plus-*` 3개와 `src`, `skills`, `.claude/skills`가 들어 있고 불필요한 파일(.env 등)이 없음
4. `grep -rn "gargpratyush"`는 README의 포크 고지에서만 나옴
5. 사용자 안내 문구에 옛 명령 이름(`jev-claude`, `jev-codex` 단독 실행 안내)이 남아 있지 않음
