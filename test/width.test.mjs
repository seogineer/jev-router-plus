import test from "node:test";
import assert from "node:assert/strict";
import { displayWidth, padEndToWidth, splitByWidth, truncateToWidth } from "../src/width.mjs";

const HANGUL = "\u{D55C}\u{AE00}"; // 2 characters, 4 columns
const GRIN = "\u{1F600}";
const ROCKET = "\u{1F680}";

test("displayWidth counts ASCII, Hangul and mixed text", () => {
  assert.equal(displayWidth(""), 0);
  assert.equal(displayWidth("abc"), 3);
  assert.equal(displayWidth(HANGUL), 4);
  assert.equal(displayWidth(`hi ${HANGUL}`), 7);
});

test("displayWidth counts emoji as two columns", () => {
  assert.equal(displayWidth(GRIN), 2);
  assert.equal(displayWidth(ROCKET), 2);
  assert.equal(displayWidth(`a${GRIN}b`), 4);
});

test("displayWidth counts combining marks as zero", () => {
  assert.equal(displayWidth("é"), 1);
  assert.equal(displayWidth("́"), 0);
});

test("displayWidth handles ZWJ, variation selectors and skin tones", () => {
  const family = "\u{1F468}‍\u{1F469}‍\u{1F467}";
  assert.equal(displayWidth(family), 2);
  assert.equal(displayWidth("❤️"), 2);
  assert.equal(displayWidth("\u{1F44D}\u{1F3FD}"), 2);
  assert.equal(displayWidth("a​b"), 2);
});

test("displayWidth counts Japanese and Chinese as wide", () => {
  assert.equal(displayWidth("こんにちは"), 10);
  assert.equal(displayWidth("カタカナ"), 8);
  assert.equal(displayWidth("中文"), 4);
});

test("truncateToWidth leaves text that fits and cuts with an ellipsis", () => {
  assert.equal(truncateToWidth("abcde", 5), "abcde");
  assert.equal(truncateToWidth("abcdef", 5), "abcd…");
  assert.equal(truncateToWidth(HANGUL, 4), HANGUL);
  assert.equal(truncateToWidth("", 3), "");
  assert.equal(truncateToWidth("abc", 0), "");
});

test("truncateToWidth handles a wide character straddling the boundary", () => {
  // Remaining width 1 cannot hold a 2-column character: stop before it.
  const out = truncateToWidth(`abc${HANGUL}`, 5);
  assert.equal(out, "abc…");
  assert.ok(displayWidth(out) <= 5);
});

test("truncateToWidth never splits surrogate pairs or ZWJ sequences", () => {
  const family = "\u{1F468}‍\u{1F469}‍\u{1F467}";
  for (const text of [GRIN.repeat(10), `${family}${family}${family}`]) {
    for (let max = 1; max <= 9; max++) {
      const out = truncateToWidth(text, max);
      assert.ok(displayWidth(out) <= max);
      assert.ok(!/[\uD800-\uDFFF]/.test(out.replace(/[\u{10000}-\u{10FFFF}]/gu, "")), "lone surrogate");
      assert.ok(!/‍…$/.test(out), "dangling ZWJ");
    }
  }
  assert.equal(truncateToWidth(`${family}${family}`, 3), `${family}…`);
});

test("padEndToWidth pads by columns", () => {
  assert.equal(padEndToWidth("ab", 5), "ab   ");
  assert.equal(padEndToWidth(HANGUL, 6), `${HANGUL}  `);
  assert.equal(padEndToWidth("abcdef", 3), "abcdef");
});

test("splitByWidth hard-splits on character boundaries", () => {
  assert.deepEqual(splitByWidth("abcdef", 4), ["abcd", "ef"]);
  assert.deepEqual(splitByWidth(HANGUL.repeat(3), 5), [HANGUL, HANGUL, HANGUL]);
  assert.deepEqual(splitByWidth("", 4), [""]);
  assert.equal(splitByWidth(GRIN.repeat(5), 4).join(""), GRIN.repeat(5));
  assert.deepEqual(splitByWidth(GRIN, 1), [GRIN]);
});

test("every Hangul syllable, jamo block, kana and CJK ideograph is wide", () => {
  const ranges = [[0xac00, 0xd7a3], [0x1100, 0x115f], [0x3041, 0x3096], [0x30a1, 0x30fa], [0x4e00, 0x9fff]];
  for (const [lo, hi] of ranges) {
    for (let cp = lo; cp <= hi; cp++) {
      assert.equal(displayWidth(String.fromCodePoint(cp)), 2, `U+${cp.toString(16)}`);
    }
  }
});

test("seeded random strings keep the truncate/pad/split invariants", () => {
  let seed = 20240607;
  const rnd = (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  const parts = [
    "a", "Z", " ", "\t", "\u{D55C}", "\u{AE00}", "\u{3042}", "\u{4E2D}", "\u{1F600}", "\u{1F44D}\u{1F3FD}",
    "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}", "\u{0301}", "\u{FE0F}", "\u{1F1F0}\u{1F1F7}", "\u{2026}", "\u{0}", "\u{7F}",
  ];
  for (let i = 0; i < 1500; i++) {
    let s = "";
    for (let k = rnd(60); k > 0; k--) s += parts[rnd(parts.length)];
    const n = 1 + rnd(30);
    const t = truncateToWidth(s, n);
    assert.ok(displayWidth(t) <= n, JSON.stringify([s, n]));
    if (t !== s) assert.ok(t.endsWith("\u{2026}") && s.startsWith(t.slice(0, -1)), JSON.stringify([s, n]));
    assert.equal(displayWidth(padEndToWidth(s, n)), Math.max(n, displayWidth(s)));
    const chunks = splitByWidth(s, n);
    assert.equal(chunks.join(""), s);
    for (const c of chunks) assert.ok(displayWidth(c) <= Math.max(n, 2), JSON.stringify([s, n, c]));
  }
});

test("width helpers stay fast on very long input", () => {
  const s = "\u{D55C}\u{1F600}\u{200D}a ".repeat(25000);
  const start = Date.now();
  truncateToWidth(s, 44);
  splitByWidth(s, 44);
  displayWidth(s);
  assert.ok(Date.now() - start < 1000);
});

test("invisible format characters have zero width", () => {
  for (const cp of [0xfeff, 0xad, 0x200e, 0x200f, 0x202a, 0x202e, 0x2066, 0x2069, 0x2060, 0x2064, 0x61c, 0x600, 0xe0041]) {
    assert.equal(displayWidth(`a${String.fromCodePoint(cp)}b`), 2, cp.toString(16));
  }
  assert.equal(displayWidth("\u{FEFF}"), 0);
  assert.equal(displayWidth("\u{200E}"), 0);
});

test("ZWJ joins a following pictograph only after a pictograph", () => {
  assert.equal(displayWidth("\u{D55C}\u{200D}\u{1F600}"), 4);
  assert.equal(displayWidth("a \u{200D}\u{2122}"), 4);
  assert.equal(displayWidth("\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}"), 2);
  assert.equal(displayWidth("\u{200D}\u{1F600}"), 2);
  assert.deepEqual(splitByWidth("\u{D55C}\u{200D}\u{1F600}", 2), ["\u{D55C}\u{200D}", "\u{1F600}"]);
  assert.equal(truncateToWidth("\u{D55C}\u{200D}\u{1F600}\u{1F600}", 5), "\u{D55C}\u{200D}\u{1F600}\u{2026}");
});
