import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const JEV = join(ROOT, "bin", "jev.mjs");

// A fake CLI that records its argv as JSON to $FAKE_OUT and exits with $FAKE_EXIT (default 0).
const fakeCli = (name) =>
  `#!${process.execPath}\n` +
  `require("node:fs").writeFileSync(process.env.FAKE_OUT, JSON.stringify({ name: ${JSON.stringify(name)}, argv: process.argv.slice(2), env: Object.keys(process.env) }));\n` +
  `process.exit(Number(process.env.FAKE_EXIT ?? 0));\n`;

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "jev-cli-"));
  const bin = join(dir, "bin");
  const home = join(dir, "home");
  const tmp = join(dir, "tmp");
  const cwd = join(dir, "cwd");
  for (const d of [bin, home, tmp, cwd]) mkdirSync(d);
  for (const name of ["claude", "codex"]) {
    writeFileSync(join(bin, name), fakeCli(name));
    chmodSync(join(bin, name), 0o755);
  }
  const out = join(dir, "out.json");
  // Minimal env: no JEV_API_KEY / OPENROUTER_API_KEY, so routing stays off and no proxy starts.
  const env = { PATH: `${bin}:${dirname(process.execPath)}`, HOME: home, USERPROFILE: home, TMPDIR: tmp, FAKE_OUT: out };
  const run = (args, extra = {}) =>
    spawnSync(process.execPath, [JEV, ...args], { cwd, env: { ...env, ...extra }, encoding: "utf8", timeout: 20000 });
  const recorded = () => JSON.parse(readFileSync(out, "utf8"));
  return { dir, home, tmp, cwd, out, run, recorded, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const withSandbox = (fn) => async () => {
  const sb = sandbox();
  try {
    await fn(sb);
  } finally {
    sb.cleanup();
  }
};

test("jev -p hello delegates to claude with args intact", withSandbox(({ run, recorded }) => {
  const r = run(["-p", "hello"]);
  assert.equal(r.status, 0, r.stderr);
  const { name, argv } = recorded();
  assert.equal(name, "claude");
  const i = argv.indexOf("-p");
  assert.ok(i >= 0 && argv[i + 1] === "hello", JSON.stringify(argv));
  assert.match(r.stderr, /without routing/);
}));

test("jev claude -p hello drops the subcommand word", withSandbox(({ run, recorded }) => {
  const r = run(["claude", "-p", "hello"]);
  assert.equal(r.status, 0, r.stderr);
  const { name, argv } = recorded();
  assert.equal(name, "claude");
  assert.deepEqual(argv.slice(0, 2), ["-p", "hello"]);
  assert.ok(!argv.includes("claude"), JSON.stringify(argv));
}));

test("jev codex exec hi delegates to codex", withSandbox(({ run, recorded, home }) => {
  const r = run(["codex", "exec", "hi"]);
  assert.equal(r.status, 0, r.stderr);
  const { name, argv } = recorded();
  assert.equal(name, "codex");
  assert.deepEqual(argv, ["exec", "hi"]);
  // The explain skill is installed under the sandbox HOME only.
  assert.ok(existsSync(join(home, ".agents", "skills", "jev-router-explain", "SKILL.md")));
}));

test("jev explain on an unknown session exits 0", withSandbox(({ run, out }) => {
  const r = run(["explain", "no-such-session"]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(out), "explain must not launch claude or codex");
  assert.doesNotMatch(r.stderr, /Error|Cannot find/);
}));

test("delegate exit code propagates (claude and codex)", withSandbox(({ run }) => {
  assert.equal(run(["-p", "x"], { FAKE_EXIT: "3" }).status, 3);
  assert.equal(run(["codex", "exec", "x"], { FAKE_EXIT: "3" }).status, 3);
}));

test("missing claude/codex gives exit 1 and a hint", withSandbox(({ run, dir }) => {
  const empty = join(dir, "empty");
  mkdirSync(empty);
  // node is still needed by the child; resolve it by absolute path via spawnSync, PATH has none.
  const c = run(["-p", "x"], { PATH: empty });
  assert.equal(c.status, 1);
  assert.match(c.stderr, /not on your PATH/);
  const x = run(["codex"], { PATH: empty });
  assert.equal(x.status, 1);
  assert.match(x.stderr, /not on your PATH/);
}));

test("state stays inside the sandbox and no key reaches the delegate", withSandbox(({ run, recorded, home, tmp }) => {
  const r = run(["-p", "hello"]);
  assert.equal(r.status, 0, r.stderr);
  const { env } = recorded();
  assert.ok(!env.includes("JEV_API_KEY") && !env.includes("OPENROUTER_API_KEY"));
  assert.ok(!env.includes("ANTHROPIC_BASE_URL"), "no proxy should be configured without a key");
  // Nothing is written under HOME when routing is off (no settings, no log).
  assert.deepEqual(readdirSync(home), []);
  assert.ok(resolve(tmp).startsWith(tmpdir()));
}));

const KEYS = ["JEV_API_KEY", "TYPESAFE_API_KEY", "OPENROUTER_API_KEY"];
const keyFile = "JEV_API_KEY=fake-key-1\nTYPESAFE_API_KEY=fake-key-2\nOPENROUTER_API_KEY=fake-key-3\nOTHER_VAR=kept\n";

test("routing keys read from an env file stay out of the claude child environment", withSandbox(({ run, recorded, home }) => {
  writeFileSync(join(home, ".jev-router.env"), keyFile);
  const r = run(["-p", "hello"]);
  assert.equal(r.status, 0, r.stderr);
  const { env } = recorded();
  for (const key of KEYS) assert.ok(!env.includes(key), `${key} leaked`);
  assert.ok(env.includes("ANTHROPIC_BASE_URL"), "routing should have started from the file key");
  assert.ok(env.includes("OTHER_VAR"), "other env file variables still pass through");
}));

test("routing keys read from an env file stay out of the codex child environment", withSandbox(({ run, recorded, home }) => {
  writeFileSync(join(home, ".jev-router.env"), keyFile);
  const r = run(["codex", "exec", "hi"]);
  assert.equal(r.status, 0, r.stderr);
  const { argv, env } = recorded();
  for (const key of KEYS) assert.ok(!env.includes(key), `${key} leaked`);
  assert.ok(argv.includes('model_provider="jev"'), "routing should have started from the file key");
  assert.ok(env.includes("OTHER_VAR"));
}));

test("routing keys the user exported stay in the child environment", withSandbox(({ run, recorded, home }) => {
  writeFileSync(join(home, ".jev-router.env"), keyFile);
  const exported = { JEV_API_KEY: "fake-exported" };
  for (const args of [["-p", "hello"], ["codex", "exec", "hi"]]) {
    const r = run(args, exported);
    assert.equal(r.status, 0, r.stderr);
    const { env } = recorded();
    assert.ok(env.includes("JEV_API_KEY"), `exported key dropped for ${args[0]}`);
    assert.ok(!env.includes("TYPESAFE_API_KEY") && !env.includes("OPENROUTER_API_KEY"));
  }
}));

test("jev codex installs a skill pointing at this package's explain script", withSandbox(({ run, home }) => {
  assert.equal(run(["codex", "exec", "hi"]).status, 0);
  const text = readFileSync(join(home, ".agents", "skills", "jev-router-explain", "SKILL.md"), "utf8");
  const script = /node "([^"]+)"/.exec(text)?.[1];
  assert.equal(script, join(ROOT, "bin", "explain.mjs"));
  assert.ok(existsSync(script));
}));

