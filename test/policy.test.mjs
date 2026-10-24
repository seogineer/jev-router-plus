import test from "node:test";
import assert from "node:assert/strict";
import { decide, detectOverride } from "../src/policy.mjs";
import { QUESTIONS, shouldUseExactModel } from "../src/config.mjs";

const ALL = ["haiku", "sonnet", "opus", "fable"];
const sure = (choice) => ({ choice, confidence: 0.95 });
const unsure = (choice) => ({ choice, confidence: 0.2 });
const base = { prompt: "refactor the parser", current: "sonnet", available: ALL, contextTokens: 0 };

test("score rubrics contain only API-valid descriptions", () => {
  for (const question of Object.values(QUESTIONS).filter((q) => q.type === "score")) {
    assert(question.criteria.every((description) => typeof description === "string"));
    assert(question.criteria.length <= 10);
  }
});

test("follows a confident Jev answer", () => {
  assert.deepEqual(decide({ ...base, jev: sure("opus") }), {
    tier: "opus",
    reason: "jev",
    changed: true,
  });
});

test("an explicit user override beats Jev", () => {
  const out = decide({ ...base, prompt: "use haiku to fix this typo", jev: sure("opus") });
  assert.equal(out.tier, "haiku");
  assert.equal(out.reason, "override");
});

test("detectOverride only fires on a real instruction", () => {
  assert.equal(detectOverride("switch to opus"), "opus");
  assert.equal(detectOverride("use luna"), "haiku");
  assert.equal(detectOverride("use strong"), "opus");
  assert.equal(detectOverride("the opus of his career"), null);
});

test("keeps the current model when Jev is unreachable", () => {
  const out = decide({ ...base, jev: null });
  assert.equal(out.tier, "sonnet");
  assert.equal(out.changed, false);
  assert.match(out.reason, /jev-unavailable/);
});

test("ignores a tier name Jev invented", () => {
  assert.equal(decide({ ...base, jev: sure("gpt-9") }).tier, "sonnet");
});

test("never downgrades on a low-confidence answer", () => {
  const out = decide({ ...base, jev: unsure("haiku") });
  assert.equal(out.tier, "sonnet");
  assert.match(out.reason, /low-confidence-no-downgrade/);
});

test("caps a low-confidence upgrade at the safe ceiling", () => {
  const out = decide({ ...base, current: "haiku", jev: unsure("fable") });
  assert.equal(out.tier, "sonnet");
  assert.equal(out.reason, "low-confidence-capped");
});

test("still allows a confident upgrade to fable", () => {
  assert.equal(decide({ ...base, jev: sure("fable") }).tier, "fable");
});

test("refuses a downgrade once the cache rebuild costs more than it saves", () => {
  const out = decide({ ...base, current: "opus", jev: sure("haiku"), contextTokens: 80000 });
  assert.equal(out.tier, "opus");
  assert.match(out.reason, /cache-rebuild/);
});

test("allows the same downgrade early in a conversation", () => {
  assert.equal(decide({ ...base, current: "opus", jev: sure("haiku") }).tier, "haiku");
});

test("substitutes upward when the chosen tier is unavailable", () => {
  const out = decide({ ...base, current: "haiku", available: ["haiku", "opus"], jev: sure("sonnet") });
  assert.equal(out.tier, "opus");
  assert.match(out.reason, /unavailable/);
});

test("never substitutes upward into paid fable", () => {
  const out = decide({ ...base, current: "haiku", available: ["haiku", "fable"], jev: sure("opus") });
  assert.equal(out.tier, "haiku");
});

test("accepts exact model changes within the same tier", () => {
  assert.equal(shouldUseExactModel("jev/no-change", "opus", "opus"), true);
  assert.equal(shouldUseExactModel("low-confidence-no-downgrade/no-change", "opus", "opus"), false);
});

test("a rejected Jev key is reported as jev-auth-failed", () => {
  const out = decide({ ...base, jev: null, jevError: { status: 401 } });
  assert.equal(out.tier, "sonnet");
  assert.equal(out.changed, false);
  assert.equal(out.reason, "jev-auth-failed/no-change");
});

test("jevError without a Jev outage and no jevError keep the old reasons", () => {
  assert.equal(decide({ ...base, jev: null }).reason, "jev-unavailable/no-change");
  assert.equal(decide({ ...base, jev: null, jevError: null }).reason, "jev-unavailable/no-change");
  assert.equal(decide({ ...base, jev: sure("opus"), jevError: { status: 401 } }).reason, "jev");
});

test("jev-auth-failed combines with the no-change and unavailable suffixes", () => {
  const err = { status: 403 };
  assert.equal(decide({ ...base, jev: null, jevError: err }).reason, "jev-auth-failed/no-change");
  // Current tier is not runnable: policy steps to a runnable tier and flags it.
  const moved = decide({ ...base, jev: null, jevError: err, available: ["haiku", "opus"] });
  assert.equal(moved.reason, "jev-auth-failed+unavailable");
  assert.equal(moved.changed, true);
  // A prompt override still wins over the auth failure.
  assert.equal(decide({ ...base, prompt: "use opus for this", jev: null, jevError: err }).reason.startsWith("override"), true);
  // A malformed answer is an outage, not an auth failure, even with jevError set.
  assert.equal(decide({ ...base, jev: { choice: "bogus", confidence: 1 }, jevError: err }).reason, "jev-unavailable/no-change");
});
