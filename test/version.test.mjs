import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const JEV = join(ROOT, "bin", "jev.mjs");
const PKG_VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

// A fake claude that records argv and a few env names to $FAKE_OUT, then prints a version line.
const STUB =
  `#!${process.execPath}\n` +
  `require("node:fs").writeFileSync(process.env.FAKE_OUT, JSON.stringify({ argv: process.argv.slice(2), env: Object.keys(process.env) }));\n` +
  `console.log("9.9.9 (Claude Code)");\n`;

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "jev-ver-"));
  const [bin, home, tmp, cwd] = ["bin", "home", "tmp", "cwd"].map((d) => join(dir, d));
  for (const d of [bin, home, tmp, cwd]) mkdirSync(d);
  writeFileSync(join(bin, "claude"), STUB);
  chmodSync(join(bin, "claude"), 0o755);
  const out = join(dir, "out.json");
  const env = { PATH: `${bin}:${dirname(process.execPath)}`, HOME: home, USERPROFILE: home, TMPDIR: tmp, FAKE_OUT: out };
  const run = (args, extra = {}) =>
    spawnSync(process.execPath, [JEV, ...args], { cwd, env: { ...env, ...extra }, encoding: "utf8", timeout: 20000 });
  return { dir, home, tmp, cwd, out, run, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const withSandbox = (fn) => async () => {
  const sb = sandbox();
  try {
    await fn(sb);
  } finally {
    sb.cleanup();
  }
};

test("jev --version never starts the proxy, loads env files, or touches settings, even with keys present", withSandbox(({ run, home, tmp, cwd, out }) => {
  // Keys in the env file and in the real environment would both start a proxy on a normal launch.
  writeFileSync(join(home, ".jev-router.env"), "JEV_API_KEY=fake-key-1\nOPENROUTER_API_KEY=fake-key-3\n");
  writeFileSync(join(cwd, ".env"), "JEV_API_KEY=fake-key-4\n");
  for (const flag of ["--version", "-v"]) {
    const r = run([flag], { JEV_API_KEY: "fake-exported" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, `jev-router-plus ${PKG_VERSION}\n9.9.9 (Claude Code)\n`);
    assert.equal(r.stderr, "", "no routing notice or warnings");
    const { argv, env } = JSON.parse(readFileSync(out, "utf8"));
    assert.deepEqual(argv, ["--version"], "claude gets exactly --version (no --add-dir, no --settings)");
    assert.ok(!env.includes("ANTHROPIC_BASE_URL") && !env.includes("ANTHROPIC_MODEL"), "no proxy wiring");
    assert.ok(!env.includes("OPENROUTER_API_KEY"), "env files are not loaded");
  }
  assert.deepEqual(readdirSync(home).sort(), [".jev-router.env"], "HOME gained nothing (no .claude, no log)");
  assert.equal(existsSync(join(home, ".claude")), false);
  assert.deepEqual(readdirSync(tmp), [], "no status dir or settings file written");
}));

for (const argv of [["--version", "extra"], ["-v", "-p"], ["--version", "-p"], ["-p", "--version"]]) {
  test(`jev ${argv.join(" ")} goes to claude, not the version target`, withSandbox(({ run, out }) => {
    const r = run(argv);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /jev-router-plus/);
    const recorded = JSON.parse(readFileSync(out, "utf8")).argv;
    assert.deepEqual(recorded.slice(0, argv.length), argv);
    assert.ok(recorded.includes("--add-dir"), "normal launcher path was used");
  }));
}

// Function source between its JSDoc end and the matching closing brace at column 0.
const fnSource = (file) => {
  const text = readFileSync(join(ROOT, "bin", file), "utf8").replace(/\r\n/g, "\n");
  const m = /^function resolveClaude\(\) \{\n[\s\S]*?^\}\n/m.exec(text);
  assert.ok(m, `resolveClaude not found in ${file}`);
  return m[0];
};

test("bin/version.mjs resolveClaude is identical to bin/claude.mjs resolveClaude", () => {
  assert.equal(fnSource("version.mjs"), fnSource("claude.mjs"));
});

test("version.mjs and claude.mjs resolve the same claude on PATH (first match wins, non-executable skipped)", withSandbox(({ dir }) => {
  const a = join(dir, "a");
  const b = join(dir, "b");
  mkdirSync(a);
  mkdirSync(b);
  writeFileSync(join(a, "claude"), "#!/bin/sh\necho from-a\n");
  chmodSync(join(a, "claude"), 0o644);
  writeFileSync(join(b, "claude"), `#!${process.execPath}\nconsole.log("from-b");\n`);
  chmodSync(join(b, "claude"), 0o755);
  const r = spawnSync(process.execPath, [join(ROOT, "bin", "version.mjs")], {
    env: { PATH: `::${a}:${b}`, HOME: dir, TMPDIR: dir },
    encoding: "utf8",
    timeout: 20000,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `jev-router-plus ${PKG_VERSION}\nfrom-b\n`);
}));

test("a claude that cannot start is reported on stderr after our version line, exit 0", withSandbox(({ dir, run }) => {
  writeFileSync(join(dir, "bin", "claude"), "#!/nonexistent/node\n");
  chmodSync(join(dir, "bin", "claude"), 0o755);
  const r = spawnSync(process.execPath, [join(ROOT, "bin", "version.mjs")], {
    env: { PATH: join(dir, "bin"), HOME: dir, TMPDIR: dir },
    encoding: "utf8",
    timeout: 20000,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.split("\n")[0], `jev-router-plus ${PKG_VERSION}`);
  assert.match(r.stderr, /failed to start/);
}));

test("a missing claude is silent: our version line only, exit 0", withSandbox(({ dir }) => {
  const empty = join(dir, "empty");
  mkdirSync(empty);
  const r = spawnSync(process.execPath, [join(ROOT, "bin", "version.mjs")], {
    env: { PATH: empty, HOME: dir, TMPDIR: dir },
    encoding: "utf8",
    timeout: 20000,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `jev-router-plus ${PKG_VERSION}\n`);
  assert.equal(r.stderr, "");
}));

// Rendered README screenshots must be real PNGs.
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
for (const readme of ["README.md", "README.ko.md"]) {
  test(`${readme} screenshots exist and are valid PNGs`, () => {
    const text = readFileSync(join(ROOT, readme), "utf8").replace(/```[\s\S]*?```/g, "");
    const images = [...text.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]).filter((s) => !/^https?:/.test(s));
    for (const want of ["docs/model-picker.png", "docs/codex-model-picker.png"]) {
      assert.ok(images.includes(want), `${readme} should reference ${want}`);
    }
    for (const rel of images) {
      const buf = readFileSync(join(ROOT, rel));
      assert.ok(buf.length > 1000, `${rel} is suspiciously small`);
      assert.deepEqual(buf.subarray(0, 8), PNG_SIG, `${rel} signature`);
      assert.equal(buf.subarray(12, 16).toString("latin1"), "IHDR", `${rel} first chunk`);
      assert.ok(buf.readUInt32BE(16) > 0 && buf.readUInt32BE(20) > 0, `${rel} dimensions`);
      assert.equal(buf.subarray(buf.length - 8, buf.length - 4).toString("latin1"), "IEND", `${rel} is truncated`);
    }
  });
}
