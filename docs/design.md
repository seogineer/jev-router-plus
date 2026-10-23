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

---

# 개정: 실행 명령을 `jev` 하나로 통합

위 표의 bin 이름(`jev-plus-claude` 등)은 이 개정으로 대체된다. 아직 npm 배포 전이라 호환성 부담이 없다.

## 사용 형태

```
jev            # Claude Code 실행 (기본)
jev codex      # Codex 실행
jev explain    # 라우팅 이유 설명
jev <옵션...>   # 첫 인자가 하위 명령이 아니면 전부 Claude Code에 그대로 전달 (예: jev --resume)
jev claude ... # 명시적으로 Claude를 지정해도 동일
```

## 구조

- `package.json`의 `bin`은 `{ "jev": "bin/jev.mjs" }` 하나만 둔다.
- `bin/jev-plus-claude.mjs` → `bin/claude.mjs`, `bin/jev-plus-codex.mjs` → `bin/codex.mjs`, `bin/jev-plus-explain.mjs` → `bin/explain.mjs` (`git mv`). 이 셋은 더 이상 bin 맵에 없는 내부 실행 파일이다. `bin/jev-statusline.mjs`는 그대로 둔다.
- 하위 명령 해석은 순수 함수로 분리한다: `src/dispatch.mjs`에 `parseSubcommand(argv)`(argv는 `process.argv.slice(2)` 형태)를 export. 반환값은 `{ target: "claude" | "codex" | "explain", args }`.
  - 첫 인자가 `claude`/`codex`/`explain`이면 그 인자를 떼어내고 나머지를 args로.
  - 그 외(인자 없음, `--resume`, `-p ...` 등)는 `target: "claude"`, args는 원래 그대로.
- `bin/jev.mjs`: shebang(`#!/usr/bin/env node`)과 실행 권한(0755)을 갖는다. `parseSubcommand`로 대상을 정하고, `process.argv`를 `[node, 대상파일, ...args]`로 바꾼 뒤 `await import("./<target>.mjs")`한다. 내부 실행 파일들은 import되는 즉시 실행되고 `process.argv.slice(2)`를 읽는 구조라는 전제이므로, 개발자는 각 파일이 `process.argv[1]`이나 `import.meta.url`로 자기 위치/이름을 쓰는 곳을 확인하고 경로가 깨지지 않게 한다 (bin 안 상대 경로, `join(HERE, "jev-statusline.mjs")` 등).
- 내부 파일 세 개에 shebang이 남아 있어도 무방하나, bin 맵에서 빠졌으므로 실행 권한은 있어도 없어도 된다(기존 상태 유지).

## 문구·문서 갱신

- 사용자 안내 문구의 명령 이름: `jev-plus-codex` → `` `jev codex` ``, `jev-plus-claude` → `` `jev` `` 또는 `` `jev claude` ``, `jev-plus-explain` → `` `jev explain` `` (`src/codex-cli.mjs`, `src/codex-proxy.mjs`, `src/proxy.mjs`, `src/status.mjs`, `bin/*.mjs`).
- `.claude/skills/jev-explain/SKILL.md`: 실행 경로를 `bin/explain.mjs`로. `skills/codex/jev-explain/SKILL.md`: `` Run `jev explain` ``.
- README: 설치 `npm install -g jev-router-plus`, 실행 `jev` / `jev codex` / `jev explain`. 원본 `jev-claude`·`jev-codex`와 명령 이름이 달라 함께 설치해도 충돌하지 않는다는 한 줄 유지. Windows·로컬 clone 안내, 모든 명령 예시를 새 형태로. `docs/jev-claude-architecture.md`의 명령 이름·bin 경로도 갱신.
- 유지 목록(환경변수, `~/.jev-router.env`, 모델 id `jev-router`, 스킬 이름 `jev-explain`, 내부 상태 파일 이름)은 변경하지 않는다.

## 테스트

- `test/package.test.mjs` 갱신: bin 맵이 정확히 `{ jev: "bin/jev.mjs" }`, `bin/jev.mjs`와 내부 세 파일 존재, `bin/jev.mjs` 실행 비트, 옛 이름(`jev-plus-*`, 단독 `jev-claude `/`jev-codex ` 안내)이 src·bin·README·SKILL.md에 남아 있지 않음.
- `test/dispatch.test.mjs` 신규: `parseSubcommand`를 `[]`, `["codex","exec","hi"]`, `["explain","abc"]`, `["claude","-p","x"]`, `["--resume"]`, `["-p","hello"]`, `["codexish"]`(하위 명령이 아님 → claude)로 검증.
- 기존 (e) 항목은 `node bin/jev.mjs explain <없는 세션 id>`를 임시 HOME/TMPDIR로 실행해 종료 코드 0과 import 오류 없음을 확인하도록 갱신 (실제 Claude/Codex/네트워크 호출 금지).

## 완료 기준

