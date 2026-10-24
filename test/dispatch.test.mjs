import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSubcommand } from "../src/dispatch.mjs";

const cases = [
  [[], "claude", []],
  [["codex", "exec", "hi"], "codex", ["exec", "hi"]],
  [["explain", "abc"], "explain", ["abc"]],
  [["claude", "-p", "x"], "claude", ["-p", "x"]],
  [["--resume"], "claude", ["--resume"]],
  [["-p", "hello"], "claude", ["-p", "hello"]],
  [["codexish"], "claude", ["codexish"]],
  [["--version"], "version", []],
  [["-v"], "version", []],
  [["codex", "--version"], "codex", ["--version"]],
  [["-p", "--version"], "claude", ["-p", "--version"]],
  [["--version", "-p"], "claude", ["--version", "-p"]],
];

for (const [argv, target, args] of cases) {
  test(`parseSubcommand(${JSON.stringify(argv)})`, () => {
    assert.deepEqual(parseSubcommand(argv), { target, args });
  });
}

test("parseSubcommand does not mutate its input", () => {
  const argv = ["codex", "exec"];
  parseSubcommand(argv);
  assert.deepEqual(argv, ["codex", "exec"]);
});
