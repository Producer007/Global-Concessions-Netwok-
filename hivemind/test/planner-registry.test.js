import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { AbiCoder } from "ethers";
import { planGoal, PlannerError, PLANNER_MODEL } from "../src/planner.js";
import { ContractRegistry, StubRegistry } from "../src/registry.js";
import { createHiveMind, loadConfig } from "../src/hivemind.js";
import { DryRunLedger } from "../src/ledger.js";

const example = (f) => JSON.parse(fs.readFileSync(new URL(`../examples/${f}`, import.meta.url)));

// Stand-in for the Anthropic client: records the request, returns a canned response.
function fakeClient(response) {
  const calls = [];
  return {
    calls,
    beta: { messages: { create: async (req) => (calls.push(req), { model: req.model, stop_reason: "end_turn", content: [{ type: "text", text: "{}" }], ...response }) } },
  };
}
const answer = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj) }] });

test("planner: request uses claude-opus-5, structured output and default refusal fallbacks", async () => {
  const client = fakeClient(answer({ workflow: "energy-accounting", reason: "kWh accounting" }));
  const p = await planGoal("log last month's solar kWh", { client });
  assert.deepEqual(p, { workflow: "energy-accounting", reason: "kWh accounting", model: PLANNER_MODEL });
  const req = client.calls[0];
  assert.equal(req.model, "claude-opus-5");
  assert.equal(req.fallbacks, "default");
  assert.deepEqual(req.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(req.output_config.format.type, "json_schema");
  assert.deepEqual(req.output_config.format.schema.properties.workflow.enum, ["track-and-tokenize", "energy-accounting", "anchor-document", "none"]);
});

test("planner: rejects unknown workflows, refusals, truncation and bad JSON", async () => {
  await assert.rejects(planGoal("x", { client: fakeClient(answer({ workflow: "mint-now", reason: "r" })) }), PlannerError);
  await assert.rejects(planGoal("x", { client: fakeClient({ stop_reason: "refusal", stop_details: { category: "cyber" } }) }), /declined.*cyber/);
  await assert.rejects(planGoal("x", { client: fakeClient({ stop_reason: "max_tokens" }) }), /cut off/);
  await assert.rejects(planGoal("x", { client: fakeClient({ content: [{ type: "text", text: "not json" }] }) }), /invalid JSON/);
  await assert.rejects(planGoal("  ", { client: fakeClient({}) }), /Empty goal/);
});

test("planner: 'none' is returned, and the Supervisor refuses to run it", async () => {
  const client = fakeClient(answer({ workflow: "none", reason: "Selling tokens is not a workflow" }));
  const p = await planGoal("sell GOLD tokens to the public", { client });
  assert.equal(p.workflow, "none");
  const hm = createHiveMind(new DryRunLedger());
  await assert.rejects(hm.run({ goal: "sell GOLD tokens" }, { planner: (g) => planGoal(g, { client }) }), /No workflow fits/);
});

test("planner-routed run records the planner's model and reason in the PLAN message", async () => {
  const client = fakeClient(answer({ workflow: "energy-accounting", reason: "Solar kWh logging" }));
  const r = await createHiveMind(new DryRunLedger()).run(example("planned-goal.json"), { planner: (g) => planGoal(g, { client }) });
  assert.equal(r.outcome, "COMPLETED");
  assert.deepEqual(r.messages[0].params.plannedBy, { model: "claude-opus-5", reason: "Solar kWh logging" });
  assert.equal(r.messages.find((m) => m.from === "ENERGY").result.totalKWh, 11820);
});

test("a planner cannot bypass a gate: a routed track-and-tokenize still halts GATED", async () => {
  const client = fakeClient(answer({ workflow: "track-and-tokenize", reason: "shipment" }));
  const { workflow, ...input } = example("gold-dore-shipment.json");
  const r = await createHiveMind(new DryRunLedger()).run(input, { planner: (g) => planGoal(g, { client }) });
  assert.equal(r.halted.status, "GATED");
});

// Stand-in JSON-RPC relay: chain id plus an eth_call answering from an approved set.
function fakeRelay({ chainId = 296, approved = [] } = {}) {
  const calls = [];
  const coder = AbiCoder.defaultAbiCoder();
  return {
    calls,
    transport: async (_url, method, params) => {
      calls.push({ method, params });
      if (method === "eth_chainId") return "0x" + chainId.toString(16);
      const addr = "0x" + params[0].data.slice(-40);
      return coder.encode(["bool"], [approved.map((a) => a.toLowerCase()).includes(addr.toLowerCase())]);
    },
  };
}
const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const REG = "0x3333333333333333333333333333333333333333";

test("contract registry: encodes the configured view function and reads the bool", async () => {
  const relay = fakeRelay({ approved: [A] });
  const reg = new ContractRegistry({ address: REG, fn: "isKYCApproved(address)", transport: relay.transport });
  assert.equal(await reg.isApproved(A), true);
  assert.equal(await reg.isApproved(B), false);
  const call = relay.calls.find((c) => c.method === "eth_call");
  assert.equal(call.params[0].to.toLowerCase(), REG);
  assert.match(reg.describe(), /isKYCApproved\(address\) on Hedera testnet/);
});

test("contract registry: refuses non-testnet chains and non-EVM counterparties", async () => {
  const mainnet = new ContractRegistry({ address: REG, transport: fakeRelay({ chainId: 295 }).transport });
  await assert.rejects(mainnet.isApproved(A), /chain 295/);
  const reg = new ContractRegistry({ address: REG, transport: fakeRelay().transport });
  await assert.rejects(reg.isApproved("TEST-COUNTERPARTY-A"), /EVM address/);
  assert.throws(() => new ContractRegistry({ address: "0x12" }), /not an EVM address/);
  assert.throws(() => new ContractRegistry({ address: REG, fn: "approve(address,uint256)" }), /name\(address\)/);
});

test("Compliance with the contract registry: approved passes, unapproved halts, registry errors halt", async () => {
  const input = { ...example("gold-dore-shipment.json"), counterparties: [A, B] };
  const run = (registry) => createHiveMind(new DryRunLedger(), loadConfig(), { registry }).run(input);
  const ok = await run(new ContractRegistry({ address: REG, transport: fakeRelay({ approved: [A, B] }).transport }));
  assert.equal(ok.halted.agent, "TOKENIZATION");
  const missing = await run(new ContractRegistry({ address: REG, transport: fakeRelay({ approved: [A] }).transport }));
  assert.equal(missing.halted.task, "CHECK_COUNTERPARTIES");
  assert.match(missing.halted.reason, new RegExp(B));
  const broken = await run(new ContractRegistry({ address: REG, transport: async () => { throw new Error("relay down"); } }));
  assert.match(broken.halted.reason, /KYC registry check failed: relay down/);
});

test("stub registry is still the default and is labelled as a stub", async () => {
  const r = await createHiveMind(new DryRunLedger()).run(example("gold-dore-shipment.json"));
  const kyc = r.messages.find((m) => m.from === "COMPLIANCE" && m.task === "CHECK_COUNTERPARTIES");
  assert.match(kyc.result.registry, /testnet stub/);
  assert.ok(new StubRegistry({ approved: [] }));
});
