// Wires the six agents together over a ledger (dry-run or HCS).
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { ConsensusAgent } from "./agents/consensus.js";
import { SupplyChainAgent } from "./agents/supplyChain.js";
import { ComplianceAgent } from "./agents/compliance.js";
import { TokenizationAgent } from "./agents/tokenization.js";
import { EnergyAgent } from "./agents/energy.js";
import { Supervisor } from "./agents/supervisor.js";

const configDir = fileURLToPath(new URL("../config/", import.meta.url));
const load = (f) => JSON.parse(fs.readFileSync(configDir + f, "utf8"));

export function loadConfig() {
  return { policy: load("policy.json"), register: load("instruments.json"), registry: load("kyc-registry.testnet.json") };
}

export function createHiveMind(ledger, config = loadConfig()) {
  const consensus = new ConsensusAgent(ledger);
  return new Supervisor({
    consensus,
    agents: {
      SUPPLY_CHAIN: new SupplyChainAgent(config.policy),
      COMPLIANCE: new ComplianceAgent(config.policy, config.registry),
      TOKENIZATION: new TokenizationAgent(config.register),
      ENERGY: new EnergyAgent(),
    },
  });
}
