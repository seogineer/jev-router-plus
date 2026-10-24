import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  sanitizeSchema,
  newTurnPrompt,
  isClaudeAuxiliaryPrompt,
  applyTier,
  claudeModels,
  conversationKey,
  sessionOf,
  startProxy,
} from "../src/proxy.mjs";
import { formatExplanation } from "../src/explain.mjs";

test("only the sentinel model is routed", () => {
  assert.equal(isAuto("jev-router"), true);
  assert.equal(isAuto("claude-opus-4-6"), false, "a model the user picked is theirs");
  assert.equal(isAuto("claude-haiku-5-5"), false, "internal Haiku calls pass through");
  assert.equal(isAuto(undefined), false);
});

test("the sentinel is not mistaken for a real tier", () => {
  assert.equal(tierOf("jev-router"), null);
});
import { tierOf, isAuto, idOf } from "../src/config.mjs";
import { writeDecision, writeStatus, readStatus, pruneStale, writePrivate, STATUS_DIR } from "../src/status.mjs";
import { mkdirSync, statSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

test("reads the session id out of Claude Code's metadata", () => {
  const sid = "11111111-2222-4333-8444-555555555555";
  assert.equal(sessionOf({ metadata: { user_id: JSON.stringify({ session_id: sid }) } }), sid);
  assert.equal(sessionOf({ metadata: { user_id: "not-json" } }), "");
  assert.equal(sessionOf({}), "");
});

test("status round-trips per session and misses cleanly", () => {
  const sid = `test-${process.pid}`;
  writeStatus(sid, { tier: "opus", confidence: 0.87, reason: "jev" });
  assert.deepEqual(readStatus(sid), { tier: "opus", confidence: 0.87, reason: "jev" });
  assert.equal(readStatus("no-such-session"), null);
  assert.doesNotThrow(() => writeStatus("", { tier: "opus" }));
});

test("status files are private to their owner", { skip: process.platform === "win32" }, () => {
  const sid = `perm-${process.pid}`;
  writeStatus(sid, { tier: "opus" });
  assert.equal(statSync(STATUS_DIR).mode & 0o777, 0o700);
  assert.equal(statSync(join(STATUS_DIR, `${sid}.json`)).mode & 0o777, 0o600);
});

test("files handed to Claude Code are private to their owner", { skip: process.platform === "win32" }, () => {
  const file = join(STATUS_DIR, `private-${process.pid}.json`);
  writePrivate(file, "{}");
  assert.equal(statSync(STATUS_DIR).mode & 0o777, 0o700);
  assert.equal(statSync(file).mode & 0o777, 0o600);
});

test("a file an earlier version left readable is tightened", { skip: process.platform === "win32" }, () => {
  const file = join(STATUS_DIR, `loose-${process.pid}.json`);
  mkdirSync(STATUS_DIR, { recursive: true });
  writeFileSync(file, "{}", { mode: 0o644 });
  writePrivate(file, "{}");
  assert.equal(statSync(file).mode & 0o777, 0o600);
});

test("stale status files are pruned and fresh ones kept", () => {
  mkdirSync(STATUS_DIR, { recursive: true });
  const stale = join(STATUS_DIR, `stale-${process.pid}.json`);
  const fresh = join(STATUS_DIR, `fresh-${process.pid}.json`);
  writeFileSync(stale, "{}");
  writeFileSync(fresh, "{}");
  const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  utimesSync(stale, old, old);
  assert.ok(pruneStale() >= 1);
  assert.equal(existsSync(stale), false);
  assert.equal(existsSync(fresh), true);
});

test("routing status retains the exact recent Jev exchanges", () => {
  const sid = `history-${process.pid}`;
  writeDecision(sid, { prompt: "first", jev: { request: { id: 1 }, response: { confidence: 0.6 } } });
  writeDecision(sid, { prompt: "second", jev: { request: { id: 2 }, response: { confidence: 0.8 } } });
  const status = readStatus(sid);
  assert.equal(status.prompt, "second");
  assert.deepEqual(status.history.map(({ prompt }) => prompt), ["first", "second"]);
  assert.equal(status.history[0].jev.response.confidence, 0.6);
});

test("recognises older model versions within a tier", () => {
  assert.equal(tierOf("claude-sonnet-4-6"), "sonnet");
  assert.equal(tierOf("claude-sonnet-5-5"), "sonnet");
  assert.equal(tierOf("claude-haiku-5-5"), "haiku");
  assert.equal(tierOf("claude-opus-4-1"), "opus");
  assert.equal(tierOf("claude-fable-5-1[1m]"), "fable");
  assert.equal(tierOf("gpt-9"), null);
  assert.equal(tierOf(undefined), null);
});

test("keeps only the newest model of each tier as a Jev choice", () => {
  assert.deepEqual(
    claudeModels([
      { id: "claude-opus-5-5", display_name: "Claude Opus 5" },
      { id: "claude-opus-4-8", display_name: "Claude Opus 4.8" },
      { id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5" },
    ]).map(({ id, tier }) => ({ id, tier })),
    [
      { id: "claude-opus-5-5", tier: "opus" },
      { id: "claude-sonnet-5-5", tier: "sonnet" },
    ],
  );
});

test("claudeModels judges the newest version by created_at when the catalog has it", () => {
  // Version numbers say 4-8 is older, but the catalog's release dates win.
  assert.deepEqual(
    claudeModels([
      { id: "claude-opus-5-5", created_at: "2026-01-01T00:00:00Z" },
      { id: "claude-opus-4-8", created_at: "2026-06-01T00:00:00Z" },
    ]).map(({ id }) => id),
    ["claude-opus-4-8"],
  );
});

test("claudeModels compares id version numbers numerically when created_at is missing", () => {
  const ids = (catalog) => claudeModels(catalog.map((id) => ({ id }))).map((model) => model.id);
  assert.deepEqual(ids(["claude-sonnet-4-5-20250929", "claude-sonnet-5-5"]), ["claude-sonnet-5-5"]);
  assert.deepEqual(ids(["claude-sonnet-5-5", "claude-sonnet-4-5-20250929"]), ["claude-sonnet-5-5"]);
  assert.deepEqual(ids(["claude-opus-4-5-20251101", "claude-opus-5-5"]), ["claude-opus-5-5"]);
  // 4-10 is newer than 4-9 even though "10" < "9" as strings.
  assert.deepEqual(ids(["claude-opus-4-9", "claude-opus-4-10"]), ["claude-opus-4-10"]);
});

test("the first turn has no prompt cache to protect, so a large opening message can still start cheap", async (t) => {
  const seen = [];
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url?.startsWith("/v1/models")) return res.end('{"data":[]}');
      seen.push(JSON.parse(Buffer.concat(chunks)));
      res.end('{"id":"msg_1","type":"message","model":"claude-haiku-5-5"}');
    });
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => upstream.close());

  const { port, close } = await startProxy({
    upstreamURL: `http://127.0.0.1:${upstream.address().port}`,
    route: async () => ({ choice: "claude-haiku-5-5", confidence: 0.95, ms: 1 }),
  });
  t.after(close);

  // ~40k tokens of injected instructions in the opening message, as Claude Code does with
  // CLAUDE.md and SessionStart hooks; measured 38k on a real first request.
  const opening = `<system-reminder>${"x".repeat(160000)}</system-reminder>\nrename this variable`;
  await fetch(`http://127.0.0.1:${port}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "jev-router",
      tools: [{ name: "Bash" }],
      messages: [{ role: "user", content: opening }],
    }),
  });

  assert.equal(seen[0].model, "claude-haiku-5-5", "first turn pinned to opus by the cache guard");
});

test("Claude proxy sends exact account models to Jev and routes the chosen version", async (t) => {
  const seen = [];
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (req.url.startsWith("/v1/models")) {
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify({
          data: [
            { id: "claude-opus-5-5", display_name: "Claude Opus 5" },
            { id: "claude-opus-4-8", display_name: "Claude Opus 4.8" },
            { id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5" },
          ],
        }));
      }
      seen.push(JSON.parse(Buffer.concat(chunks)));
      res.setHeader("content-type", "application/json");
      res.end('{"id":"msg_1","type":"message","model":"claude-opus-5-5"}');
    });
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => upstream.close());

  const { port, close } = await startProxy({
    upstreamURL: `http://127.0.0.1:${upstream.address().port}`,
    route: async ({ models }) => {
      assert.deepEqual(models.map((model) => model.id), [
        "claude-opus-5-5",
        "claude-sonnet-5-5",
      ]);
      return { choice: "claude-opus-5-5", confidence: 0.91, ms: 1 };
    },
  });
  t.after(close);

  await fetch(`http://127.0.0.1:${port}/v1/models`).then((response) => response.json());
  await fetch(`http://127.0.0.1:${port}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "jev-router",
      tools: [{ name: "Bash" }],
      messages: [{ role: "user", content: "debug this race" }],
    }),
  });

  assert.equal(seen[0].model, "claude-opus-5-5");
});

test("a catalog with two haiku versions offers only 5.5, which keeps thinking/effort", async (t) => {
  const seen = [];
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url.startsWith("/v1/models")) {
        return res.end(JSON.stringify({
          data: [
            { id: "claude-haiku-5-5", display_name: "Claude Haiku 5" },
            { id: "claude-haiku-4-5-20251001", display_name: "Claude Haiku 4.5" },
          ],
        }));
      }
      seen.push(JSON.parse(Buffer.concat(chunks)));
      res.end('{"id":"msg_1","type":"message","model":"claude-haiku-5-5"}');
    });
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => upstream.close());

  const { port, close } = await startProxy({
    upstreamURL: `http://127.0.0.1:${upstream.address().port}`,
    route: async ({ models }) => {
      assert.deepEqual(models.map((model) => model.id), ["claude-haiku-5-5"]);
      return { choice: "claude-haiku-5-5", confidence: 0.95, ms: 1 };
    },
  });
  t.after(close);

  await fetch(`http://127.0.0.1:${port}/v1/models`).then((response) => response.json());
  const send = (text) => fetch(`http://127.0.0.1:${port}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "jev-router",
      tools: [{ name: "Bash" }],
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      messages: [{ role: "user", content: text }],
    }),
  });

  // Legacy haiku stripping is covered by the applyTier unit test; the old version is
  // simply never offered while the catalog has a newer one.
  await send("haiku question");
  assert.equal(seen[0].model, "claude-haiku-5-5");
  assert.deepEqual(seen[0].thinking, { type: "adaptive" });
  assert.deepEqual(seen[0].output_config, { effort: "medium" });
});

test("a routed request without metadata is recorded under the conversation key", async (t) => {
  const upstream = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end('{"id":"msg_1","type":"message","model":"claude-sonnet-5-5"}');
    });
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => upstream.close());

  const { port, close } = await startProxy({
    upstreamURL: `http://127.0.0.1:${upstream.address().port}`,
    route: async () => ({ choice: "claude-sonnet-5-5", confidence: 0.77, ms: 1 }),
  });
  t.after(close);

  // Exactly what `claude -p` sends first: no metadata, so no session id.
  const body = {
    model: "jev-router",
    tools: [{ name: "Bash" }],
    messages: [{ role: "user", content: `rename this variable ${process.pid}` }],
  };
  await fetch(`http://127.0.0.1:${port}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  assert.equal(sessionOf(body), "", "the request carries no session id");
  const status = readStatus(conversationKey(body));
  assert.ok(status, "the decision is filed under the conversation key instead of being dropped");
  assert.equal(status.tier, "sonnet");
  assert.equal(status.confidence, 0.77);
});

const withTools = (messages) => ({ tools: [{ name: "Bash" }], messages });

test("converts a draft-04 boolean exclusiveMinimum into a draft 2020-12 number", () => {
  const schema = { type: "object", properties: { topN: { minimum: 0, exclusiveMinimum: true } } };
  sanitizeSchema(schema);
  assert.deepEqual(schema.properties.topN, { exclusiveMinimum: 0 });
});

test("drops a false exclusiveMaximum and keeps the bound", () => {
  const schema = { properties: { n: { maximum: 10, exclusiveMaximum: false } } };
  sanitizeSchema(schema);
  assert.deepEqual(schema.properties.n, { maximum: 10 });
});

test("leaves an already-valid numeric bound alone", () => {
  const schema = { properties: { n: { exclusiveMinimum: 5 } } };
  sanitizeSchema(schema);
  assert.equal(schema.properties.n.exclusiveMinimum, 5);
});

test("reaches schemas nested in arrays and sub-objects", () => {
  const schema = { anyOf: [{ items: { minimum: 1, exclusiveMinimum: true } }] };
  sanitizeSchema(schema);
  assert.deepEqual(schema.anyOf[0].items, { exclusiveMinimum: 1 });
});

test("survives null and primitive nodes", () => {
  assert.doesNotThrow(() => sanitizeSchema(null));
  assert.doesNotThrow(() => sanitizeSchema({ a: null, b: 3, c: "x" }));
});

test("reads a plain string prompt as a new turn", () => {
  assert.equal(newTurnPrompt(withTools([{ role: "user", content: "fix the bug" }])), "fix the bug");
});

test("reads a text block prompt as a new turn", () => {
  const body = withTools([{ role: "user", content: [{ type: "text", text: "fix the bug" }] }]);
  assert.equal(newTurnPrompt(body), "fix the bug");
});

test("ignores a tool_result continuation mid-turn", () => {
  const body = withTools([
    { role: "user", content: "fix the bug" },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "done" }] },
  ]);
  assert.equal(newTurnPrompt(body), null);
});

test("a trailing system message from a SessionStart hook does not hide the user turn", () => {
  const hook = { role: "system", content: [{ type: "text", text: "SessionStart:startup hook success" }] };
  const body = withTools([{ role: "user", content: [{ type: "text", text: "fix the bug" }] }, hook]);
  assert.equal(newTurnPrompt(body), "fix the bug");
  const cont = withTools([
    { role: "user", content: "fix the bug" },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "done" }] },
    hook,
  ]);
  assert.equal(newTurnPrompt(cont), null, "a tool-result continuation is still not a fresh turn");
});

test("ignores auxiliary calls that carry no tools", () => {
  const body = { messages: [{ role: "user", content: "summarise this" }] };
  assert.equal(newTurnPrompt(body), null);
});

test("ignores a request whose last message is from the assistant", () => {
  const body = withTools([{ role: "assistant", content: "thinking" }]);
  assert.equal(newTurnPrompt(body), null);
});

test("ignores an empty prompt", () => {
  assert.equal(newTurnPrompt(withTools([{ role: "user", content: "   " }])), null);
});

test("survives a malformed body", () => {
  assert.equal(newTurnPrompt(undefined), null);
  assert.equal(newTurnPrompt({}), null);
  assert.equal(newTurnPrompt({ tools: [], messages: [] }), null);
});

test("strips system reminders Claude Code injects into the prompt", () => {
  const body = withTools([
    {
      role: "user",
      content: "fix the bug\n<system-reminder>be careful\nabout things</system-reminder>",
    },
  ]);
  assert.equal(newTurnPrompt(body), "fix the bug");
});

test("a prompt that is only a system reminder is not a turn", () => {
  const body = withTools([{ role: "user", content: "<system-reminder>noise</system-reminder>" }]);
  assert.equal(newTurnPrompt(body), null);
});

test("routing to haiku keeps thinking and effort, which Haiku 5.5 accepts", () => {
  const body = {
    model: "claude-sonnet-4-6",
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    context_management: { edits: [{ type: "clear_thinking_20251015", keep: "all" }] },
  };
  applyTier(body, "haiku");
  assert.equal(body.model, "claude-haiku-5-5");
  assert.deepEqual(body.thinking, { type: "adaptive" });
  assert.deepEqual(body.output_config, { effort: "medium" });
  assert.deepEqual(body.context_management, { edits: [{ type: "clear_thinking_20251015", keep: "all" }] });
});

const adaptiveBody = () => ({
  model: "claude-sonnet-4-6",
  thinking: { type: "adaptive" },
  output_config: { effort: "medium" },
  context_management: { edits: [{ type: "clear_thinking_20251015", keep: "all" }] },
});

test("routing to legacy haiku 4.5 strips thinking and effort", () => {
  const body = adaptiveBody();
  applyTier(body, "haiku", "claude-haiku-4-5-20251001");
  assert.equal(body.model, "claude-haiku-4-5-20251001");
  assert.equal(body.thinking, undefined);
  assert.equal(body.output_config, undefined);
  assert.equal(body.context_management, undefined);
});

test("a dated haiku 5.5 snapshot keeps thinking and effort", () => {
  const body = adaptiveBody();
  applyTier(body, "haiku", "claude-haiku-5-5-20260101");
  assert.deepEqual(body.thinking, { type: "adaptive" });
  assert.deepEqual(body.output_config, { effort: "medium" });
});

test("an older opus version keeps thinking and effort", () => {
  const body = adaptiveBody();
  applyTier(body, "opus", "claude-opus-4-8");
  assert.equal(body.model, "claude-opus-4-8");
  assert.deepEqual(body.thinking, { type: "adaptive" });
  assert.deepEqual(body.output_config, { effort: "medium" });
});

test("routing to opus leaves thinking and effort intact", () => {
  const body = {
    model: "claude-sonnet-4-6",
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
  };
  applyTier(body, "opus");
  assert.equal(body.model, "claude-opus-5-5");
  assert.deepEqual(body.thinking, { type: "adaptive" });
  assert.deepEqual(body.output_config, { effort: "medium" });
});

test("an unknown tier leaves the request untouched", () => {
  const body = { model: "claude-sonnet-4-6", thinking: { type: "adaptive" } };
  applyTier(body, "nonsense");
  assert.equal(body.model, "claude-sonnet-4-6");
});

test("a conversation keeps one key as it grows, and differs from a sub-agent", () => {
  const main = { messages: [{ role: "user", content: "main task" }] };
  const grown = {
    messages: [{ role: "user", content: "main task" }, { role: "assistant", content: "ok" }],
  };
  const sub = { messages: [{ role: "user", content: "sub-agent task" }] };
  assert.equal(conversationKey(main), conversationKey(grown));
  assert.notEqual(conversationKey(main), conversationKey(sub));
});

test("the key ignores the cache_control breakpoint Claude Code moves between requests", () => {
  const first = {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "<system-reminder>x</system-reminder>" },
          { type: "text", text: "do the thing", cache_control: { type: "ephemeral", ttl: "1h" } },
        ],
      },
    ],
  };
  const later = {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "<system-reminder>x</system-reminder>" },
          { type: "text", text: "do the thing" },
        ],
      },
      { role: "assistant", content: "working" },
    ],
  };
  assert.equal(conversationKey(first), conversationKey(later));
});

test("the same opening text in two sessions gets two keys", () => {
  const mk = (id) => ({
    metadata: { user_id: JSON.stringify({ session_id: id }) },
    messages: [{ role: "user", content: "same opening" }],
  });
  assert.notEqual(conversationKey(mk("a")), conversationKey(mk("b")));
});

test("the key survives metadata that is not JSON", () => {
  const body = { metadata: { user_id: "not-json" }, messages: [{ role: "user", content: "hi" }] };
  assert.doesNotThrow(() => conversationKey(body));
});

test("the catalogue is fetched once when Claude Code never asks for it", async (t) => {
  // Arrange
  const calls = [];
  const upstream = http.createServer((req, res) => {
    calls.push(req.url);
    req.on("data", () => {});
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url?.startsWith("/v1/models")) {
        return res.end(JSON.stringify({ data: [{ id: "claude-opus-9", display_name: "Opus 9" }] }));
      }
      res.end('{"id":"msg_1","type":"message","model":"claude-opus-9"}');
    });
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => upstream.close());

  const seen = [];
  const { port, close } = await startProxy({
    upstreamURL: `http://127.0.0.1:${upstream.address().port}`,
    route: async ({ models }) => {
      seen.push(models.map((model) => model.id));
      return null;
    },
  });
  t.after(close);

  // Act
  for (const turn of ["first turn", "second turn"]) {
    await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer t" },
      body: JSON.stringify({ model: "jev-router", tools: [{ name: "Bash" }], messages: [{ role: "user", content: turn }] }),
    });
  }

  // Assert
  assert.deepEqual(seen, [["claude-opus-9"], ["claude-opus-9"]], "catalogue ids route both turns");
  assert.equal(calls.filter((url) => url?.startsWith("/v1/models")).length, 1, "fetched once");
});

