const TARGETS = new Set(["claude", "codex", "explain"]);

/**
 * Decide which internal launcher `jev` should run. `argv` is `process.argv.slice(2)`.
 * A leading `claude` / `codex` / `explain` selects that launcher and is consumed; anything else
 * (no args, `--resume`, `-p ...`) goes to Claude Code unchanged. The exact argv `--version` / `-v`
 * selects the `version` target.
 */
export function parseSubcommand(argv) {
  // Only the bare flag: `jev codex --version` and `jev -p ... --version` keep their old meaning.
  if (argv.length === 1 && (argv[0] === "--version" || argv[0] === "-v")) {
    return { target: "version", args: [] };
  }
  const [first, ...rest] = argv;
  if (TARGETS.has(first)) return { target: first, args: rest };
  return { target: "claude", args: [...argv] };
}
