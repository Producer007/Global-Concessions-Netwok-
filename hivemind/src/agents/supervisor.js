// Supervisor — takes a goal, picks the workflow, runs its steps in order through the
// specialist agents, and halts at the first step that does not return OK. Every request,
// response and the final report is an AIP-01 message recorded by the Consensus Agent.
import { randomUUID } from "node:crypto";
import { createMessage, verifyChain } from "../aip01.js";

export const WORKFLOWS = {
  "track-and-tokenize": (input) => [
    { to: "SUPPLY_CHAIN", task: "LOG_SENSOR_READINGS", params: { shipmentId: input.shipmentId, readings: input.readings } },
    { to: "COMPLIANCE", task: "CHECK_OFFERING", params: { investorClass: input.investorClass ?? "institutional" } },
    { to: "COMPLIANCE", task: "CHECK_COUNTERPARTIES", params: { counterparties: input.counterparties } },
    { to: "TOKENIZATION", task: "MINT", params: { instrument: input.instrument, amount: input.amount } },
  ],
  "energy-accounting": (input) => [{ to: "ENERGY", task: "RECORD_ENERGY_CREDITS", params: { entries: input.entries } }],
  "anchor-document": (input) => [{ to: "CONSENSUS", task: "ANCHOR_DOCUMENT", params: { documentPath: input.documentPath, label: input.label } }],
};

export class Supervisor {
  name = "SUPERVISOR";

  constructor({ consensus, agents }) {
    this.consensus = consensus;
    this.agents = { CONSENSUS: consensus, ...agents };
  }

  async run(input) {
    const plan = WORKFLOWS[input.workflow];
    if (!plan) throw new Error(`Unknown workflow "${input.workflow}". Known: ${Object.keys(WORKFLOWS).join(", ")}`);
    const workflowId = randomUUID();
    const messages = [];
    const receipts = [];
    const send = async (fields) => {
      const msg = createMessage({ workflowId, prevHash: messages.at(-1)?.hash ?? null, ...fields });
      messages.push(msg);
      receipts.push(await this.consensus.record(msg));
      return msg;
    };

    const steps = plan(input);
    await send({ from: "SUPERVISOR", to: "SUPERVISOR", task: "PLAN", params: { goal: input.goal, workflow: input.workflow, steps: steps.map((s) => `${s.to}:${s.task}`) } });

    let halted = null;
    for (const step of steps) {
      const req = await send({ from: "SUPERVISOR", to: step.to, task: step.task, params: step.params });
      const res = await this.agents[step.to].handle(step.task, step.params);
      await send({ from: step.to, to: "SUPERVISOR", task: step.task, status: res.status, result: res.result ?? null, reason: res.reason ?? null, parentId: req.id });
      if (res.status !== "OK") {
        halted = { agent: step.to, task: step.task, status: res.status, reason: res.reason };
        break;
      }
    }

    const outcome = halted ? "HALTED" : "COMPLETED";
    await send({ from: "SUPERVISOR", to: "SUPERVISOR", task: "REPORT", status: halted ? halted.status : "OK", result: { outcome, halted }, reason: halted?.reason ?? null });
    return { workflowId, outcome, halted, messages, receipts, chainValid: verifyChain(messages) === -1 };
  }
}
