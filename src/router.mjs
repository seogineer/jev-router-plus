import {
  COMPLEXITY_MAX_SCORE,
  CONTEXT_WINDOW_TOKENS,
  QUESTIONS,
  questionForModels,
  THRESHOLDS,
} from "./config.mjs";
import { createJevClient } from "./jev-client.mjs";
import { log } from "./log.mjs";

// The SDK's defaults (10s per attempt, 2 retries, no total budget) are far too slow for a
// per-prompt hot path, so the timeout, retry count and an outer deadline are all pinned.
// Built lazily because the constructor throws when no key is present, and a missing key
// should degrade to "no routing", not stop the session from starting.
let client;

// Set once the provider rejects the key (HTTP 401). The key is read once at startup, so
// every later call would fail the same way: stop calling and say so once. Only 401 latches: a 403
// can be per-request (OpenRouter moderation, provider permission), so it is retried like any failure.
let authFailure = null;

/** `{ status }` once Jev rejected the API key in this process, otherwise null. */
export function jevAuthFailure() {
  return authFailure;
}

/** Clears the auth-failure latch and the cached client (tests only). */
export function resetJevAuthFailure() {
  authFailure = null;
  client = undefined;
}

function getClient() {
  client ??= createJevClient({
    timeout: THRESHOLDS.jevTimeoutMs,
    retry: { maxRetries: THRESHOLDS.jevMaxRetries, backoffInitialMs: 150, backoffMaxMs: 400 },
  });
  return client;
}

/**
 * Asks Jev which tier fits this prompt. Returns null on any failure, which the policy
 * layer reads as "keep the current model" — routing must never block a prompt.
 *
 * @returns {Promise<?{choice: string, confidence: number, probabilities: object, metrics: object, ms: number}>}
 */
export async function askJev({ prompt, current, contextTokens, models }) {
  if (!models?.length) return null;
  if (authFailure) return null;
  const started = Date.now();
  const abort = new AbortController();
  const deadline = setTimeout(() => abort.abort(), THRESHOLDS.jevDeadlineMs);
  const request = {
    state: {
      request: prompt,
      session: { current_model: current, context_tokens: contextTokens },
      environment: { available_models: models.map((model) => model.id) },
    },
    questions: { ...QUESTIONS, model: questionForModels(models) },
  };
  try {
    const result = await getClient().systemOne(request, { signal: abort.signal });
    const { model: answer, task_complexity, reasoning_required, tool_complexity } = result.answers;
    return {
      ...answer,
      request,
      response: result,
      metrics: {
        taskComplexity: task_complexity.score / COMPLEXITY_MAX_SCORE,
        reasoningRequired: reasoning_required.score / COMPLEXITY_MAX_SCORE,
        toolComplexity: tool_complexity.score / COMPLEXITY_MAX_SCORE,
        contextSize: Math.min(contextTokens / CONTEXT_WINDOW_TOKENS, 1),
      },
      ms: Date.now() - started,
    };
  } catch (err) {
    if (err?.status === 401) {
      if (!authFailure) {
        authFailure = { status: err.status };
        log(
          `Jev rejected the API key (HTTP ${err.status}); routing is off until you fix JEV_API_KEY/OPENROUTER_API_KEY in ~/.jev-router.env and restart jev.`,
        );
      }
      return null;
    }
    log(`routing failed, keeping ${current}: ${err.message}`);
    return null;
  } finally {
    clearTimeout(deadline);
  }
}
