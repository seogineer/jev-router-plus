import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ROUTING_KEYS, childEnv, routingKeysPresent } from "../src/child-env.mjs";
import { installCodexSkill, renderCodexSkill } from "../src/codex-cli.mjs";
import { formatExplanation } from "../src/explain.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const JEV = join(ROOT, "bin", "jev.mjs");
const KEYS = ["JEV_API_KEY", "TYPESAFE_API_KEY", "OPENROUTER_API_KEY"];

// Fake CLI that records its full environment (names and values) and argv; it sends no requests.
const fake = (name) =>
  `#!${process.execPath}\n` +
  `require("node:fs").writeFileSync(process.env.FAKE_OUT, JSON.stringify({ name: ${JSON.stringify(name)}, argv: process.argv.slice(2), env: process.env }));\n`;

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "jev-cenv-"));
  const [bin, home, tmp, cwd] = ["bin", "home", "tmp", "cwd"].map((d) => {
    mkdirSync(join(dir, d));
    return join(dir, d);
  });
  for (const name of ["claude", "codex"]) {
    writeFileSync(join(bin, name), fake(name));
    chmodSync(join(bin, name), 0o755);
  }
  const out = join(dir, "out.json");
  const base = { PATH: `${bin}:${dirname(process.execPath)}`, HOME: home, USERPROFILE: home, TMPDIR: tmp, FAKE_OUT: out };
  const run = (args, extra = {}) => {
    const r = spawnSync(process.execPath, [JEV, ...args], { cwd, env: { ...base, ...extra }, encoding: "utf8", timeout: 20000 });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(readFileSync(out, "utf8"));
  };
  return { dir, home, cwd, run, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const LAUNCHES = { claude: ["-p", "hi"], codex: ["codex", "exec", "hi"] };
const FILES = {
  "~/.jev-router.env": (sb) => join(sb.home, ".jev-router.env"),
  "cwd/.env": (sb) => join(sb.cwd, ".env"),
  "~/.jev-claude.env (legacy)": (sb) => join(sb.home, ".jev-claude.env"),
};

for (const [launcher, args] of Object.entries(LAUNCHES)) {
  for (const [label, path] of Object.entries(FILES)) {
    for (const key of KEYS) {
      test(`${launcher}: ${key} only in ${label} is dropped from the child, FOO kept`, () => {
        const sb = sandbox();
        try {
          writeFileSync(path(sb), `${key}=fake-secret\nFOO=bar\n`);
          const { env } = sb.run(args);
          for (const k of KEYS) assert.ok(!(k in env), `${k} leaked`);
          assert.equal(env.FOO, "bar");
        } finally {
          sb.cleanup();
        }
      });
    }
  }

  test(`${launcher}: routing starts from a file-only key (proxy still reads it)`, () => {
    const sb = sandbox();
    try {
      writeFileSync(join(sb.home, ".jev-router.env"), "JEV_API_KEY=fake-secret\n");
      const { env, argv } = sb.run(args);
      assert.ok(!("JEV_API_KEY" in env));
      if (launcher === "claude") assert.match(env.ANTHROPIC_BASE_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
      else assert.ok(argv.some((a) => /^model_providers\.jev\.base_url="http:\/\/127\.0\.0\.1:\d+"$/.test(a)), JSON.stringify(argv));
    } finally {
      sb.cleanup();
    }
  });

  for (const key of KEYS) {
    test(`${launcher}: exported ${key} wins over the file value and stays`, () => {
      const sb = sandbox();
      try {
        writeFileSync(join(sb.home, ".jev-router.env"), `${key}=from-file\n`);
        const { env } = sb.run(args, { [key]: "from-shell" });
        assert.equal(env[key], "from-shell");
      } finally {
        sb.cleanup();
      }
    });
  }

  test(`${launcher}: empty-string exported key is kept; empty file-only key is dropped`, () => {
    const sb = sandbox();
    try {
      writeFileSync(join(sb.home, ".jev-router.env"), "JEV_API_KEY=file-key\nOPENROUTER_API_KEY=\n");
      const { env } = sb.run(args, { JEV_API_KEY: "" });
      assert.equal(env.JEV_API_KEY, "");
      assert.ok(!("OPENROUTER_API_KEY" in env));
    } finally {
      sb.cleanup();
    }
  });

  test(`${launcher}: non-routing JEV_* variables from a file reach the child`, () => {
    const sb = sandbox();
    try {
      writeFileSync(join(sb.home, ".jev-router.env"), "JEV_PROVIDER=typesafe\nJEV_DEBUG=1\nJEV_API_KEY=fake\n");
      const { env } = sb.run(args);
      assert.equal(env.JEV_PROVIDER, "typesafe");
      assert.ok(!("JEV_API_KEY" in env));
    } finally {
      sb.cleanup();
    }
  });
}

test("childEnv: pure function drops only newly appeared keys and never mutates input", () => {
  const before = routingKeysPresent({ JEV_API_KEY: "a", PATH: "/x" });
  assert.deepEqual(before, ["JEV_API_KEY"]);
  const after = { PATH: "/x", JEV_API_KEY: "a", TYPESAFE_API_KEY: "b", OPENROUTER_API_KEY: "", FOO: "1" };
  const snapshot = structuredClone(after);
  const out = childEnv(before, after);
  assert.deepEqual(after, snapshot);
  assert.deepEqual(out, { PATH: "/x", JEV_API_KEY: "a", FOO: "1" });
  assert.notEqual(out, after);
  assert.deepEqual(childEnv([], { A: "1" }), { A: "1" });
  assert.deepEqual(childEnv(ROUTING_KEYS, after), after);
});

test("routingKeysPresent counts an empty string as present", () => {
  assert.deepEqual(routingKeysPresent({ TYPESAFE_API_KEY: "" }), ["TYPESAFE_API_KEY"]);
});

test("installCodexSkill output: command runs under bash even for hostile install paths", () => {
  const home = mkdtempSync(join(tmpdir(), "jev-skill-"));
  try {
    const target = installCodexSkill(home);
    const text = readFileSync(target, "utf8");
    assert.ok(!text.includes("{{"));
    assert.equal(statSync(target).mode & 0o777, 0o600);
    const cmd = /`(node "[^`]*(?:\\`[^`]*)*)`/.exec(text)?.[1] ?? /`(node "[^\n]+")`/.exec(text)[1];
    const r = spawnSync("bash", ["-c", `${cmd} no-such-session`], { encoding: "utf8", timeout: 20000 });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /no routing decision/);
    // Stale content (old template) is overwritten; identical content keeps mtime.
    writeFileSync(target, "Run `jev explain`\n");
    installCodexSkill(home);
    assert.equal(readFileSync(target, "utf8"), text);
    assert.equal(statSync(target).mode & 0o777, 0o600);
    const old = new Date(2020, 0, 1);
    utimesSync(target, old, old);
    installCodexSkill(home);
    assert.equal(statSync(target).mtimeMs, old.getTime());
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("explain box: every line has one width; normal ids are intact, long ids end with an ellipsis", () => {
  const ids = ["claude-haiku-5-5", "claude-sonnet-4-5-20250929", "Claude-Opus-5-5", "mystery-model", "x".repeat(200)];
  for (const id of ids) {
    const out = formatExplanation({
      prompt: "p", tier: "sonnet", model: id, confidence: 0.5,
      jev: { request: { state: { session: { current_model: id, context_tokens: 1 } } } },
    });
    const widths = new Set(out.split("\n").map((l) => [...l].length));
    assert.equal(widths.size, 1, `${id}: ${[...widths]}`);
    if (id.length <= 28) assert.ok(out.includes(`Selected model: ${id} `), id);
    else assert.match(out, /Selected model: x+…/);
  }
});

test("renderCodexSkill command survives bash for paths with spaces, quotes, $ and backticks", () => {
  const base = mkdtempSync(join(tmpdir(), "jev-hostile-"));
  try {
    const dir = join(base, 'a b', "q'\"x", "$HOME`echo pwned`", "bin");
    mkdirSync(dir, { recursive: true });
    const script = join(dir, "explain.mjs");
    writeFileSync(script, 'process.stdout.write("RAN:" + process.argv[2]);\n');
    const text = renderCodexSkill("Run `{{EXPLAIN_COMMAND}}` once", script);
    const cmd = text.slice("Run `".length, text.indexOf("` once"));
    const r = spawnSync("bash", ["-c", `${cmd} sid`], { encoding: "utf8", timeout: 20000 });
    assert.equal(r.stdout, "RAN:sid", r.stderr);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
