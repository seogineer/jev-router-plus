import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync, accessSync, constants, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const p = (...s) => join(ROOT, ...s);
const pkg = JSON.parse(readFileSync(p("package.json"), "utf8"));
const lock = JSON.parse(readFileSync(p("package-lock.json"), "utf8"));
const BINS = ["jev-plus-claude", "jev-plus-codex", "jev-plus-explain"];

test("package name and bin map", () => {
  assert.equal(pkg.name, "jev-router-plus");
  assert.deepEqual(Object.keys(pkg.bin).sort(), [...BINS].sort());
  for (const [name, target] of Object.entries(pkg.bin)) {
    assert.equal(target, `bin/${name}.mjs`);
    assert.ok(existsSync(p(target)), `${target} missing`);
  }
});

test("package-lock matches package.json", () => {
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].name, pkg.name);
  assert.equal(lock.packages[""].version, pkg.version);
  assert.deepEqual(lock.packages[""].bin, pkg.bin);
});

test("files entries exist", () => {
  for (const f of ["bin", "src", "skills", ".claude/skills", "README.md"]) {
    assert.ok(pkg.files.includes(f), `files lacks ${f}`);
  }
  for (const f of pkg.files) assert.ok(existsSync(p(f)), `${f} missing`);
});

test("bin files pass node --check", () => {
  for (const name of BINS) {
    const r = spawnSync(process.execPath, ["--check", p("bin", `${name}.mjs`)], { encoding: "utf8" });
    assert.equal(r.status, 0, `${name}: ${r.stderr}`);
  }
});

test("bin files are executable", (t) => {
  for (const name of BINS) {
    try {
      accessSync(p("bin", `${name}.mjs`), constants.X_OK);
    } catch {
      t.diagnostic(`${name}.mjs is not executable`);
      assert.fail(`${name}.mjs lacks exec bit`);
    }
  }
});

test("modules imported by bins load without import errors", async () => {
  // The claude/codex bins launch real CLIs on import and have no --help, so only their
  // dependencies are imported here.
  for (const m of ["proxy", "config", "settings", "status", "log", "jev-client", "codex-cli", "explain"]) {
    await import(p("src", `${m}.mjs`));
  }
});

test("jev-plus-explain runs without crashing (no network, isolated tmpdir)", () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-pkg-test-"));
  const r = spawnSync(process.execPath, [p("bin", "jev-plus-explain.mjs"), "no-such-session"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, TMPDIR: dir, HOME: dir },
    timeout: 15000,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /ERR_MODULE_NOT_FOUND|Cannot find/);
  assert.match(r.stdout, /Jev Router/);
});

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const f = join(dir, n);
    return statSync(f).isDirectory() ? walk(f) : [f];
  });
}

test("no stale bare jev-claude / jev-codex command guidance", () => {
  const files = [...walk(p("src")), ...walk(p("bin")), p("README.md")];
  // Old command used as a command: followed by space/backtick, not part of a path, dotfile, or name.
  const stale = /(?<![\w.\-/\\])jev-(claude|codex)(?=[ `])/;
  const hits = [];
  for (const f of files) {
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      if (stale.test(line)) hits.push(`${f.slice(ROOT.length + 1)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, []);
});

test("LICENSE keeps the original copyright line and adds the fork's", () => {
  const license = readFileSync(p("LICENSE"), "utf8");
  assert.match(license, /^Copyright \(c\) 2026 Jev Router contributors\r?$/m);
  assert.match(license, /^Copyright \(c\) 2026 seogineer\r?$/m);
});
