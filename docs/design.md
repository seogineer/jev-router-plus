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

---

# 개정: README 사실 검토 결과 반영 (0.4.2)

verifier가 README 전체를 코드와 대조해 찾은 문제를 반영한다. 코드 3건(M5, C1, M3)을 먼저 고치고, README는 **수정된 코드의 실제 동작**을 기준으로 영·한 동시에 고친다. 줄 번호는 검토 당시 기준이므로 본문 텍스트로 위치를 찾을 것. 버전은 `0.4.2`.

## A. 코드 수정

**M5. 라우팅 키가 자식 CLI와 그 도구 셸로 새는 문제** (`bin/claude.mjs` ~78-88,116 / `src/codex-cli.mjs` ~261-273,353)
- 현재: env 파일(`.env`, `~/.jev-router.env`, `~/.jev-claude.env`)에서 읽은 모든 변수가 `process.env`에 들어가고, 그대로 Claude/Codex 자식 프로세스에 전달되어 모델이 실행하는 모든 Bash 명령에서 `JEV_API_KEY`/`OPENROUTER_API_KEY`가 보인다.
- 수정: 라우팅 키 이름 `JEV_API_KEY`, `TYPESAFE_API_KEY`, `OPENROUTER_API_KEY` 중, **env 파일 로딩 전에는 환경에 없었는데 로딩 후 생긴 것**만 자식 프로세스 환경에서 제거한다. 사용자가 셸에서 직접 export한 값은 사용자 의도이므로 그대로 둔다(사용자의 다른 도구가 같은 변수를 쓸 수 있다). 프록시는 같은 프로세스의 `process.env`를 계속 읽어야 하므로 `process.env` 자체는 건드리지 말고, spawn에 넘기는 env 객체만 걸러낸다. 로딩 전/후 비교 로직은 두 launcher가 공유하도록 `src/`의 작은 함수(예: `childEnv(before, after)` 또는 비슷한 이름)로 만들어 중복을 피한다. Codex가 자식 CLI 인증에 이 변수들을 실제로 필요로 하는지(예: provider 설정의 env_key) 코드를 읽어 확인하고, 필요하면 그 경로를 깨지 않게 한다 — 필요 여부와 결과를 보고할 것.
- `.env` 전체 로딩(프로젝트 `.env`의 모든 변수가 자식에게 전달됨)은 동작을 바꾸지 않고 README에 사실대로 명시한다.
- 테스트(`test/jev-cli.test.mjs` 확장): 임시 HOME의 `.jev-router.env`에 가짜 키를 두고 가짜 claude/codex를 띄웠을 때 자식 환경에 그 키 이름이 없음. 같은 키를 환경변수로 export해 두면 자식 환경에 남음. 가짜 키로 프록시가 뜨더라도 외부 네트워크 호출이 나가지 않게(가짜 claude/codex는 요청을 보내지 않음) 하고, 불안정하면 해당 항목만 빼고 이유를 보고.

**C1. Codex 스킬이 `jev` 명령에 의존** (`skills/codex/jev-explain/SKILL.md:7`, 설치: `src/codex-cli.mjs` ~254-258)
- 현재: 스킬이 "Run `jev explain`"이라고만 해서 `npm link` 없이 `node bin/jev.mjs codex`로 쓰면 `$jev-explain`이 실패한다.
- 수정: 스킬을 설치할 때(`installCodexSkill`) 명령을 **이 패키지의 `bin/explain.mjs` 절대 경로**를 가리키는 `node "<절대경로>/bin/explain.mjs"`로 치환해서 쓴다(템플릿 자리표시자 방식, 쉘에서 경로 인용 주의, 경로에 공백이 있어도 동작). 번들 `skills/codex/jev-explain/SKILL.md`는 자리표시자를 가진 템플릿이 되며 npm 패키지에 그대로 포함된다. 스킬이 이미 같은 내용이면 다시 쓰지 않는 기존 로직과 파일 권한(소유자 전용) 처리를 유지한다. 기존 테스트(`installs the bundled explanation skill for Codex`, `test/jev-cli.test.mjs`의 스킬 설치 확인)를 갱신하고, 절대 경로가 실제로 존재하는 파일을 가리키는지 검사를 추가한다.

