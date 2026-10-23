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
