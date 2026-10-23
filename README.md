# jev-router-plus

English | [한국어](README.ko.md)

> Fork of [gargpratyush/jev-router](https://github.com/gargpratyush/jev-router) that adds OpenRouter support, per-account model catalogs, and a single `jev` command. It uses the same environment variables and config files as the original.
>
> Install with `npm install -g jev-router-plus` and run `jev` (Claude Code), `jev codex`, or `jev explain`. The command names differ from the original `jev-router`'s, so both can be installed side by side without conflict.

Automatic per-turn model routing for Claude Code and OpenAI Codex. Jev sends simple work to
the fast tier and difficult work to the strong tier, while preserving each CLI's native
interface, tools, sessions, permissions, and authentication.

| Command | Interface | Authentication | Routing decision |
| --- | --- | --- | --- |
| `jev` | Claude Code | Existing `claude login` | Status line |
| `jev codex` | OpenAI Codex | Existing `codex login` | Commentary line |

Both commands launch the real upstream CLI. Jev only chooses the model for a fresh user turn.

## Quick start

### 1. Requirements

- Node.js 20.12 or later.
- [Claude Code](https://code.claude.com/docs/en/setup) and/or
  [OpenAI Codex](https://developers.openai.com/codex/cli), already installed and logged in.
  With a subscription login, no Anthropic or OpenAI API key is needed.

### 2. Install from npm

```bash
npm install -g jev-router-plus
```

This installs a single command, `jev`: `jev` (Claude Code), `jev codex`, and `jev explain`.
The original `jev-router` package uses different command names, so both can be installed side
by side without conflict. They share the same `~/.jev-router.env` file and environment variables.

To install from source instead:

```bash
git clone https://github.com/seogineer/jev-router-plus.git
cd jev-router-plus
npm install
npm link
```

Without `npm link`, run `node bin/jev.mjs` or `node bin/jev.mjs codex` from the checkout.

### 3. Set a routing key

Choose one provider and append its key to `~/.jev-router.env`. Replace `...` with your real key; do not paste the placeholder.

Option A: a TypeSafe key from [TypeSafe](https://docs.typesafe.ai).

```bash
printf '\nJEV_API_KEY=...\n' >> ~/.jev-router.env
```

Option B: an OpenRouter key from <https://openrouter.ai/keys>, paid with OpenRouter credits.

```bash
printf '\nOPENROUTER_API_KEY=...\n' >> ~/.jev-router.env
```

On Linux and macOS, restrict the file to your user:

```bash
chmod 600 ~/.jev-router.env
```

On Windows PowerShell, Option A:

```powershell
Add-Content "$HOME\.jev-router.env" "`nJEV_API_KEY=..."
```

On Windows PowerShell, Option B:

```powershell
Add-Content "$HOME\.jev-router.env" "`nOPENROUTER_API_KEY=..."
```

If both keys are set, TypeSafe is used; add `JEV_PROVIDER=openrouter` to use OpenRouter instead.
Without a key, the CLI starts without routing. Environment variables already exported in your
shell take precedence over the file.

### 4. Launch

Run either interface from any repository:

```bash
jev
jev codex
```

Every CLI argument is forwarded:

```bash
jev --resume
jev -p "fix the failing test"
jev codex resume --last
jev codex exec "fix the failing test"
```

`jev explain <session-id>` prints the routing explanation for a session. Without an argument it only checks the installation; see below.

### 5. Verify, update, and uninstall

```bash
jev explain
npm ls -g jev-router-plus
npm update -g jev-router-plus
npm uninstall -g jev-router-plus
```

`jev explain` without an argument reads no session, so in a regular shell it exits with code 0
and reports that no routing decision has been recorded; use it only to confirm the command is
installed. To see an actual explanation, run `/jev-explain` in Claude Code, `$jev-explain` in
Codex, or `jev explain <session-id>`. Do not use `jev --version` to check the installation: it is
forwarded to Claude Code and prints Claude's version.

## Claude Code interface

![Jev Router in the Claude Code model picker](docs/model-picker.png)

`jev` launches Claude Code with **Jev Router** selected in `/model`. Selecting another
model pauses routing; selecting **Jev Router** resumes it.

The injected status line shows the model used for the last turn:

```text
⚡ haiku p=0.98 · my-project · 8% context
⏸ manual Opus 4.6 · my-project · 21% context
```

Claude Code otherwise remains unchanged, including its keybindings, tools, permission prompts,
`/compact`, `/resume`, and session handling. An existing custom `statusLine` is preserved;
set `JEV_NO_STATUSLINE=1` to disable Jev's status line.

The explanation skill is bundled with the npm package and loaded automatically: run
`/jev-explain` in `jev`, or `$jev-explain` in `jev codex`, to see the factors behind
the last routing decision:

```text
┌─────────────────────────────────┐
│ Jev Router                      │
│                                 │
│ Jev request                     │
│ Prompt: explain the router      │
│ Current tier: HAIKU             │
│ Context tokens: 6200            │
│                                 │
│ Jev response                    │
│ Task complexity     0.82        │
│ Reasoning required  0.91        │
│ Tool complexity     0.64        │
│ Context size        0.31        │
│                                 │
│ Recommended tier: SONNET        │
│ Selected model: SONNET          │
│                                 │
│ Confidence: 94%                 │
│ Decision: Jev recommendation    │
└─────────────────────────────────┘
```

The report is rendered locally from the exact prompt, System One request, and System One
response saved when routing occurred. Recent decisions are retained per CLI session; invoking
the explanation skill does not ask Jev to score the prompt again.

### Explanation data location

Both `jev` and `jev codex` keep up to 20 recent routing exchanges in one JSON file per
CLI session under Node.js's operating-system temporary directory:

| Platform | Default location |
| --- | --- |
| Windows | `%TEMP%\jev-claude\<session-id>.json` |
| macOS | `$TMPDIR/jev-claude/<session-id>.json` (normally under `/var/folders/.../T`) |
| Ubuntu/Linux | `${TMPDIR:-/tmp}/jev-claude/<session-id>.json` |

Print the exact directory selected on the current machine with:

```bash
node -e "console.log(require('node:path').join(require('node:os').tmpdir(), 'jev-claude'))"
```

Claude filenames use Claude Code's session UUID. Codex filenames use
`codex-<process-id>.json`. These temporary files contain prompt text and Jev's exact
request and response, so they are readable only by you (the directory is created with mode 700 and each
file with 600). Files not updated for 7 days are deleted automatically, and the operating system
may also remove them during normal temporary-file cleanup.

> Choosing a model with `Enter` can save it as Claude Code's default. `jev` restores
> the previous default on exit so `jev-router` cannot break plain `claude`.

## OpenAI Codex interface

![Jev Router in the OpenAI Codex model picker](docs/codex-model-picker.png)

`jev codex` launches Codex with a temporary **Jev Router** provider and selects `jev-router`.
The native `/model` picker still contains the models available to the account. Selecting a
concrete model pauses routing; selecting **Jev Router** resumes it.

Each fresh decision appears as Codex commentary:

```text
[Jev] routed this turn to gpt-5.6-sol (jev, confidence 0.91).
```

`jev codex` installs or refreshes the packaged `$jev-explain` skill when it starts, so it is
available from any repository without separate setup.

Codex's footer shows `jev-router` because it displays the selected picker entry,
not the model chosen behind that provider. If Jev is unavailable, the commentary names the
fallback model and explains how to set `JEV_API_KEY` or `OPENROUTER_API_KEY`.

## How it works

Each command starts a loopback proxy, launches the real CLI, and forwards the CLI's existing
authorization headers without reading, storing, or modifying them.

```text
you -> Claude Code -> jev proxy -> Anthropic
                         |
                         +-> Jev: choose a tier

you -> OpenAI Codex -> jev codex proxy -> OpenAI
                         |
                         +-> Jev: choose a tier
```

Claude Code uses `ANTHROPIC_BASE_URL`; Codex uses a temporary custom provider with
`requires_openai_auth=true`. Claude and Codex both use `jev-router` as the
routing sentinel.
Any concrete model selected by the user passes through unchanged.

## Routing policy

One Jev call per fresh user turn selects a shared abstract tier:

| Tier | Claude Code default | Codex default |
| --- | --- | --- |
| Fast | Haiku | `gpt-5.6-luna` |
| Balanced | Sonnet | `gpt-5.6-terra` |
| Strong | Opus | `gpt-5.6-sol` |
| Long | Fable | `gpt-6-astra` |

`src/policy.mjs` then applies these rules:

- explicit requests such as `use opus`, `use luna`, or `use strong` win;
- failure, timeout, or an unrecognised Jev answer keeps the current model;
- low confidence never downgrades and caps upgrades at the balanced tier;
- large conversations refuse downgrades that would waste more prompt-cache work than they save;
- unavailable tiers step upward rather than silently choosing a weaker model;
- the long tier is disabled unless `JEV_ALLOW_FABLE=1`.

Tool-loop continuations keep the tier chosen at the start of the turn. Main conversations and
sub-agents are pinned separately. Routing is fail-open: Jev failure never blocks the CLI.

## Configuration

| Variable | Interface | Effect |
| --- | --- | --- |
| `JEV_API_KEY` | Both | Enables routing through TypeSafe. `TYPESAFE_API_KEY` also works. |
| `TYPESAFE_BASE_URL` | Both | Sends routing decisions to another System-One server instead of `https://api.typesafe.ai`, for example a self-hosted [Laya](https://github.com/NandhaKishorM/laya) serving `POST /v1/systemone`. `JEV_API_KEY` is still required and is sent to that server as the bearer token. OpenRouter uses `JEV_OPENROUTER_URL` instead. |
| `OPENROUTER_API_KEY` | Both | Enables routing through OpenRouter when no TypeSafe key is set. |
| `JEV_PROVIDER` | Both | Forces `typesafe` or `openrouter` when both keys are present. |
| `JEV_OPENROUTER_MODEL` | Both | OpenRouter model id; defaults to `typesafe/jev-1.13`. |
| `JEV_OPENROUTER_URL` | Both | OpenRouter decisions endpoint; defaults to `https://openrouter.ai/api/alpha/decisions`. |
| `JEV_ALLOW_FABLE` | Both | Enables the opt-in long tier. |
| `JEV_DEBUG` | Both | Logs decisions and rewrites to `~/.jev-claude.log` in interactive sessions. |
| `JEV_DUMP` | Both | Dumps request bodies for debugging wire-format changes. |
| `JEV_NO_STATUSLINE` | Claude | Disables the injected Claude status line. |
| `JEV_CODEX_FAST_MODEL` | Codex | Fast model; defaults to `gpt-5.6-luna`. |
| `JEV_CODEX_BALANCED_MODEL` | Codex | Balanced model; defaults to `gpt-5.6-terra`. |
| `JEV_CODEX_STRONG_MODEL` | Codex | Strong model; defaults to `gpt-5.6-sol`. |
| `JEV_CODEX_LONG_MODEL` | Codex | Long model; defaults to `gpt-6-astra`. |

Existing environment variables have highest precedence, followed by `.env` in the launch
directory, `~/.jev-router.env`, and the legacy `~/.jev-claude.env`.

Tier definitions, Jev's question, confidence thresholds, and timeouts live in `src/config.mjs`.
Both launchers send Jev the exact models in the signed-in account's native catalog, keeping
only the newest model of each tier (e.g. `claude-opus-5-5` rather than also `claude-opus-4-8`).
Static model ids are used only until the CLI fetches its catalog.

## Compatibility notes

- Claude Code needs schema normalisation for older MCP JSON Schema fields when a custom base
  URL is active.
- Claude request fields unsupported by a routed tier, such as adaptive thinking on Haiku,
  are removed before forwarding.
- Codex's current request format stores tool definitions inside its Responses API input.
- Codex's ChatGPT backend may stream SSE without a `Content-Type` header; the proxy detects
  the event stream from its first frame.
- Codex workspace-specific enterprise origins are internal to its built-in provider and
  cannot be reproduced by a custom provider.

## Development

```bash
npm install
echo "JEV_API_KEY=..." > .env

npm test
node test/live-routing.mjs
node bin/jev.mjs -p "what is 2+2?"
node bin/jev.mjs codex exec "what is 2+2?"
```

The test suite covers shared policy, both request formats, model rewriting, capability
handling, settings restoration, Codex authentication forwarding, native model-picker
injection, and decision display.

## Limitations

- The user's prompt text is sent to TypeSafe (or to `TYPESAFE_BASE_URL`, when set), or to OpenRouter
  when that provider is selected, for the routing decision. Nothing else is.
- A self-hosted Laya reports `confidence` as normalized entropy, `1 - H(p)/log k`, not as the chosen
  option's probability, so `THRESHOLDS.minConfidence` is read on that scale. Check it against
  your own server before relying on it.
- If both `JEV_API_KEY` and `OPENROUTER_API_KEY` are set, TypeSafe is used; OpenRouter is only
  enabled by `JEV_PROVIDER=openrouter`. An invalid `JEV_PROVIDER` value, or a missing key for the
  chosen provider, starts Claude Code without routing (with a warning). Variables exported in the
  shell take precedence over `~/.jev-router.env`.
- Jev adds latency only to the first request of a turn; tool-loop continuations add none.
- Claude Code and Codex request formats are not public contracts. Use `JEV_DUMP` to diagnose
  upstream changes.
- Developed and tested on Windows against Claude Code v2.1.101 and OpenAI Codex v0.154.0.

## Contributing

Issues and pull requests are welcome. Use [Issues](https://github.com/seogineer/jev-router-plus/issues)
to report bugs, request improvements, or ask questions. Include the relevant Claude Code or
Codex version, reproduction steps, expected behavior, and useful logs with secrets removed.

For a pull request:

1. Open an issue first - all PRs by contributors should be linked with an approved issue. Explain the problem and validation in the issue description.
2. Fork the repository and create a focused branch from `master`.
3. Make the smallest change that solves the problem.
4. Run `npm test` and include tests for non-trivial behavior changes.
5. Claude/Copilot/Codex shall not be the contributors. 

Please do not commit API keys or other secrets. All contributions require review, and only the
repository owner can merge pull requests.

## License

MIT
