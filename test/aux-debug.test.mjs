import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startProxy, conversationKey, isClaudeAuxiliaryPrompt } from "../src/proxy.mjs";
import { readStatus } from "../src/status.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PROXY_URL = pathToFileURL(join(ROOT, "src", "proxy.mjs")).href;

async function harness(t) {
  const seen = [];
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url.startsWith("/v1/models")) {
        return res.end(JSON.stringify({ data: [{ id: "claude-opus-5-5" }, { id: "claude-sonnet-5-5" }] }));
      }
      seen.push(JSON.parse(Buffer.concat(chunks)));
      res.end('{"id":"msg_1","type":"message"}');
    });
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
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

// Matches only the generic MODE pattern, not the two legacy literals.
for (const aux of ["[PLAN MODE: Summarise the plan.]", "[AUTO-EDIT MODE: x]", "[REVIEW MODE: y]"]) {
  test(`an auxiliary request matching only the generic pattern (${aux.slice(0, 16)}) skips routing end to end`, async (t) => {
    const { seen, prompts, send } = await harness(t);
    const first = `refactor the parser ${aux.length} ${process.pid}`;
    const key = conversationKey({ messages: [{ role: "user", content: first }] });
    await send([{ role: "user", content: first }]);
    const before = readStatus(key);
    assert.equal(prompts.length, 1);
    await send([
      { role: "user", content: first },
      { role: "assistant", content: "done" },
      { role: "user", content: [{ type: "text", text: aux }] },
    ]);
    assert.equal(prompts.length, 1, "not routed");
    assert.deepEqual(readStatus(key), before, "status untouched");
    assert.equal(seen.length, 2);
    assert.equal(seen[1].model, seen[0].model, "keeps the previous turn's model");
    assert.notEqual(seen[1].model, "jev-router");
  });
}

test("a bracketed human prompt that is not a MODE banner is still routed", async (t) => {
  const { prompts, send } = await harness(t);
  const first = `start ${process.pid}`;
  await send([{ role: "user", content: first }]);
  await send([
    { role: "user", content: first },
    { role: "assistant", content: "ok" },
    { role: "user", content: "[WIP] continue the work" },
  ]);
  assert.equal(prompts.length, 2);
});

// Human prompts that merely look like a MODE banner (no colon) must still be routed.
for (const human of ["[DARK MODE] toggle is broken", "[STRICT MODE] fix lint", "[DEBUG MODE] why"]) {
  test(`${human.slice(0, 14)} is not auxiliary and is routed end to end`, async (t) => {
    assert.equal(isClaudeAuxiliaryPrompt(human), false);
    const { prompts, send } = await harness(t);
    const first = `start ${human.length} ${process.pid}`;
    await send([{ role: "user", content: first }]);
    await send([
      { role: "user", content: first },
      { role: "assistant", content: "ok" },
      { role: "user", content: human },
    ]);
    assert.equal(prompts.length, 2);
  });
}

// Runs a proxy in a child with a sandboxed HOME/TMPDIR and piped stdio (so the debug line goes to
// stderr rather than the real ~/.jev-claude.log), sends an auxiliary request, returns stderr.
function runChild(prompt, extraEnv) {
  const dir = mkdtempSync(join(tmpdir(), "jev-dbg-"));
  const script = `
    import http from "node:http";
    const { startProxy } = await import(${JSON.stringify(PROXY_URL)});
    const up = http.createServer((req, res) => {
      req.on("data", () => {});
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        res.end(req.url.startsWith("/v1/models") ? '{"data":[{"id":"claude-sonnet-5-5"}]}' : '{"id":"m","type":"message"}');
      });
    });
    await new Promise((r) => up.listen(0, "127.0.0.1", r));
    const { port, close } = await startProxy({
      upstreamURL: "http://127.0.0.1:" + up.address().port,
      route: async () => ({ choice: "claude-sonnet-5-5", confidence: 0.9, ms: 1 }),
    });
    await fetch("http://127.0.0.1:" + port + "/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "jev-router", tools: [{ name: "Bash" }], messages: [{ role: "user", content: process.env.AUX }] }),
    }).then((r) => r.text());
    await close();
    up.close();
    process.exit(0);
  `;
  try {
    return spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { PATH: dirname(process.execPath), HOME: dir, USERPROFILE: dir, TMPDIR: dir, AUX: prompt, ...extraEnv },
      encoding: "utf8",
      timeout: 20000,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("JEV_DEBUG skip log is truncated to 40 chars of the trimmed prompt and omits the rest", () => {
  const body = "[PLAN MODE: " + "a".repeat(60) + " SECRET_TAIL_MARKER";
  const r = runChild(`  \n${body}`, { JEV_DEBUG: "1" });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stderr.split("\n").filter((l) => l.includes("skip auxiliary:"));
  assert.equal(lines.length, 1, r.stderr);
  assert.equal(lines[0], `[jev] skip auxiliary: ${body.slice(0, 40)}`);
  assert.doesNotMatch(r.stderr, /SECRET_TAIL_MARKER/);
  assert.doesNotMatch(r.stderr, new RegExp("a{50}"));
});

test("without JEV_DEBUG the skip is silent", () => {
  const r = runChild("[PLAN MODE: x]", {});
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /skip auxiliary/);
});
