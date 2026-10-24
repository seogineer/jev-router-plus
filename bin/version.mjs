#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, accessSync, constants } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

/**
 * Same lookup as bin/claude.mjs: find `claude` on PATH, and flag `.cmd`/`.bat` shims, which Node
 * refuses to run without a shell. Kept local because bin/claude.mjs launches a session on import.
 */
function resolveClaude() {
  const win = process.platform === "win32";
  const exts = win ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";") : [""];
  for (const dir of (process.env.PATH ?? "").split(win ? ";" : ":")) {
    if (!dir) continue;
    for (const ext of exts) {
      const file = join(dir.replace(/^"|"$/g, ""), `claude${ext}`);
      try {
        accessSync(file, constants.X_OK);
        return { file, shell: /\.(cmd|bat)$/i.test(file) };
      } catch {
        // Not here; keep looking.
      }
    }
  }
  return null;
}

// No key loading, proxy, or settings changes: this only reports versions.
process.stdout.write(`jev-router-plus ${version}\n`);

const claude = resolveClaude();
if (claude) {
  const r = spawnSync(claude.file, ["--version"], { stdio: "inherit", shell: claude.shell });
  if (r.error) {
    // resolveClaude already found an executable file, so even ENOENT here means it cannot start
    // (for example a shebang naming a missing interpreter). A claude that is not installed never
    // reaches this point and stays silent.
    process.stderr.write(`[jev] claude --version failed to start: ${r.error.message}\n`);
    process.exit(0);
  } else {
    process.exit(r.signal ? 1 : (r.status ?? 0));
  }
}
