// Supervisor planner: maps a plain-English goal to ONE of the fixed workflows, using Claude.
// The model only chooses a workflow name. It never sets parameters, never runs a step and
// cannot bypass a gate: the Supervisor still runs the workflow's fixed steps, and every
// Tokenization gate still applies. An answer outside the known list is rejected.
import Anthropic from "@anthropic-ai/sdk";

export const PLANNER_MODEL = "claude-opus-5";

export const WORKFLOW_DESCRIPTIONS = {
  "track-and-tokenize": "Track a physical asset or shipment with custody sensor readings, check the offering and counterparties for compliance, then attempt to mint its instrument (every instrument is currently gated, so the mint step always halts).",
  "energy-accounting": "Record and total NET8 solar energy-credit accounting entries (kWh). Creates no token.",
  "anchor-document": "Anchor a document's SHA-256 hash to the HCS audit trail, e.g. a white paper, BFS draft or report version.",
};

const SYSTEM = `You route goals for GCN HiveMind, a pre-audit, testnet-only orchestration system.
Choose exactly one workflow that fits the goal, or "none" if no workflow fits or the goal asks for something the workflows cannot do (for example: issuing or selling tokens, moving funds, bypassing a gate, mainnet activity).

Workflows:
${Object.entries(WORKFLOW_DESCRIPTIONS).map(([k, v]) => `- ${k}: ${v}`).join("\n")}

Give a one-sentence reason. Do not promise outcomes; the workflow's own checks decide what happens.`;

const SCHEMA = {
  type: "object",
  properties: {
    workflow: { type: "string", enum: [...Object.keys(WORKFLOW_DESCRIPTIONS), "none"] },
    reason: { type: "string" },
  },
  required: ["workflow", "reason"],
  additionalProperties: false,
};

export class PlannerError extends Error {}

// Keys not scoped to a workspace must name one on every request (anthropic-workspace-id).
export function createClient(env = process.env) {
  const workspaceId = env.ANTHROPIC_WORKSPACE_ID?.trim();
  return new Anthropic(workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {});
}

export async function planGoal(goal, { client = createClient(), model = PLANNER_MODEL } = {}) {
  if (!goal?.trim()) throw new PlannerError("Empty goal");
  let response;
  try {
    response = await client.beta.messages.create({
      model,
      max_tokens: 1024,
      // Refusal fallbacks on by default: a policy decline is re-run server-side on
      // Anthropic's recommended fallback model instead of failing the plan.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: `Goal: ${goal}` }],
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new PlannerError("Anthropic credentials missing or invalid (set ANTHROPIC_API_KEY)");
    if (error instanceof Anthropic.RateLimitError) throw new PlannerError("Anthropic rate limit hit; retry shortly");
    if (error instanceof Anthropic.APIError) throw new PlannerError(`Anthropic API error ${error.status}: ${error.message}`);
    // Anything else (e.g. no credentials configured, network failure) never reached the API.
    throw new PlannerError(`Could not call the Anthropic API: ${error.message}. If credentials are missing, set ANTHROPIC_API_KEY in .env.`);
  }
  if (response.stop_reason === "refusal") {
    throw new PlannerError(`Planner declined the goal${response.stop_details?.category ? ` (${response.stop_details.category})` : ""}`);
  }
  if (response.stop_reason === "max_tokens") throw new PlannerError("Planner output was cut off");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  let plan;
  try {
    plan = JSON.parse(text);
  } catch {
    throw new PlannerError("Planner returned invalid JSON");
  }
  if (plan.workflow !== "none" && !WORKFLOW_DESCRIPTIONS[plan.workflow]) {
    throw new PlannerError(`Planner chose an unknown workflow "${plan.workflow}"`);
  }
  return { workflow: plan.workflow, reason: plan.reason, model: response.model };
}
