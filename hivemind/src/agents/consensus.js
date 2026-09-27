// Consensus Agent — Hedera Consensus Service. Writes every AIP-01 message to the audit
// ledger and anchors document hashes (never document content).
import fs from "node:fs";
import { createHash } from "node:crypto";

export class ConsensusAgent {
  name = "CONSENSUS";

  constructor(ledger) {
    this.ledger = ledger;
  }

  record(message) {
    return this.ledger.submit(message);
  }

  async handle(task, params) {
    if (task !== "ANCHOR_DOCUMENT") return { status: "FAIL", reason: `Unknown task ${task}` };
    if (!params.documentPath || !fs.existsSync(params.documentPath)) {
      return { status: "FAIL", reason: `Document not found: ${params.documentPath}` };
    }
    const bytes = fs.readFileSync(params.documentPath);
    return {
      status: "OK",
      result: { label: params.label ?? null, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length },
    };
  }
}
