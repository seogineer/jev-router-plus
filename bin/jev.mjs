#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseSubcommand } from "../src/dispatch.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const { target, args } = parseSubcommand(process.argv.slice(2));
const file = join(HERE, `${target}.mjs`);

// The launchers run on import and read process.argv.slice(2), so present them as if invoked directly.
process.argv = [process.argv[0], file, ...args];

try {
  await import(pathToFileURL(file).href);
} catch (err) {
  process.stderr.write(`[jev] ${err?.stack ?? err}\n`);
  process.exit(1);
}