test("isClaudeAuxiliaryPrompt matches Claude Code's side requests only at the start", () => {
  assert.equal(isClaudeAuxiliaryPrompt("[SUGGESTION MODE: Suggest what the user might naturally type next.]"), true);
  assert.equal(isClaudeAuxiliaryPrompt("  \n[SUGGESTION MODE: x]"), true);
  assert.equal(isClaudeAuxiliaryPrompt("The user stepped away and is coming back. Recap in under 40 words, "), true);
  assert.equal(isClaudeAuxiliaryPrompt("fix the bug [SUGGESTION MODE: x]"), false);
  assert.equal(isClaudeAuxiliaryPrompt("please note: The user stepped away and is coming back. Recap"), false);
  assert.equal(isClaudeAuxiliaryPrompt("fix the bug"), false);
  assert.equal(isClaudeAuxiliaryPrompt(""), false);
  assert.equal(isClaudeAuxiliaryPrompt(null), false);
  for (const yes of [
    "[PLAN MODE: x]",
    "[SUGGESTION MODE: x]",
    "The user stepped away and is coming back. Recap",
    "The user stepped away, recap",
  ]) assert.equal(isClaudeAuxiliaryPrompt(yes), true, yes);
  for (const no of ["[plan mode] x", "[WIP] fix", "fix [SUGGESTION MODE:", "plain text"]) {
    assert.equal(isClaudeAuxiliaryPrompt(no), false, no);
  }
  assert.equal(isClaudeAuxiliaryPrompt(undefined), false);
});

