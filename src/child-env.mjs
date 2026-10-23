/** Routing credentials the wrapper itself needs, but a launched CLI and its tool shells do not. */
export const ROUTING_KEYS = ["JEV_API_KEY", "TYPESAFE_API_KEY", "OPENROUTER_API_KEY"];

/** Which routing keys are already set, taken before any env file is loaded. */
export const routingKeysPresent = (env = process.env) => ROUTING_KEYS.filter((key) => key in env);

/**
 * Environment for the child CLI. A routing key that only appeared because an env file was
 * loaded is dropped; one the user exported themselves stays, since their other tools may use
 * it. `process.env` is left alone because the in-process proxy still reads it.
 */
export function childEnv(before, env = process.env) {
  const out = { ...env };
  for (const key of ROUTING_KEYS) if (!before.includes(key)) delete out[key];
  return out;
}