**M3. `/jev-explain` 박스 출력** (`src/explain.mjs` ~229-230, 270, 280)
- 현재: `Current tier:`에 모델 ID가 대문자로, `Selected model:`이 31자에서 잘려 `CLAUDE-HAIKU-5-`처럼 출력된다.
- 수정: `Current tier:`는 등급 이름(예: `opus`)을 보여준다(모델 ID에서 등급을 구하는 기존 함수를 재사용, 알 수 없으면 모델 ID 그대로), `Selected model:`은 대문자화하지 않은 **전체 모델 ID**를 보여주고 박스 너비 안에서 잘리면 `…`로 끝내되 정상 길이의 모델 ID(`claude-haiku-5-5`, `claude-sonnet-4-5-20250929`)는 잘리지 않게 박스 폭을 맞춘다. 관련 테스트(`test/explain.test.mjs`)를 갱신한다.

## B. README 수정 (영문 기준, 한글 동일 반영, 구조·코드 블록 개수 동일 유지, CRLF 유지)

수정된 코드의 동작을 기준으로 쓴다.

- **C1**: 소스 설치 안내에서 `npm link` 없이도 `$jev-explain`이 동작한다고 쓰되 근거는 수정된 스킬(절대 경로)이다. 또는 사실대로 조건을 명확히.
- **M1**: "keeping only the newest model of each tier"는 Claude만. `jev`는 계정 카탈로그에서 등급별 최신 Claude 모델만, `jev codex`는 카탈로그에서 등급에 매핑되는 모든 GPT 모델을 Jev에 보낸다고 고친다. Codex 매핑 규칙(astra/fable/long→long, sol/opus/strong/max/pro→strong, luna/haiku/fast/mini/nano→fast, 그 외 `gpt-`→balanced)과 `JEV_CODEX_*` 변수를 빈 문자열로 두면 빈 문자열이 쓰인다는 점을 Codex 절에 짧게(Minor 8).
- **M2**: 상태 표시줄 예시를 실제 출력으로: `claude-haiku-5-5 (p=0.98) · my-project · 8% context`, 수동 선택 `⏸ manual Opus 5.5 · my-project · 21% context`, 신뢰도 부족 `claude-sonnet-5-5 (p=0.25) (low-confidence-capped) · …`, 첫 프롬프트 전 `jev: waiting for first prompt`. 실제 `bin/jev-statusline.mjs`를 읽고 정확한 형식을 확인할 것(⚡ 없음, 옛 모델명 Opus 4.6 제거).
- **M3**: `/jev-explain` 예시를 수정된 출력과 일치시킨다.
- **M4**: "Claude Code otherwise remains unchanged"를 삭제하고, `jev`가 바꾸는 것을 나열: 항상 `--add-dir <패키지 루트>` 추가, 라우팅이 켜지면 `CLAUDE_CODE_MAX_CONTEXT_TOKENS=1000000`, `ENABLE_TOOL_SEARCH=true`, `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1`, `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1` 설정, 센티널 모델(`jev-router`) 선택 중에는 Claude Code가 Advisor를 끄고 `unrecognized_model` 알림을 낸다는 점(bin/claude.mjs를 읽어 정확히).
- **M5**: 수정된 코드 기준으로 "env 파일에서 읽은 라우팅 키(`JEV_API_KEY` 등)는 실행되는 CLI와 그 도구 셸에 전달되지 않지만, 셸에서 export한 값과 `.env`의 다른 모든 변수는 전달된다. 실행한 디렉터리의 `.env`는 통째로 로드되므로 신뢰하는 저장소에서만 쓰라"고 쓴다. `chmod 600` 안내는 유지하되 보호 범위를 오해하지 않게 한 문장 보강.
- **M6**: `jev codex`가 `~/.agents/skills/jev-router-explain/SKILL.md`를 쓰고 `npm uninstall`로 지워지지 않으므로 삭제/업데이트 절에 수동 삭제 방법 추가. 공존 설명에 "두 패키지는 이 Codex 스킬 경로가 같아 마지막에 실행한 쪽이 내용을 덮어쓴다"를 추가(옛 명령 이름 정규식에 걸리지 않게 표현).
- **M7**: `JEV_DUMP`는 파일 이름 접두사이며 `<접두사>.<timestamp>.json`에 프롬프트·코드를 포함한 모든 요청 본문을 기본 권한으로 쓴다고 경고.
- **M8**: "Nothing else is [sent]"를 정확하게: 프롬프트 텍스트, 현재 모델, 추정 컨텍스트 크기, 사용 가능한 모델 ID와 설명.
- **Minor**: (1) 버전 문구를 사실대로: "이 포크는 Linux(Node 24)에서 Claude Code 2.1.309, Codex CLI 0.153.4로 확인했다. 원 프로젝트는 Windows에서 Claude Code v2.1.101, Codex v0.154.0으로 개발"로, 확인하지 못한 환경(Windows/macOS)은 "미검증"이라고 명시. (2) 스크린샷 두 장은 그대로 두고 캡션/문장으로 "이미지는 이전 모델명·표시를 보여준다"고 명시, Codex 선택기의 항목 이름은 `jev-router`라고 정정. (3) 모델 선택기 복원 문구 "cannot break plain claude"를 "정상 종료 시 복원, 강제 종료(SIGKILL)되면 다음 `jev` 실행 때까지 센티널이 남을 수 있다"로. (4) "steps upward" 규칙: fable로는 올리지 않고, 더 높은 등급이 없으면 내려간다(src/policy.mjs). (5) `JEV_DEBUG` 행: 라우팅 실패는 JEV_DEBUG 없이도 `~/.jev-claude.log`에 기록, `-p` 모드에서는 로그가 stderr. (6) "starts Claude Code without routing"→"starts the CLI without routing". (7) Codex는 첫 턴에도 실제 컨텍스트 값을 정책에 전달해 첫 턴 다운그레이드가 캐시 가드에 막힐 수 있다는 차이를 한 줄. (9) `jev explain <session-id>`의 ID 출처: Claude는 세션 UUID, Codex는 `codex-<pid>`(스킬이 알아서 전달하므로 보통 직접 쓸 일 없음)로 설명. (10) Codex "unavailable" 메시지의 의미(키가 있어도 네트워크/Jev 실패 시 나옴). (11) 사용자가 `ANTHROPIC_MODEL`을 직접 설정했으면 그 값이 우선해 Jev Router로 시작하지 않는다. (12) 환경변수 표에 `TYPESAFE_DEFAULT_MODEL`, `TYPESAFE_LOG_LEVEL`(SDK가 읽음; 동작을 SDK 코드로 확인하고 확인 안 되면 쓰지 말 것). (13) "until the CLI fetches its catalog"→"until the catalog is fetched". (14) `jev claude` 하위 명령과, 첫 인자가 `claude`/`codex`/`explain`이면 하위 명령으로 취급된다는 점. (15) 한글판 "(normally under ...)"를 한국어로. (16) 개발 섹션의 `echo ... > .env`가 기존 `.env`를 덮어쓴다는 주의.
- 같은 오류가 영·한 양쪽에 있으므로 두 파일을 항상 함께 고친다. 한글 번역은 기존 용어 규칙(라우팅/등급/포크/프록시, 등급 이름은 영어)을 따른다.

