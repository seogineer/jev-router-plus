import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatExplanation } from "../src/explain.mjs";

test("formats the last routing decision", () => {
  const output = formatExplanation({
    prompt: "Explain the router architecture",
    tier: "sonnet",
    confidence: 0.94,
    reason: "jev",
    jev: {
      request: { state: { session: { current_model: "haiku", context_tokens: 6200 } } },
      response: { answers: { model: { choice: "claude-sonnet-5" } } },
    },
    metrics: {
      taskComplexity: 0.82,
      reasoningRequired: 0.91,
      toolComplexity: 0.64,
      contextSize: 0.31,
    },
  });

  assert.match(output, /Task complexity     0\.82/);
  assert.match(output, /Prompt: Explain the router/);
  assert.match(output, /Current tier: haiku/);
  assert.match(output, /Context tokens: 6200/);
  assert.match(output, /Recommended tier: SONNET/);
  assert.match(output, /Selected model: sonnet/);
  assert.match(output, /Confidence: 94%/);
  assert.match(output, /Decision: Jev recommendation/);
});

test("recommended tier is Jev's pick, not the tier policy settled on", () => {
  const output = formatExplanation({
    prompt: "fix a typo",
    tier: "sonnet",
    model: "claude-sonnet-5",
    confidence: 0.2,
    reason: "low-confidence-no-downgrade",
    jev: {
      request: { state: { session: { current_model: "sonnet", context_tokens: 100 } } },
      response: { answers: { model: { choice: "claude-haiku-4-5-20251001" } } },
    },
  });
  assert.match(output, /Recommended tier: HAIKU/);
  assert.match(output, /Selected model: claude-sonnet-5/);
  assert.match(output, /Decision: low confidence; held/);
});

test("shows the concrete provider model when available", () => {
  assert.match(
    formatExplanation({ tier: "haiku", model: "gpt-5.6-luna", confidence: 0.99 }),
    /Selected model: gpt-5\.6-luna/,
  );
});

test("Claude skill pre-approves its read-only explanation command", () => {
  const skill = readFileSync(new URL("../.claude/skills/jev-explain/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /^allowed-tools: Bash\(node \*\)$/m);
});

test("box shows the tier of a full model id and the whole selected model id", () => {
  for (const model of ["claude-haiku-5-5", "claude-sonnet-4-5-20250929"]) {
    const output = formatExplanation({
      prompt: "x",
      tier: "haiku",
      model,
      confidence: 0.9,
      reason: "jev",
      jev: { request: { state: { session: { current_model: "claude-opus-5-5", context_tokens: 1 } } } },
    });
    assert.match(output, /Current tier: opus /);
    assert.ok(output.includes(`Selected model: ${model} `), output);
    assert.ok(!output.includes("…"));
    const widths = new Set(output.split("\n").map((line) => [...line].length));
    assert.equal(widths.size, 1, "all box lines have the same width");
  }
});

test("unknown current model is shown as is; an overlong model id ends with an ellipsis", () => {
  const output = formatExplanation({
    prompt: "x",
    tier: "haiku",
    model: "vendor/some-extremely-long-model-identifier-v1234567890",
    jev: { request: { state: { session: { current_model: "mystery-1" } } } },
  });
  assert.match(output, /Current tier: mystery-1 /);
  assert.match(output, /Selected model: vendor\/some-extremely-long-… /);
  assert.equal(new Set(output.split("\n").map((line) => [...line].length)).size, 1);
});

// ---- display-width alignment (Hangul / emoji / mixed) ----
import { displayWidth } from "../src/width.mjs";

const HANGUL_SENTENCE = "\u{D55C}\u{AE00}\u{C73C}\u{B85C} \u{C791}\u{C131}\u{D55C} \u{AE34} \u{D504}\u{B86C}\u{D504}\u{D2B8}\u{C785}\u{B2C8}\u{B2E4}"; // spaced
const HANGUL_NO_SPACE = "\u{D55C}\u{AE00}".repeat(40);
const EMOJI = "\u{1F600}\u{1F680}".repeat(25);
const base = { tier: "sonnet", model: "claude-sonnet-5", confidence: 0.9, reason: "jev" };

function assertAligned(output) {
  const lines = output.split("\n");
  const width = displayWidth(lines[0]);
  assert.equal(width, 48);
  for (const line of lines) assert.equal(displayWidth(line), width, line);
  assert.match(lines[0], /^┌─+┐$/u);
  assert.match(lines.at(-1), /^└─+┘$/u);
  for (const line of lines.slice(1, -1)) assert.ok(line.startsWith("│ ") && line.endsWith(" │"), line);
}

test("box stays aligned for Hangul, emoji and mixed prompts", () => {
  for (const prompt of [
    HANGUL_SENTENCE,
    HANGUL_NO_SPACE,
    EMOJI,
    `fix ${HANGUL_NO_SPACE} \u{1F680} é done`,
    "é".repeat(60),
  ]) {
    assertAligned(formatExplanation({ ...base, prompt }));
  }
});

test("box stays aligned for wide characters in the model id", () => {
  assertAligned(formatExplanation({ ...base, prompt: "x", model: `m-${HANGUL_NO_SPACE}` }));
  assertAligned(formatExplanation({ ...base, prompt: "x", model: EMOJI }));
});

test("long Hangul prompt wraps over several lines without truncation", () => {
  const output = formatExplanation({ ...base, prompt: HANGUL_NO_SPACE });
  const promptLines = output.split("\n").filter((l) => /\u{D55C}/u.test(l) && !l.includes("Selected"));
  assert.ok(promptLines.length >= 3);
  assert.ok(!promptLines.some((l) => l.includes("…")));
  assert.equal(output.replace(/[^\u{D55C}\u{AE00}]/gu, ""), ("\u{D55C}\u{AE00}".repeat(40)));
});

test("Selected model row is truncated by width with an ellipsis", () => {
  const output = formatExplanation({ ...base, prompt: "x", model: HANGUL_NO_SPACE });
  const line = output.split("\n").find((l) => l.includes("Selected model"));
  assert.ok(line.includes("…"));
  assert.equal(displayWidth(line), 48);
});

test("a single ASCII word longer than the box is hard-split", () => {
  const output = formatExplanation({ ...base, prompt: "x".repeat(100) });
  assertAligned(output);
  assert.equal(output.split("\n").filter((l) => /x{10}/.test(l)).length, 3);
});

test("box lines keep equal width for newline model ids and ZWJ-led words", () => {
  const widths = (o) => formatExplanation(o).split("\n").map((l) => displayWidth(l));
  for (const o of [
    { model: "a\nb\r\nc\td", tier: "x" },
    { prompt: "x".repeat(36) + " \u{200D}\u{2122}", model: "m", tier: "x" },
  ]) {
    const w = widths(o);
    assert.ok(w.every((n) => n === w[0]), JSON.stringify(w));
  }
});

test("decomposed (NFD) Hangul renders exactly like composed (NFC) Hangul", () => {
  // Precomposed Hangul syllables; NFD splits them into conjoining jamo.
  const composed = "\uD55C\uAE00 \uD504\uB86C\uD504\uD2B8 \uC124\uBA85";
  const decomposed = composed.normalize("NFD");
  assert.notEqual(decomposed, composed);
  const make = (text) => formatExplanation({ ...base, prompt: text, model: `m-${text}` });
  assert.equal(make(decomposed), make(composed));
  assertAligned(make(decomposed));
});