for (const aux of [
  "[SUGGESTION MODE: Suggest what the user might naturally type next into Claude Code.] ...",
  "The user stepped away and is coming back. Recap in under 40 words, ...",
]) {
  test(`an auxiliary request (${aux.slice(0, 20)}) keeps the model and status of the conversation`, async (t) => {
    const seen = [];
    const upstream = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        if (req.url.startsWith("/v1/models")) {
          res.setHeader("content-type", "application/json");
          return res.end(JSON.stringify({
            data: [
              { id: "claude-opus-5-5", display_name: "Claude Opus 5" },
              { id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5" },
              { id: "claude-sonnet-5-6", display_name: "Claude Sonnet 5.6" },
            ],
          }));
        }
        seen.push(JSON.parse(Buffer.concat(chunks)));
        res.setHeader("content-type", "application/json");
        res.end('{"id":"msg_1","type":"message","model":"claude-sonnet-5-6"}');
      });
    });
    await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    t.after(() => upstream.close());

    let routed = 0;
    const { port, close } = await startProxy({
      upstreamURL: `http://127.0.0.1:${upstream.address().port}`,
      route: async () => {
        routed++;
        // An exact id that is not idOf("sonnet"), so a fallback to the tier id would be visible.
        return { choice: routed === 1 ? "claude-sonnet-5-6" : "claude-opus-5-5", confidence: 0.9, ms: 1 };
      },
    });
    t.after(close);

    const first = `rename this variable ${aux.length} ${process.pid}`;
    const send = (messages) =>
      fetch(`http://127.0.0.1:${port}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "jev-router", tools: [{ name: "Bash" }], messages }),
      });
    await send([{ role: "user", content: first }]);
    const key = conversationKey({ messages: [{ role: "user", content: first }] });
    const before = readStatus(key);
    assert.equal(routed, 1);
    assert.ok(before);

    await send([
      { role: "user", content: first },
      { role: "assistant", content: "done" },
      { role: "user", content: [{ type: "text", text: aux }] },
    ]);

    assert.equal(routed, 1, "an auxiliary request is not routed");
    assert.deepEqual(readStatus(key), before, "the status file is untouched");
    assert.equal(seen.length, 2);
    assert.notEqual(seen[0].model, idOf("sonnet"));
    assert.equal(seen[0].model, "claude-sonnet-5-6", "the routed turn used Jev's exact model id");
    assert.equal(seen[1].model, seen[0].model, "upstream gets the model of the previous turn");
  });
}

// Harness for auxiliary-request edge cases: counts route calls and records what reaches upstream.
async function auxHarness(t) {
  const seen = [];
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url.startsWith("/v1/models")) {
        return res.end(JSON.stringify({
          data: [
            { id: "claude-opus-5-5", display_name: "Claude Opus 5" },
            { id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5" },
          ],
        }));
      }
      seen.push(JSON.parse(Buffer.concat(chunks)));
      res.end('{"id":"msg_1","type":"message"}');
    });
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => upstream.close());
  const prompts = [];
  const { port, close } = await startProxy({
    upstreamURL: `http://127.0.0.1:${upstream.address().port}`,
    route: async ({ prompt }) => {
      prompts.push(prompt);
      return { choice: "claude-sonnet-5-5", confidence: 0.9, ms: 1 };
    },
  });
  t.after(close);
  const send = (messages) =>
    fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "jev-router", tools: [{ name: "Bash" }], messages }),
    });
  return { seen, prompts, send };
}

