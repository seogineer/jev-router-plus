import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { askJev, jevAuthFailure, resetJevAuthFailure } from "../src/router.mjs";

const models = [{ id: "claude-sonnet-5-5", tier: "sonnet" }];
const ask = () => askJev({ prompt: "fix the bug", current: "claude-sonnet-5-5", contextTokens: 10, models });

// Fake OpenRouter endpoint: `handler(count, res)` answers the Nth request.
async function withServer(t, handler, provider = "openrouter") {
  let count = 0;
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => handler(++count, res));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const saved = { ...process.env };
  const base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(
    process.env,
    provider === "typesafe"
      ? { JEV_PROVIDER: "typesafe", JEV_API_KEY: "sk-ts-secret-test-value", TYPESAFE_BASE_URL: base }
      : { JEV_PROVIDER: "openrouter", OPENROUTER_API_KEY: "sk-or-secret-test-value", JEV_OPENROUTER_URL: `${base}/decisions` },
  );
  resetJevAuthFailure();
  // Capture the router's log lines, which go to stderr when stdout is not a TTY.
  const lines = [];
  const write = process.stderr.write;
  process.stderr.write = (chunk) => (lines.push(String(chunk)), true);
  t.after(() => {
    process.stderr.write = write;
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    resetJevAuthFailure();
    server.closeAllConnections?.();
    server.close();
  });
  return { server, count: () => count, lines };
}

const reject = (status) => (_n, res) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end('{"error":"User not found"}');
};

for (const status of [401, 403]) {
  test(`HTTP ${status} latches: later calls skip the client and the failure is logged once`, async (t) => {
    const server = await withServer(t, reject(status));
    assert.equal(jevAuthFailure(), null);

    assert.equal(await ask(), null);
    assert.deepEqual(jevAuthFailure(), { status });
    const afterFirst = server.count();
    assert.equal(afterFirst, 1, "a rejected key is not retried");

    assert.equal(await ask(), null);
    assert.equal(await ask(), null);
    assert.equal(server.count(), afterFirst, "no further network calls");
    const rejected = server.lines.filter((line) => line.includes("rejected the API key"));
    assert.equal(rejected.length, 1);
    assert.match(rejected[0], new RegExp(`HTTP ${status}`));
    assert.equal(server.lines.join("").includes("sk-or-secret-test-value"), false, "the key is never logged");
  });
}

test("a 500 is not latched and is retried on the next prompt", async (t) => {
  const server = await withServer(t, (_n, res) => {
    res.writeHead(500, { "content-type": "application/json" });
    res.end("{}");
  });
  assert.equal(await ask(), null);
  assert.equal(jevAuthFailure(), null);
  const afterFirst = server.count();
  assert.equal(await ask(), null);
  assert.ok(server.count() > afterFirst, "the client is called again");
  assert.equal(server.lines.some((line) => line.includes("routing failed")), true);
});

test("a dropped connection is not latched", async (t) => {
  const server = await withServer(t, (_n, res) => res.socket.destroy());
  assert.equal(await ask(), null);
  assert.equal(jevAuthFailure(), null);
  const afterFirst = server.count();
  assert.equal(await ask(), null);
  assert.ok(server.count() > afterFirst);
});

test("a missing key is a plain failure, not an auth failure", async (t) => {
  await withServer(t, reject(401));
  for (const key of ["JEV_PROVIDER", "OPENROUTER_API_KEY", "JEV_API_KEY", "TYPESAFE_API_KEY"]) delete process.env[key];
  resetJevAuthFailure();
  assert.equal(await ask(), null);
  assert.equal(jevAuthFailure(), null);
});

// The TypeSafe path builds the real SDK client; the SDK reads TYPESAFE_BASE_URL, which is
// the seam used here to point it at a local server (no stub of src/router.mjs is needed).
for (const status of [401, 403]) {
  test(`TypeSafe SDK HTTP ${status} (APIError.status) latches once and is not retried`, async (t) => {
    const server = await withServer(t, reject(status), "typesafe");
    assert.equal(await ask(), null);
    assert.deepEqual(jevAuthFailure(), { status });
    assert.equal(server.count(), 1, "a rejected key is not retried");
    assert.equal(await ask(), null);
    assert.equal(server.count(), 1, "no further network calls");
    assert.equal(server.lines.filter((line) => line.includes("rejected the API key")).length, 1);
    assert.equal(server.lines.join("").includes("sk-ts-secret-test-value"), false, "the key is never logged");
  });
}

for (const provider of ["openrouter", "typesafe"]) {
  test(`${provider}: a 429 is not latched`, async (t) => {
    const server = await withServer(
      t,
      (_n, res) => {
        res.writeHead(429, { "content-type": "application/json" });
        res.end("{}");
      },
      provider,
    );
    assert.equal(await ask(), null);
    assert.equal(jevAuthFailure(), null);
    const afterFirst = server.count();
    assert.equal(await ask(), null);
    assert.ok(server.count() > afterFirst, "the client is called again");
    assert.equal(server.lines.some((line) => line.includes("rejected the API key")), false);
  });
}

test("an outer deadline abort is not an auth failure", async (t) => {
  // The server never answers, so the 3s outer deadline aborts the request.
  const server = await withServer(t, () => {});
  assert.equal(await ask(), null);
  assert.equal(jevAuthFailure(), null);
  assert.equal(server.lines.some((line) => line.includes("rejected the API key")), false);
  assert.equal(server.lines.some((line) => line.includes("routing failed")), true);
});

test("after a reset, a non-auth failure behaves as before and the client is rebuilt", async (t) => {
  let mode = 401;
  const server = await withServer(t, (_n, res) => {
    res.writeHead(mode, { "content-type": "application/json" });
    res.end("{}");
  });
  assert.equal(await ask(), null);
  assert.deepEqual(jevAuthFailure(), { status: 401 });
  const latched = server.count();
  resetJevAuthFailure();
  assert.equal(jevAuthFailure(), null);
  mode = 500;
  assert.equal(await ask(), null);
  assert.ok(server.count() > latched, "calls go out again after the reset");
  assert.equal(jevAuthFailure(), null);
  assert.equal(server.lines.some((line) => line.includes("routing failed")), true);
});

test("a latched 403 logs once and never reports a generic routing failure", async (t) => {
  const server = await withServer(t, reject(403));
  await ask();
  await ask();
  assert.deepEqual(jevAuthFailure(), { status: 403 });
  assert.equal(server.lines.filter((line) => line.includes("rejected the API key")).length, 1);
  assert.equal(server.lines.some((line) => line.includes("routing failed")), false);
});
