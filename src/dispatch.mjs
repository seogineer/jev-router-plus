const TARGETS = new Set(["claude", "codex", "explain"]);

/**
 * Decide which internal launcher `jev` should run. `argv` is `process.argv.slice(2)`.
 * A leading `claude` / `codex` / `explain` selects that launcher and is consumed; anything else
 * (no args, `--resume`, `-p ...`) goes to Claude Code unchanged.
 */
export function parseSubcommand(argv) {
  const [first, ...rest] = argv;
  if (TARGETS.has(first)) return { target: first, args: rest };
  return { target: "claude", args: [...argv] };
}