test("an auxiliary request as the first request still gets a real model and writes no status", async (t) => {
  const { seen, prompts, send } = await auxHarness(t);
  const text = `[SUGGESTION MODE: first-request ${process.pid}]`;
  const messages = [{ role: "user", content: text }];
  await send(messages);
  assert.equal(prompts.length, 0, "route is not called");
  assert.equal(seen.length, 1);
  assert.notEqual(seen[0].model, "jev-router", "the sentinel is rewritten");
  assert.ok(String(seen[0].model).startsWith("claude-"), "a real model goes upstream");
  assert.equal(readStatus(conversationKey({ messages })), null, "no status is written");
});

test("auxiliary text in a text block behind a system-reminder block is still recognised", async (t) => {
  const { seen, prompts, send } = await auxHarness(t);
  const text = `The user stepped away and is coming back. blocks ${process.pid}`;
  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: "<system-reminder>\nSome injected context\n</system-reminder>" },
        { type: "text", text },
      ],
    },
  ];
  await send(messages);
  assert.equal(prompts.length, 0, "route is not called");
  assert.notEqual(seen[0].model, "jev-router");
  assert.equal(readStatus(conversationKey({ messages })), null);
});

test("a normal turn after an auxiliary one still routes and records the real prompt", async (t) => {
  const { seen, prompts, send } = await auxHarness(t);
  const first = `add a unit test ${process.pid}`;
  const aux = "[SUGGESTION MODE: after-first]";
  const next = "now update the readme";
  const key = conversationKey({ messages: [{ role: "user", content: first }] });
  await send([{ role: "user", content: first }]);
  await send([
    { role: "user", content: first },
    { role: "assistant", content: "done" },
    { role: "user", content: aux },
  ]);
  assert.equal(prompts.length, 1);
  await send([
    { role: "user", content: first },
    { role: "assistant", content: "done" },
    { role: "user", content: next },
  ]);
  assert.deepEqual(prompts, [first, next], "the later real turn is routed");
  assert.equal(readStatus(key).prompt, next);
  assert.equal(seen.length, 3);
});