1. `npm test` 전체 통과
2. `npm pack --dry-run`: bin 4개(`jev.mjs`, `claude.mjs`, `codex.mjs`, `explain.mjs`) + `jev-statusline.mjs`, src, skills, `.claude/skills` 포함, 민감·불필요 파일 없음
3. `npm link` 후 `jev -p "what is 2+2? answer with just the number"`가 응답하고 `[jev]` 라우팅 로그가 나옴 (`env -u OPENROUTER_API_KEY -u JEV_PROVIDER`로 환경 오염 제거 후 확인)
4. `jev explain`이 동작하고, `jev codex`가 최소한 기동 코드 경로에서 오류 없이 위임됨
5. 옛 이름 `jev-plus-*`가 어디에도 남아 있지 않음

---

# 개정: 문서 이중 언어(영문·한글), 코드 주석 영어

## 방침

- 사용자용 문서는 **영문판을 기준(원본)** 으로 하고 **한글판**을 함께 둔다. 두 판의 내용·구조·제목 순서·코드 블록·표는 동일해야 하며 번역 대상은 설명 문장뿐이다.
- 소스 코드의 주석·문자열·식별자는 **영어**로 쓴다. 현재 `src`, `bin`, `test`, 스킬 파일에는 한글이 없으므로 이 상태를 유지하고, 회귀를 막는 테스트를 추가한다.
- `docs/design.md`는 개발 작업용 내부 문서라 한글 단일본으로 유지한다(번역 대상 아님).

## 파일

| 영문(기준) | 한글 |
|---|---|
| `README.md` | `README.ko.md` (신규) |
| `docs/jev-claude-architecture.md` | `docs/jev-claude-architecture.ko.md` (신규) |

- 두 README 맨 위(제목 바로 아래)에 언어 전환 링크: 영문판은 `English | [한국어](README.ko.md)`, 한글판은 `[English](README.md) | 한국어`. 아키텍처 문서도 같은 방식(`[한국어](jev-claude-architecture.ko.md)` / `[English](jev-claude-architecture.md)`).
- `README.md` 3행의 한글 포크 고지는 **영어**로 바꾼다: "Fork of [gargpratyush/jev-router](https://github.com/gargpratyush/jev-router) that adds OpenRouter support, per-account model catalogs, and a single `jev` command. It uses the same environment variables and config files as the original." (실제 기능 목록은 현 README 내용과 맞출 것). 한글 고지는 `README.ko.md`로 옮긴다.
- 한글판의 용어는 통일한다: 명령·환경변수·파일 경로·모델 id·코드 블록은 번역하지 않고 그대로 둔다. 일반 용어는 라우팅(routing), 모델 등급(tier), 포크(fork), 프록시(proxy)로 쓴다.
- 한글판 README도 CRLF 줄바꿈(기존 README.md와 동일)을 쓴다. `README.md`의 CRLF는 유지한다. 새 `docs/*.ko.md`는 기존 `docs/jev-claude-architecture.md`의 줄바꿈과 맞춘다(`file`로 확인).
- 이미지 링크(`docs/model-picker.png` 등)는 한글판에서도 같은 파일을 가리킨다(경로는 파일 위치 기준으로 맞출 것).

## package.json / 버전

- `files`에 `README.ko.md`를 추가한다(`docs/`는 계속 제외).
- 패키지 내용이 바뀌므로 버전을 `0.4.1`로 올린다(`package.json`, `package-lock.json` 최상위·`packages[""]`). 테스트가 하드코딩한 `0.4.0`이 있으면 함께 갱신한다.

## 테스트 (`test/package.test.mjs` 또는 신규 `test/docs.test.mjs`)

1. `README.ko.md`, `docs/jev-claude-architecture.ko.md`가 존재하고, 영문판과 **제목(`#`~`###`) 개수·순서가 같다**(제목 수 비교). 코드 블록(```) 개수도 같다.
2. 각 문서가 반대 언어판으로 가는 링크를 가진다.
3. `README.md`와 `docs/jev-claude-architecture.md`에는 한글이 없다.
4. `src/**`, `bin/**`, `test/**`, `skills/**`, `.claude/skills/**`에는 한글이 없다(주석 영어 규칙). 단, 한글 검사를 하는 이 테스트 파일 자신이 정규식으로 한글 범위를 쓰는 것은 한글 문자 자체가 아니므로 문제없다(유니코드 이스케이프 `\u{AC00}-\u{D7A3}` 사용).
5. 기존 옛 이름 검사(`jev-plus` 등)의 대상에 `README.ko.md`와 `docs/jev-claude-architecture.ko.md`를 추가한다.
6. `npm pack --dry-run`에 `README.ko.md`가 포함된다(`files` 항목 존재 검사로 대체 가능).

## 완료 기준

1. `npm test` 전체 통과
2. 영문·한글 README가 구조(제목·코드 블록)가 같고, 번역이 자연스러우며 명령·환경변수·경로가 영문판과 정확히 일치
3. `README.md`에 언어 전환 링크 한 줄을 제외하고 한글 0자, `src`·`bin`·`test`·스킬에 한글 0자
4. 아키텍처 문서도 동일하게 이중 언어
5. CRLF 유지 (`README.md`, `README.ko.md`), `git diff --stat --ignore-space-at-eol`과 일반 diff가 같음
6. `npm pack --dry-run`: `README.ko.md` 포함, `docs/` 제외, 민감 파일 없음
7. 버전 `0.4.1`이 `package.json`·lockfile에서 일치