## C. 부수 작업

- `package.json`/`package-lock.json` 버전을 `0.4.2`로.
- `docs/jev-claude-architecture.md`(+`.ko.md`)가 위 코드 변경(예: 키 전달)으로 부정확해지는 곳이 있으면 함께 수정.
- 미해결로 남기는 것(보고에 명시): Windows/macOS 동작, `jev codex exec`/`resume` 서브커맨드 라우팅, 스크린샷 재촬영.

## 완료 기준

1. `npm test` 전체 통과(기존 124 + 신규), 신규 테스트가 M5·C1·M3을 각각 검증.
2. 임시 HOME에서 env 파일의 가짜 키가 자식 환경에 없고, export한 키는 남는다. 설치된 Codex 스킬의 명령이 실제 존재하는 `bin/explain.mjs` 절대 경로를 가리키며 `node`로 실제 실행 시 종료코드 0.
3. `jev explain <session-id>`가 등급 이름과 전체 모델 ID를 올바르게 출력(샘플 상태 파일로).
4. 영·한 README/아키텍처 문서: 제목·코드 블록 개수 동일, 한글 검사 통과, CRLF 유지, 위 B 항목 전부 반영.
5. `npm pack --dry-run`에 변경된 스킬 템플릿 포함, 민감 파일 없음, 버전 0.4.2.

---

# 개정: `/jev-explain` 박스의 표시 폭 정렬 (0.4.3)

verifier·tester 보고: `src/explain.mjs`의 박스(`row`, `wrapped`)가 패딩·잘라내기·줄바꿈을 UTF-16 코드 유닛 길이로 계산해서, 한글(터미널 2칸)·이모지(2칸)·결합 문자(0칸)가 들어가면 오른쪽 테두리가 어긋나고, 잘라낼 때 서로게이트 쌍이 반으로 잘릴 수 있다. 한국어 프롬프트가 흔한 환경이라 자주 보인다. 박스를 유지하고 **표시 폭 기반**으로 계산을 바꾼다. README의 ASCII 예시 박스는 글자 하나도 바뀌지 않아야 한다.

