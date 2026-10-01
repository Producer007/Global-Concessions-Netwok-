// AIP-01: the one message format every agent speaks. Each message is hash-chained to the
// previous one in its workflow, so the audit trail is tamper-evident even before it
// reaches Hedera Consensus Service.
import { createHash, randomUUID } from "node:crypto";

export const AGENTS = ["SUPERVISOR", "CONSENSUS", "TOKENIZATION", "SUPPLY_CHAIN", "COMPLIANCE", "ENERGY"];
export const STATUSES = ["REQUEST", "OK", "FAIL", "GATED", "NOT_IMPLEMENTED"];

// Deterministic JSON (sorted keys) so the same content always hashes the same.
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const sha256 = (s) => createHash("sha256").update(s).digest("hex");

export function createMessage({ workflowId, from, to, task, status = "REQUEST", params = {}, result = null, reason = null, parentId = null, prevHash = null }) {
  if (!AGENTS.includes(from) || !AGENTS.includes(to)) throw new Error(`AIP-01: unknown agent ${from} → ${to}`);
  if (!STATUSES.includes(status)) throw new Error(`AIP-01: unknown status ${status}`);
  const body = { aip: "AIP-01", id: randomUUID(), ts: new Date().toISOString(), workflowId, from, to, task, status, params, result, reason, parentId, prevHash };
  return { ...body, hash: sha256(canonical(body)) };
}

// Re-derives every hash and link; returns the index of the first bad message, or -1.
export function verifyChain(messages) {
  for (let i = 0; i < messages.length; i++) {
    const { hash, ...body } = messages[i];
    if (sha256(canonical(body)) !== hash) return i;
    if (body.prevHash !== (i === 0 ? null : messages[i - 1].hash)) return i;
  }
  return -1;
}
