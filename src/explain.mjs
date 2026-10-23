import { tierOf } from "./config.mjs";
// Wide enough for "Selected model: claude-sonnet-4-5-20250929" (42 chars).
const WIDTH = 46;
const row = (text = "") => {
  const body = text.length > WIDTH - 2 ? `${text.slice(0, WIDTH - 3)}…` : text;
  return `│ ${body.padEnd(WIDTH - 2)} │`;
};
const metric = (value) => (Number.isFinite(value) ? value.toFixed(2) : "n/a");
const wrapped = (label, value) => {
  const words = `${label}${value}`.replace(/\s+/g, " ").trim().split(" ");
  const lines = [];
  for (const word of words) {
    if (!lines.length || `${lines.at(-1)} ${word}`.length > WIDTH - 2) lines.push(word);
    else lines[lines.length - 1] += ` ${word}`;
  }
  return lines.map(row);
};

const decision = (reason = "") => {
  if (reason.includes("override")) return "prompt override";
  if (reason.includes("jev-unavailable")) return "Jev unavailable; held";
  if (reason.includes("low-confidence-no-downgrade")) return "low confidence; held";
  if (reason.includes("low-confidence-capped")) return "low confidence; capped";
  if (reason.includes("cache-rebuild")) return "cache rebuild avoided";
  if (reason.includes("unavailable")) return "nearest available tier";
  return "Jev recommendation";
};

export function formatExplanation(status) {
  if (!status) return "Jev Router: no routing decision has been recorded for this session.";
  if (status.manual) return "Jev Router: routing is paused because you selected a model manually.";

  const m = status.metrics ?? {};
  const request = status.jev?.request?.state;
  // askJev's Choice is keyed "model" (exact provider id); older fixtures used "model_tier".
  // Map an id to its tier so the line stays a short tier name next to "Selected model".
  const raw =
    status.jev?.response?.answers?.model?.choice ??
    status.jev?.response?.answers?.model_tier?.choice;
  const recommendation = (raw && (tierOf(raw) ?? raw)) || status.tier || "unknown";
  const currentModel = request?.session?.current_model;
  const currentTier = currentModel ? (tierOf(currentModel) ?? currentModel) : "unknown";
  return [
    `┌${"─".repeat(WIDTH)}┐`,
    row("Jev Router"),
    row(),
    row("Jev request"),
    ...wrapped("Prompt: ", status.prompt ?? "not recorded"),
    row(`Current tier: ${currentTier}`),
    row(`Context tokens: ${request?.session?.context_tokens ?? "unknown"}`),
    row(),
    row("Jev response"),
    row(`Task complexity     ${metric(m.taskComplexity)}`),
    row(`Reasoning required  ${metric(m.reasoningRequired)}`),
    row(`Tool complexity     ${metric(m.toolComplexity)}`),
    row(`Context size        ${metric(m.contextSize)}`),
    row(),
    row(`Recommended tier: ${recommendation.toUpperCase()}`),
    row(`Selected model: ${status.model ?? status.tier ?? "unknown"}`),
    row(),
    row(`Confidence: ${status.confidence == null ? "n/a" : `${Math.round(status.confidence * 100)}%`}`),
    row(`Decision: ${decision(status.reason)}`),
    `└${"─".repeat(WIDTH)}┘`,
  ].join("\n");
}
