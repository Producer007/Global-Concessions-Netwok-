import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHiveMind, loadConfig } from "../src/hivemind.js";
import { DryRunLedger } from "../src/ledger.js";
import { createMessage, verifyChain } from "../src/aip01.js";
import { detectAnomalies } from "../src/agents/supplyChain.js";

const example = (f) => JSON.parse(fs.readFileSync(new URL(`../examples/${f}`, import.meta.url)));
const run = (input) => createHiveMind(new DryRunLedger()).run(input);

test("gold doré illustration halts at the Tokenization gate — $GOLD is Pre-Classification", async () => {
  const r = await run(example("gold-dore-shipment.json"));
  assert.equal(r.outcome, "HALTED");
  assert.equal(r.halted.agent, "TOKENIZATION");
  assert.equal(r.halted.status, "GATED");
  assert.match(r.halted.reason, /Pre-Classification/);
  const done = r.messages.filter((m) => m.status === "OK").map((m) => m.task);
  assert.deepEqual(done, ["LOG_SENSOR_READINGS", "CHECK_OFFERING", "CHECK_COUNTERPARTIES"]);
  assert.equal(r.chainValid, true);
  assert.equal(r.receipts.length, r.messages.length); // every message recorded
});

test("no instrument can be minted today: every register entry is gated", async () => {
  const { register } = loadConfig();
  for (const ticker of Object.keys(register.instruments)) {
    const input = { ...example("gold-dore-shipment.json"), instrument: ticker };
    const r = await run(input);
    assert.equal(r.halted.status, "GATED", ticker);
    assert.equal(r.messages.some((m) => m.result?.minted === true), false);
  }
});

test("retail offering halts at Compliance before any mint step", async () => {
  const r = await run(example("retail-offering.json"));
  assert.equal(r.halted.agent, "COMPLIANCE");
  assert.equal(r.halted.task, "CHECK_OFFERING");
  assert.equal(r.messages.some((m) => m.to === "TOKENIZATION"), false);
});

test("an unapproved counterparty halts at Compliance", async () => {
  const r = await run({ ...example("gold-dore-shipment.json"), counterparties: ["TEST-COUNTERPARTY-A", "UNKNOWN-X"] });
  assert.equal(r.halted.task, "CHECK_COUNTERPARTIES");
  assert.match(r.halted.reason, /UNKNOWN-X/);
});

test("a custody temperature spike halts at Supply-Chain", async () => {
  const input = example("gold-dore-shipment.json");
  input.readings.at(-1).temperatureC = 31.8;
  const r = await run(input);
  assert.equal(r.halted.agent, "SUPPLY_CHAIN");
  assert.equal(r.messages.some((m) => m.to === "COMPLIANCE"), false);
});

test("anomaly detection: range breach and z-score spike are flagged, steady data is not", () => {
  const { sensors } = loadConfig().policy;
  const steady = Array.from({ length: 10 }, (_, i) => ({ ts: `t${i}`, temperatureC: 24 + (i % 2) * 0.2, humidityPct: 60 }));
  assert.equal(detectAnomalies(steady, sensors).length, 0);
  const spike = [...steady, { ts: "t10", temperatureC: 29, humidityPct: 60 }];
  assert.equal(detectAnomalies(spike, sensors).some((a) => a.index === 10 && a.field === "temperatureC"), true);
  const range = [{ ts: "a", temperatureC: 70, humidityPct: 60 }];
  assert.match(detectAnomalies(range, sensors)[0].rule, /outside range/);
});

test("energy accounting totals entries and creates no token", async () => {
  const r = await run(example("net8-credits.json"));
  assert.equal(r.outcome, "COMPLETED");
  const res = r.messages.find((m) => m.from === "ENERGY");
  assert.equal(res.result.totalKWh, 12500);
  assert.match(res.result.note, /No NET8 token/);
});

test("anchor-document records only the document hash", async () => {
  const path = new URL("../package.json", import.meta.url).pathname;
  const r = await run({ goal: "anchor", workflow: "anchor-document", documentPath: path, label: "package.json" });
  const res = r.messages.find((m) => m.from === "CONSENSUS");
  assert.match(res.result.sha256, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(r.messages).includes('"dependencies"'), false);
});

test("AIP-01 hash chain detects tampering", async () => {
  const r = await run(example("net8-credits.json"));
  assert.equal(verifyChain(r.messages), -1);
  const tampered = r.messages.map((m) => ({ ...m }));
  tampered[2] = { ...tampered[2], result: { ...tampered[2].result, totalKWh: 99999 } };
  assert.equal(verifyChain(tampered), 2);
});

test("AIP-01 rejects unknown agents and statuses", () => {
  assert.throws(() => createMessage({ workflowId: "w", from: "ROGUE", to: "SUPERVISOR", task: "X" }));
  assert.throws(() => createMessage({ workflowId: "w", from: "SUPERVISOR", to: "ENERGY", task: "X", status: "DONE" }));
});
