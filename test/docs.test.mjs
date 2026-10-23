import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const p = (...s) => join(ROOT, ...s);
const read = (...s) => readFileSync(p(...s), "utf8");
const HANGUL = /[\u{AC00}-\u{D7A3}]/u;

const PAIRS = [
  { en: ["README.md"], ko: ["README.ko.md"], toKo: "(README.ko.md)", toEn: "(README.md)" },
  {
    en: ["docs", "jev-claude-architecture.md"],
    ko: ["docs", "jev-claude-architecture.ko.md"],
    toKo: "(jev-claude-architecture.ko.md)",
    toEn: "(jev-claude-architecture.md)",
  },
];

// Headings (# to ###) outside fenced code blocks, plus the number of fences.
function outline(text) {
  const headings = [];
  let fences = 0;
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^```/.test(line)) {
      fences++;
      inFence = !inFence;
      continue;
    }
    if (!inFence) {
      const m = /^(#{1,3})\s/.exec(line);
      if (m) headings.push(m[1].length);
    }
  }
  return { headings, fences };
}

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const f = join(dir, n);
    return statSync(f).isDirectory() ? walk(f) : [f];
  });
}

test("Korean docs exist with the same headings and code blocks as the English originals", () => {
  for (const { en, ko } of PAIRS) {
    assert.ok(existsSync(p(...ko)), `${ko.join("/")} missing`);
    const a = outline(read(...en));
    const b = outline(read(...ko));
    assert.ok(a.headings.length > 0);
    assert.deepEqual(b.headings, a.headings, `${ko.join("/")} heading levels differ`);
    assert.equal(b.fences, a.fences, `${ko.join("/")} code fence count differs`);
  }
});

test("each document links to its other-language version near the top", () => {
  for (const { en, ko, toKo, toEn } of PAIRS) {
    assert.ok(read(...en).split(/\r?\n/).slice(0, 6).join("\n").includes(toKo), `${en.join("/")} lacks link to Korean`);
    assert.ok(read(...ko).split(/\r?\n/).slice(0, 6).join("\n").includes(toEn), `${ko.join("/")} lacks link to English`);
  }
});

test("Korean docs actually contain Korean", () => {
  for (const { ko } of PAIRS) assert.match(read(...ko), HANGUL);
});

test("English docs contain no Hangul except the language-switch link", () => {
  for (const { en, toKo } of PAIRS) {
    const lines = read(...en)
      .split(/\r?\n/)
      .filter((l) => !(l.startsWith("English | [") && l.includes(toKo)));
    assert.deepEqual(lines.filter((l) => HANGUL.test(l)), [], `${en.join("/")} contains Hangul`);
  }
});

test("source, bins, tests and skills contain no Hangul (comments stay English)", () => {
  const files = [...walk(p("src")), ...walk(p("bin")), ...walk(p("test")), ...walk(p("skills")), ...walk(p(".claude", "skills"))];
  assert.ok(files.length > 0);
  const hits = files.filter((f) => HANGUL.test(readFileSync(f, "utf8"))).map((f) => f.slice(ROOT.length + 1));
  assert.deepEqual(hits, []);
});

test("package files list includes README.ko.md and still excludes docs", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.files.includes("README.ko.md"));
  assert.ok(!pkg.files.some((f) => f === "docs" || f.startsWith("docs/")));
  assert.ok(existsSync(p("README.ko.md")));
});

test("README install section matches the single-command package", () => {
  for (const f of ["README.md", "README.ko.md"]) {
    const t = read(f);
    assert.match(t, /npm install -g jev-router-plus/);
    assert.match(t, /npm update -g jev-router-plus/);
    assert.match(t, /npm uninstall -g jev-router-plus/);
    assert.match(t, /JEV_PROVIDER=openrouter/);
  }
});

// Fenced blocks and inline code must match between languages (English `# comment` lines may differ).
function codeParts(text) {
  const fences = [];
  const inline = new Set();
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      if (cur) {
        fences.push(cur);
        cur = null;
      } else cur = [];
      continue;
    }
    if (cur) {
      const code = line.replace(/\s+#\s.*$/, "").trimEnd();
      if (code.trim() && !/^\s*#\s/.test(code)) cur.push(code);
    } else for (const m of line.matchAll(/`([^`]+)`/g)) inline.add(m[1]);
  }
  return { fences, inline: [...inline].sort() };
}

test("Korean docs keep code blocks and inline code identical to English", () => {
  for (const { en, ko } of PAIRS) {
    const a = codeParts(read(...en));
    const b = codeParts(read(...ko));
    assert.deepEqual(b.fences, a.fences, `${ko.join("/")} code blocks differ`);
    assert.deepEqual(b.inline, a.inline, `${ko.join("/")} inline code differs`);
  }
});

test("relative links and images in all docs resolve to existing files", () => {
  for (const { en, ko } of PAIRS) {
    for (const parts of [en, ko]) {
      const dir = dirname(p(...parts));
      const text = read(...parts).replace(/```[\s\S]*?```/g, "");
      for (const m of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)) {
        if (/^(https?:|mailto:|#)/.test(m[1])) continue;
        assert.ok(existsSync(join(dir, m[1].split("#")[0])), `${parts.join("/")}: broken link ${m[1]}`);
      }
    }
  }
});