test("the status prompt stays the real user's prompt after an auxiliary request", async (t) => {
  const { prompts, send } = await auxHarness(t);
  const first = `explain the build ${process.pid}`;
  const key = conversationKey({ messages: [{ role: "user", content: first }] });
  await send([{ role: "user", content: first }]);
  await send([
    { role: "user", content: first },
    { role: "assistant", content: "ok" },
    { role: "user", content: "[SUGGESTION MODE: later]" },
  ]);
  await send([
    { role: "user", content: first },
    { role: "assistant", content: "ok" },
    { role: "user", content: "<jev-explain>" },
  ]);
  assert.equal(prompts.length, 1);
  assert.equal(readStatus(key).prompt, first, "/jev-explain reads the real prompt");
  assert.equal(readStatus(key).history.length, 1, "no auxiliary entry in the history");
});

test("a rejected Jev key is filed as jev-auth-failed and explained", async (t) => {
  const upstream = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url.startsWith("/v1/models")) return res.end('{"data":[{"id":"claude-sonnet-5-5"}]}');
      res.end('{"id":"msg_1","type":"message"}');
    });
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => upstream.close());

  const { port, close } = await startProxy({
    upstreamURL: `http://127.0.0.1:${upstream.address().port}`,
    route: async () => null,
    authFailure: () => ({ status: 401 }),
  });
  t.after(close);

  const body = {
    model: "jev-router",
    tools: [{ name: "Bash" }],
    messages: [{ role: "user", content: `rename this variable auth ${process.pid}` }],
  };
  await fetch(`http://127.0.0.1:${port}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const status = readStatus(conversationKey(body));
  assert.match(status.reason, /^jev-auth-failed/);
  assert.match(formatExplanation(status), /Decision: Jev key rejected; held/);
});

test("a failed Jev call with no auth failure reported (e.g. a 403) is filed as jev-unavailable", async (t) => {
  const upstream = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url.startsWith("/v1/models")) return res.end('{"data":[{"id":"claude-sonnet-5-5"}]}');
      res.end('{"id":"msg_1","type":"message"}');
    });
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => upstream.close());

  // A 403 is never latched, so the router reports no auth failure.
  const { port, close } = await startProxy({
    upstreamURL: `http://127.0.0.1:${upstream.address().port}`,
    route: async () => null,
    authFailure: () => null,
  });
  t.after(close);

  const body = {
    model: "jev-router",
    tools: [{ name: "Bash" }],
    messages: [{ role: "user", content: `rename this variable forbidden ${process.pid}` }],
  };
  await fetch(`http://127.0.0.1:${port}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const status = readStatus(conversationKey(body));
  assert.match(status.reason, /^jev-unavailable/);
  assert.doesNotMatch(status.reason, /jev-auth-failed/);
  assert.match(formatExplanation(status), /Decision: Jev unavailable; held/);
});
