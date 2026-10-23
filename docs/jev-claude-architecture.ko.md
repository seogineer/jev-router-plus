# `jev` 아키텍처

[English](jev-claude-architecture.md) | 한국어

```mermaid
flowchart TB
  user([User]) --> command["`jev`\nCLI wrapper"]

  subgraph launcher["Launcher — bin/claude.mjs"]
    direction TB
    command --> env["Load environment\nprecedence: process env → .env → ~/.jev-router.env → ~/.jev-claude.env"]
    env --> find["Find `claude` executable on PATH"]
    env --> saved["Read existing ~/.claude/settings.json model\nfor later restoration"]
    find --> key{"JEV_API_KEY, TYPESAFE_API_KEY\nor OPENROUTER_API_KEY?"}

    key -- No --> direct["Spawn real Claude Code\nwithout routing"]
    key -- Yes --> proxyStart["Start ephemeral loopback proxy\n127.0.0.1:random-port"]
    proxyStart --> launchEnv["Set ANTHROPIC_BASE_URL to proxy\nExpose `jev-router` as Jev Router in /model\nDefault to `jev-router` unless user set ANTHROPIC_MODEL"]
    launchEnv --> statusCfg{"Status line allowed?"}
    statusCfg -- "No: JEV_NO_STATUSLINE or user statusLine" --> spawn
    statusCfg -- Yes --> statusCfgFile["Write temporary Claude status-line settings"] --> spawn
    direct --> spawn["Spawn real Claude Code\nwith original CLI arguments plus --add-dir\nRouting keys loaded from env files\nare removed from the child environment"]
  end

  spawn --> claude["Claude Code\n(native UI, login, tools, sessions, permissions)"]
  claude --> picker{"/model selection"}
  picker -- "Jev Router" --> auto["model: `jev-router`\n(routing sentinel)"]
  picker -- "Concrete model" --> manual["model: user-selected model"]
  auto --> loopback
  manual --> loopback

  subgraph proxy["Loopback proxy — src/proxy.mjs"]
    direction TB
    loopback["Receive HEAD or /v1/messages request"]
    loopback --> head{"HEAD probe?"}
    head -- Yes --> headOK["Return 200"]
    head -- No --> parse["Parse request body\nOptionally dump body with JEV_DUMP\nNormalize legacy MCP JSON schemas"]
    parse --> mode{"model is `jev-router`?"}

    mode -- No --> pass["Leave model unchanged\nFor agent requests, publish manual status"]
    mode -- Yes --> conversation["Build conversation key\nsession ID + first-message text\nKeep up to 50 independent states"]
    conversation --> fresh{"Fresh user turn?\n(tool-bearing, last user text,\nnot a tool-result continuation)"}
    fresh -- No --> pinned["Reuse tier pinned for this conversation\n(default: sonnet)"]
    fresh -- Yes --> prompt["Remove system-reminder blocks\nEstimate context tokens"]
    prompt --> jev
    jev --> policy
    policy --> saveTier["Pin chosen tier in conversation state"]
    saveTier --> pinned
    pinned --> rewrite["Rewrite `jev-router` to Claude tier model ID\nStrip unsupported thinking / effort fields"]
    rewrite --> publish["Write latest tier, confidence, and reason\nto per-session temp status file"]
    pass --> forward
    publish --> forward["Forward request to api.anthropic.com\nPreserve Claude Code authorization headers\nstream upstream response unchanged"]
  end

  subgraph routing["Routing — src/router.mjs + src/policy.mjs"]
    direction TB
    jev["TypeSafe / Jev systemOne call\nSends only fresh user prompt plus:\ncurrent tier, approximate context, available tiers"]
    policy["Policy resolves final tier\n• prompt override wins\n• failure / malformed answer: keep current\n• low confidence: no downgrade; upgrades capped at sonnet\n• large context: no downgrade that rebuilds cache\n• unavailable tier: choose nearest stronger available\n• fable requires JEV_ALLOW_FABLE=1"]
  end

  forward --> anthropic["Anthropic API"]
  anthropic --> claude

  subgraph visibility["Routing visibility — status.mjs + jev-statusline.mjs"]
    direction TB
    statusFile["Temp file: $TMPDIR/jev-claude/<session>.json"]
    statusLine["Claude Code status-line command\nReads session file and renders:\n⚡ tier + confidence, or ⏸ manual"]
    statusFile --> statusLine
  end
  publish --> statusFile
  pass --> statusFile
  statusLine --> claude

  spawn --> exit["On process exit: close proxy\nand restore saved model only if it is still `jev-router`"]
```

라우팅 호출은 사용자 턴의 첫 요청에서만 일어납니다. 도구 루프의 이어지는 요청은
고정된 등급을 재사용하므로, 라우팅 지연이 반복되거나 작업 도중 모델이 바뀌는 일이 없습니다.
Claude Code에서 구체적인 모델을 선택하면, 사용자가 **Jev Router**를 다시 선택할 때까지
라우팅을 건너뜁니다.
