import { logger } from "../lib/logger";

/**
 * AI NOC — LLM narrative layer
 * ─────────────────────────────
 * This is the ONLY place in the NOC that talks to a language model, and it
 * is used for exactly one thing: turning structured, already-computed
 * signals into a short, readable narrative (root-cause explanation,
 * incident report prose, recommendation rationale). It never decides what
 * is safe to run — see noc-actions.ts's ALLOWLIST, which is keyed purely on
 * `actionType` and has no path back to anything the model outputs. If this
 * file were deleted entirely, the NOC would keep detecting faults,
 * generating recommendations, and executing safe actions exactly as before
 * — it would just show the deterministic rule-based summary instead of
 * prose everywhere a narrative would otherwise appear.
 *
 * Config: ANTHROPIC_API_KEY (see .env.example). Missing/invalid key is not
 * a startup failure — every call site here degrades to `null` and the
 * caller falls back to its deterministic summary.
 */

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-5";
const REQUEST_TIMEOUT_MS = 20_000;

function model(): string {
  return process.env.ANTHROPIC_NOC_MODEL?.trim() || DEFAULT_MODEL;
}

export class NocLlmConfigError extends Error {}

function apiKey(): string | null {
  const key = process.env.ANTHROPIC_API_KEY;
  return key && key.trim() ? key.trim() : null;
}

export function isNocLlmConfigured(): boolean {
  return apiKey() !== null;
}

interface NarrateInput {
  /** Short instruction for what kind of narrative this is (root-cause explanation, incident report, recommendation rationale, etc). */
  task: string;
  /** The structured, already-verified signal data — the model may only describe/explain this, not invent facts beyond it. */
  context: Record<string, unknown>;
  /** Upper bound on response length so a narrative can't balloon into something unreviewable. */
  maxWords?: number;
}

/**
 * Ask the model to narrate a bundle of structured signals in plain,
 * NOC-operator language. Returns null (never throws) on any failure —
 * missing key, network error, timeout, non-2xx response, or an
 * unparseable reply — so callers can unconditionally fall back to their
 * deterministic summary without a try/catch of their own.
 */
export async function narrate(input: NarrateInput): Promise<string | null> {
  const key = apiKey();
  if (!key) return null;

  const maxWords = input.maxWords ?? 180;
  const system = [
    "You are a network operations assistant writing for ISP staff monitoring MikroTik-based access networks.",
    "You are given ONLY structured, already-verified telemetry and billing signals as JSON — never invent routers, customers, numbers, or events that are not in the provided context.",
    "Write plain, concrete, operational prose. No markdown headers, no bullet lists, no emoji.",
    `Keep the response under ${maxWords} words.`,
    "You are explaining what happened and why it likely happened — you are not deciding or announcing what action will be taken; a separate system (not you) decides that independently.",
  ].join(" ");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: model(),
        max_tokens: 600,
        system,
        messages: [
          {
            role: "user",
            content: `Task: ${input.task}\n\nSignals (JSON):\n${JSON.stringify(input.context, null, 2)}`,
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logger.error({ status: response.status, body: body.slice(0, 500) }, "NOC LLM narrative request failed");
      return null;
    }

    const data = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = data.content?.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim();
    return text && text.length > 0 ? text : null;
  } catch (err) {
    logger.error({ err }, "NOC LLM narrative request errored");
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
