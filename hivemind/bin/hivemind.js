#!/usr/bin/env node
// GCN HiveMind CLI. Pre-audit · testnet only.
//
//   hivemind run <input.json> [--live]   run a workflow (dry-run unless --live)
//   hivemind verify <run.jsonl>          re-check a saved audit trail's hash chain
//   hivemind verify-topic <0.0.x>        re-check an HCS audit topic from the mirror node
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createHiveMind } from "../src/hivemind.js";
import { DryRunLedger, HcsLedger } from "../src/ledger.js";
import { verifyChain } from "../src/aip01.js";
import { fetchTopic, reassemble } from "../src/mirror.js";

const [cmd, file, ...flags] = process.argv.slice(2);
const live = flags.includes("--live");

function usage() {
  console.log("Usage: hivemind run <input.json> [--live] | hivemind verify <run.jsonl> | hivemind verify-topic <0.0.x>");
  process.exit(2);
}

if (cmd === "verify") {
  if (!file) usage();
  const entries = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const bad = verifyChain(entries.map((e) => e.message));
  console.log(bad === -1 ? `CHAIN VALID — ${entries.length} messages` : `CHAIN BROKEN at message ${bad + 1}`);
  process.exit(bad === -1 ? 0 : 1);
}
if (cmd === "verify-topic") {
  if (!file) usage();
  const network = process.env.HEDERA_NETWORK ?? "testnet";
  let rows;
  try {
    rows = await fetchTopic(file, network);
  } catch (e) {
    console.error(`Could not read topic ${file} from the ${network} mirror node: ${e.cause?.message ?? e.message}`);
    process.exit(2);
  }
  const msgs = reassemble(rows);
  const incomplete = msgs.filter((m) => m.incomplete);
  const byWorkflow = new Map();
  for (const m of msgs.filter((x) => !x.incomplete)) {
    const id = m.message.workflowId ?? "unknown";
    if (!byWorkflow.has(id)) byWorkflow.set(id, []);
    byWorkflow.get(id).push(m.message);
  }
  let ok = incomplete.length === 0;
  console.log(`Topic ${file} (${network}): ${rows.length} sequence numbers → ${msgs.length} AIP-01 messages in ${byWorkflow.size} workflow(s)`);
  for (const [id, list] of byWorkflow) {
    const bad = verifyChain(list);
    const report = list.find((m) => m.task === "REPORT");
    const outcome = report?.result?.outcome ?? "NO REPORT";
    const halted = report?.result?.halted;
    console.log(`  ${id}  ${list.length} messages  chain ${bad === -1 ? "VALID" : `BROKEN at message ${bad + 1}`}  ${outcome}${halted ? ` at ${halted.agent}:${halted.task} (${halted.status})` : ""}`);
    if (bad !== -1) ok = false;
  }
  if (incomplete.length) console.log(`  ${incomplete.length} message(s) missing chunks, starting at sequence ${incomplete.map((m) => m.firstSequence).join(", ")}`);
  console.log(ok ? "TOPIC VERIFIED" : "TOPIC FAILED VERIFICATION");
  process.exit(ok ? 0 : 1);
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
  fs.mkdirSync("runs", { recursive: true });
  fs.writeFileSync(runFile, run.messages.map((message, i) => JSON.stringify({ ...run.receipts[i], message })).join("\n") + "\n");
  const last = run.receipts.at(-1);
  console.log(`\n${run.outcome}${run.halted ? ` at ${run.halted.agent}:${run.halted.task} (${run.halted.status})` : ""}`);
  console.log(`Audit trail: ${run.messages.length} AIP-01 messages, hash chain ${run.chainValid ? "valid" : "BROKEN"}`);
  if (ledger.mode === "hcs") {
    const first = run.receipts[0].sequenceNumber;
    console.log(`HCS topic ${ledger.topicId}: messages start at sequence ${first}, last message at ${last.sequenceNumber} (large messages are split into 1,024-byte chunks, each with its own sequence number)`);
    console.log(`Mirror node: https://testnet.mirrornode.hedera.com/api/v1/topics/${ledger.topicId}/messages`);
    console.log(`Verify on-chain: node bin/hivemind.js verify-topic ${ledger.topicId}`);
    console.log(`Reuse this topic next time: HIVEMIND_TOPIC_ID=${ledger.topicId}`);
  }
  console.log(`Saved ${runFile} (re-check with: node bin/hivemind.js verify ${runFile})`);
} finally {
  await ledger.close();
}
