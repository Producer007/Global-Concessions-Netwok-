#!/usr/bin/env node
// Approve test addresses on the deployed GCNKYCRegistry (Hedera TESTNET, pre-audit).
//
// Dry run (default): checks the network and that your key may approve (registry owner or
// authorized verifier), simulates the approval, and shows each address's current status.
// Nothing is sent.
//   node scripts/approve-kyc.js --generate 2
//   node scripts/approve-kyc.js 0xAbc... 0xDef... --tier 2
// Write: add --send. Needs KYC_ADMIN_KEY in .env: the ECDSA key of the registry owner,
// Hedera account 0.0.8204402 (EVM 0xd74265b1…c548), or of an authorized verifier.
//
// Test data only. Approving an address here is a testnet fixture, not a KYC decision about a person.
import "dotenv/config";
import fs from "node:fs";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import {
  DEFAULT_REGISTRY,
  REGISTRY_ABI,
  TIERS,
  generateTestAddresses,
  normalizeEcdsaKey,
  parseArgs,
  planApprovals,
  sendApprovals,
} from "../src/kycAdmin.js";

const EXAMPLE_OUT = new URL("../examples/gold-dore-shipment-registry.json", import.meta.url);
const EXAMPLE_IN = new URL("../examples/gold-dore-shipment.json", import.meta.url);

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const rpcUrl = process.env.HEDERA_JSON_RPC_URL || "https://testnet.hashio.io/api";
  const registryAddress = process.env.KYC_REGISTRY_ADDRESS || DEFAULT_REGISTRY;
  const provider = new JsonRpcProvider(rpcUrl);

  const wallet = process.env.KYC_ADMIN_KEY ? new Wallet(normalizeEcdsaKey(process.env.KYC_ADMIN_KEY), provider) : null;
  if (opts.send && !wallet) throw new Error("--send needs KYC_ADMIN_KEY in .env");

  const addresses = [...opts.addresses, ...generateTestAddresses(opts.generate)];
  const registry = new Contract(registryAddress, REGISTRY_ABI, wallet ?? provider);
  const plan = await planApprovals({
    registry, provider, signerAddress: wallet?.address, addresses,
    tier: opts.tier, jurisdiction: opts.jurisdiction, days: opts.days,
  });

  console.log(`GCNKYCRegistry ${registryAddress} on Hedera ${plan.network} (pre-audit) · owner ${plan.owner}`);
  console.log(`Signer: ${wallet ? `${wallet.address} · may approve: ${plan.canApprove ? "yes" : "NO"}` : "none (KYC_ADMIN_KEY not set)"}`);
  if (plan.simulation) console.log(`Simulated approval: ${plan.simulation}`);
  console.log(`Approve at ${TIERS[opts.tier]} · jurisdiction "${opts.jurisdiction}" · expires in ${opts.days} days\n`);
  for (const r of plan.rows) console.log(`  ${r.address}  currently ${r.verified ? "verified" : "not verified"}`);

  if (!opts.send) {
    console.log("\nDry run: nothing sent. Add --send to write these approvals to testnet.");
    return;
  }
  if (!plan.canApprove) throw new Error(`${wallet.address} is neither the registry owner (${plan.owner}) nor an authorized verifier.`);
  if (plan.simulation !== "ok") throw new Error(`Simulated approval failed (${plan.simulation}); nothing sent.`);

  console.log("\nSending…");
  const results = await sendApprovals({ registry, provider, addresses, tier: opts.tier, jurisdiction: opts.jurisdiction, days: opts.days });
  for (const r of results) {
    console.log(`  ${r.address}  ${r.ok && r.verified ? "APPROVED" : "FAILED"}  tx ${r.hash}`);
    console.log(`    https://testnet.mirrornode.hedera.com/api/v1/contracts/results/${r.hash}`);
  }
  const approved = results.filter((r) => r.ok && r.verified).map((r) => r.address);
  if (approved.length !== results.length) process.exitCode = 1;

  if (opts.example && approved.length >= 2) {
    const example = JSON.parse(fs.readFileSync(EXAMPLE_IN, "utf8"));
    example._note = `${example._note} Counterparties are throwaway test addresses approved on the testnet GCNKYCRegistry at ${TIERS[opts.tier]} on ${new Date().toISOString().slice(0, 10)}; they expire after ${opts.days} days.`;
    example.counterparties = approved.slice(0, 2);
    fs.writeFileSync(EXAMPLE_OUT, JSON.stringify(example, null, 2) + "\n");
    console.log(`\nWrote examples/gold-dore-shipment-registry.json. Run it against the registry with:`);
    console.log(`  KYC_REGISTRY_ADDRESS=${registryAddress} KYC_REGISTRY_FUNCTION='isKYCVerified(address,uint8)' KYC_REGISTRY_TIER=${opts.tier} node bin/hivemind.js run examples/gold-dore-shipment-registry.json`);
  }
}

main().catch((error) => {
  console.error(`approve-kyc: ${error.message}`);
  process.exit(1);
});