const PKG_VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

test("jev --version prints our version, then the claude --version output", withSandbox(({ dir, home, run }) => {
  const stub = join(dir, "bin", "claude");
  writeFileSync(stub, `#!${process.execPath}\nconsole.log("9.9.9 (Claude Code)");\n`);
  chmodSync(stub, 0o755);
  for (const flag of ["--version", "-v"]) {
    const r = run([flag]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, `jev-router-plus ${PKG_VERSION}\n9.9.9 (Claude Code)\n`);
  }
  assert.deepEqual(readdirSync(home), [], "must not write to HOME");
}));

test("jev --version propagates a failing claude exit code", withSandbox(({ dir, run }) => {
  const stub = join(dir, "bin", "claude");
  writeFileSync(stub, `#!${process.execPath}\nprocess.exit(3);\n`);
  chmodSync(stub, 0o755);
  const r = run(["--version"]);
  assert.equal(r.status, 3);
  assert.equal(r.stdout, `jev-router-plus ${PKG_VERSION}\n`);
}));

test("jev --version without claude prints only our line and exits 0", withSandbox(({ dir, cwd, home, tmp }) => {
  const empty = join(dir, "empty");
  mkdirSync(empty);
  const r = spawnSync(process.execPath, [JEV, "--version"], {
    cwd,
    env: { PATH: empty, HOME: home, USERPROFILE: home, TMPDIR: tmp },
    encoding: "utf8",
    timeout: 20000,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `jev-router-plus ${PKG_VERSION}\n`);
}));