## 구현

- 표시 폭 함수 `displayWidth(str)`와 폭 기준 자르기 함수(예: `truncateToWidth(str, maxWidth)` — 폭을 넘으면 `…`로 끝내고 결과 폭이 maxWidth 이하, 코드 포인트 단위로 순회해 서로게이트 쌍·ZWJ 시퀀스를 반으로 자르지 않음)를 `src/width.mjs`에 만든다(의존성 추가 금지, 순수 함수, 영어 주석).
- 폭 규칙(East Asian Width 단순화): 코드 포인트 단위로 순회. 폭 0: `\p{M}`(결합 표시), U+200B–U+200D, U+FE00–U+FE0F(variation selectors), 제어 문자. 폭 2: `\p{Extended_Pictographic}`, U+1100–115F, U+2E80–U+303E, U+3041–U+33FF, U+3400–U+4DBF, U+4E00–U+9FFF, U+A000–U+A4CF, U+AC00–U+D7A3, U+F900–U+FAFF, U+FE30–U+FE4F, U+FF00–U+FF60, U+FFE0–U+FFE6, U+1F300–U+1FAFF, U+20000–U+3FFFD. 그 외 폭 1. ZWJ 시퀀스(이모지+U+200D+이모지)는 하나의 이모지처럼(폭 2) 취급하면 더 좋지만, 단순화해 각 이모지를 2로 세는 것도 허용(그 한계를 주석에 적을 것). 탭은 공백 1칸으로 치환하거나 폭 1.
- `src/explain.mjs`의 `row`(패딩), 잘라내기, `wrapped`(줄바꿈 기준)가 모두 이 함수를 쓰게 한다. 박스 폭 상수(내부 폭)는 현재 값을 유지한다. 줄바꿈은 가능하면 단어 경계, 단어가 폭보다 길거나 공백 없는 한글 문장은 폭 기준으로 강제 분할(코드 포인트 경계).
- 알려진 한계(터미널·폰트별 이모지 폭 차이, ZWJ/국기 이모지)는 코드 주석에 영어로 짧게 명시.

## 테스트

- `test/width.test.mjs` 신규: `displayWidth`를 ASCII(`abc`=3), 한글(`한글`=4), 혼합(`hi 한글`=7), 이모지(`😀`=2, `🚀`=2), 결합 문자(`e`+U+0301=1), ZWJ·variation selector 포함 문자열, 빈 문자열, 일본어·중국어로 검증. `truncateToWidth`는 폭 초과 시 `…`로 끝나고 결과 폭 ≤ max, 서로게이트 쌍을 자르지 않음(결과를 `[...result]`로 순회해 깨진 문자 없음), 폭이 정확히 같을 때 자르지 않음, 2칸 문자가 경계에 걸릴 때(남은 폭 1) 처리.
- `test/explain.test.mjs`: 프롬프트·모델 ID에 한글/이모지가 있어도 박스의 모든 줄의 **표시 폭이 같고**(각 줄에 `displayWidth` 적용), 줄 앞뒤 테두리 문자가 정확하며, 정상 ASCII 샘플의 출력이 이전과 바이트 단위로 같음(기존 테스트가 이를 보장하면 유지). 긴 한글 프롬프트가 폭 기준으로 줄바꿈됨.

## 부수

- 버전 `0.4.3`(package.json, package-lock.json 최상위·packages[""]). README는 박스 예시가 그대로이므로 수정 불필요하되, README 영·한에 박스 한글 정렬에 대한 언급이 있으면 사실과 맞게 정리.
- 줄바꿈 규칙: 기존 파일의 줄바꿈 형식(CRLF/LF/혼합)을 그대로 유지하고(`git ls-files --eol`로 확인), 새 파일은 LF.

## 완료 기준

1. `npm test` 전체 통과(현재 166 + 신규), 기존 ASCII 박스 출력과 README 예시가 변하지 않음.
2. 한글·이모지·혼합 프롬프트/모델 ID로 만든 박스에서 모든 줄의 표시 폭이 같음(테스트로 고정).
3. `git diff --stat HEAD`와 `--ignore-space-at-eol` 결과가 거의 같음(줄바꿈 회귀 없음).
4. 버전 0.4.3이 package.json·lockfile에서 일치, `npm pack --dry-run`에 `src/width.mjs` 포함.
