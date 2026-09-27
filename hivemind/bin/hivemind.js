#!/usr/bin/env node
// GCN HiveMind CLI. Pre-audit · testnet only.
//
//   hivemind run <input.json> [--live]   run a workflow (dry-run unless --live)
//   hivemind verify <run.jsonl>          re-check a saved audit trail's hash chain
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createHiveMind } from "../src/hivemind.js";
import { DryRunLedger, HcsLedger } from "../src/ledger.js";
import { verifyChain } from "../src/aip01.js";

const [cmd, file, ...flags] = process.argv.slice(2);
const live = flags.includes("--live");

function usage() {
  console.log("Usage: hivemind run <input.json> [--live] | hivemind verify <run.jsonl>");
  process.exit(2);
}

if (cmd === "verify") {
  if (!file) usage();
  const entries = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const bad = verifyChain(entries.map((e) => e.message));
  console.log(bad === -1 ? `CHAIN VALID — ${entries.length} messages` : `CHAIN BROKEN at message ${bad + 1}`);
  process.exit(bad === -1 ? 0 : 1);
}
if (cmd !== "run" || !file) usage();

const input = JSON.parse(fs.readFileSync(file, "utf8"));
if (input.documentPath) input.documentPath = path.resolve(path.dirname(file), "..", input.documentPath);

const runFile = path.join("runs", `${new Date().toISOString().replace(/[:.]/g, "-")}-${input.workflow}.jsonl`);
let ledger;
if (live) {
  const { HEDERA_NETWORK = "testnet", HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, HIVEMIND_TOPIC_ID } = process.env;
  if (!HEDERA_OPERATOR_ID || !HEDERA_OPERATOR_KEY) {
    console.error("--live needs HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY in .env");
    process.exit(2);
  }
  try {
    ledger = await HcsLedger.open({ network: HEDERA_NETWORK, operatorId: HEDERA_OPERATOR_ID, operatorKey: HEDERA_OPERATOR_KEY, topicId: HIVEMIND_TOPIC_ID });
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
} else {
  ledger = new DryRunLedger({ file: runFile });
}

console.log(`GCN HiveMind · ${ledger.mode === "hcs" ? `LIVE on ${process.env.HEDERA_NETWORK ?? "testnet"} · HCS topic ${ledger.topicId}` : "DRY RUN (nothing sent to Hedera)"}`);
console.log(`Goal: ${input.goal}\n`);

try {
  const run = await createHiveMind(ledger).run(input);
  for (const m of run.messages) {
    if (m.task === "PLAN") console.log(`PLAN     ${m.params.steps.join(" → ")}`);
    else if (m.status === "REQUEST") continue;
    else if (m.task === "REPORT") continue;
    else console.log(`${m.status.padEnd(8)} ${m.from}:${m.task}${m.reason ? ` — ${m.reason}` : ""}`);
  }
  if (ledger.mode !== "hcs") fs.writeFileSync(runFile, run.messages.map((message, i) => JSON.stringify({ ...run.receipts[i], message })).join("\n") + "\n");
  const last = run.receipts.at(-1);
  console.log(`\n${run.outcome}${run.halted ? ` at ${run.halted.agent}:${run.halted.task} (${run.halted.status})` : ""}`);
  console.log(`Audit trail: ${run.messages.length} AIP-01 messages, hash chain ${run.chainValid ? "valid" : "BROKEN"}`);
  if (ledger.mode === "hcs") {
    console.log(`HCS topic ${ledger.topicId}, sequence 1–${last.sequenceNumber}: https://testnet.mirrornode.hedera.com/api/v1/topics/${ledger.topicId}/messages`);
    console.log(`Reuse this topic next time: HIVEMIND_TOPIC_ID=${ledger.topicId}`);
  } else {
    console.log(`Saved ${runFile} (re-check with: node bin/hivemind.js verify ${runFile})`);
  }
} finally {
  await ledger.close();
}
