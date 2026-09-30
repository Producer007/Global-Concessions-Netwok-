// KYC admin helpers for the deployed GCNKYCRegistry on Hedera TESTNET (pre-audit).
// Used by scripts/approve-kyc.js. Writes only happen in sendApprovals(), which the script
// calls only with --send. Every function refuses any chain but testnet (296) / previewnet (297).
//
// The DEPLOYED registry (19 Mar 2026) is NOT the GCNKYCRegistry.sol now in gcn-exchange/contracts.
// Its interface was read from the on-chain bytecode on 29 Sep 2026 (no verified source exists):
// Ownable, approvals via verifyInvestor(address,uint8,string,uint256) by the owner or an
// authorized verifier, checks via isKYCVerified(address,uint8). No roles, no pause. The last
// verifyInvestor argument is taken to be validity in days (the bytecode multiplies by 86400);
// sendApprovals() confirms every approval by reading it back, so a wrong reading shows as FAILED.
import { Wallet, getAddress, isAddress } from "ethers";

export const DEFAULT_REGISTRY = "0xB503f7f03B2f40d69f5C41D728FBC956c7Ea0A68"; // 0.0.8285495, deployed 19 Mar 2026
export const ALLOWED_CHAINS = { 296: "testnet", 297: "previewnet" };
export const TIERS = { 1: "TIER_1", 2: "TIER_2", 3: "TIER_3" }; // 0 = NONE is not an approval

export const REGISTRY_ABI = [
  "function owner() view returns (address)",
  "function authorizedVerifiers(address) view returns (bool)",
  "function isKYCVerified(address user, uint8 requiredTier) view returns (bool)",
  "function verifyInvestor(address user, uint8 tier, string jurisdiction, uint256 validityDays)",
];

/** Accepts a raw 32-byte hex key (with or without 0x) or the DER form the Hedera portal shows for ECDSA keys. */
export function normalizeEcdsaKey(raw) {
  let hex = String(raw ?? "").trim().replace(/^0x/i, "");
  const DER_PREFIX = "3030020100300706052b8104000a04220420"; // ECDSA secp256k1 private key, DER
  if (hex.toLowerCase().startsWith(DER_PREFIX)) hex = hex.slice(DER_PREFIX.length);
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("KYC_ADMIN_KEY must be an ECDSA secp256k1 private key: 64 hex characters, or its DER form (3030…)");
  }
  return "0x" + hex;
}

export function parseArgs(argv) {
  const opts = { addresses: [], generate: 0, tier: 2, jurisdiction: "TEST", days: 30, send: false, example: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === "--send") opts.send = true;
    else if (a === "--no-example") opts.example = false;
    else if (a === "--generate") opts.generate = Number(next());
    else if (a === "--tier") opts.tier = Number(next());
    else if (a === "--jurisdiction") opts.jurisdiction = next();
    else if (a === "--days") opts.days = Number(next());
    else if (a.startsWith("--")) throw new Error(`Unknown option ${a}`);
    else opts.addresses.push(a);
  }
  if (!TIERS[opts.tier]) throw new Error(`--tier must be 1, 2 or 3 (got ${opts.tier})`);
  if (!Number.isInteger(opts.days) || opts.days < 1 || opts.days > 365) {
    throw new Error("--days must be 1-365 (testnet approvals should expire; 0 = never is not allowed here)");
  }
  if (!Number.isInteger(opts.generate) || opts.generate < 0 || opts.generate > 10) throw new Error("--generate must be 0-10");
  for (const addr of opts.addresses) if (!isAddress(addr)) throw new Error(`Not an EVM address: ${addr}`);
  opts.addresses = opts.addresses.map((a) => getAddress(a));
  if (!opts.addresses.length && !opts.generate) throw new Error("Give one or more EVM addresses, or --generate N");
  return opts;
}

/** Fresh throwaway addresses for testing. Their keys are discarded: the registry only checks the address. */
export function generateTestAddresses(n) {
  return Array.from({ length: n }, () => Wallet.createRandom().address);
}

export async function assertTestnet(provider) {
  const { chainId } = await provider.getNetwork();
  const network = ALLOWED_CHAINS[Number(chainId)];
  if (!network) throw new Error(`Refusing chain ${chainId}: KYC approvals are testnet-only`);
  return network;
}

/**
 * Read-only: the owner, whether the signer may approve (owner or authorized verifier), each
 * address's current status and, when a signer can approve, a simulated (eth_call) approval of
 * the first address so a revert shows up before anything is sent.
 */
export async function planApprovals({ registry, provider, signerAddress, addresses, tier, jurisdiction = "TEST", days = 30 }) {
  const network = await assertTestnet(provider);
  const owner = getAddress(await registry.owner());
  let canApprove = null;
  if (signerAddress) {
    const signer = getAddress(signerAddress);
    canApprove = signer === owner || (await registry.authorizedVerifiers(signer));
  }
  const rows = [];
  for (const address of addresses) rows.push({ address, verified: await registry.isKYCVerified(address, tier) });
  let simulation = null;
  if (canApprove && addresses.length) {
    try {
      await registry.verifyInvestor.staticCall(addresses[0], tier, jurisdiction, days);
      simulation = "ok";
    } catch (error) {
      simulation = `reverts: ${error.shortMessage ?? error.message}`;
    }
  }
  return { network, owner, canApprove, simulation, rows };
}

/** Writes: one verifyInvestor per address, then reads the status back to confirm it took effect. */
export async function sendApprovals({ registry, provider, addresses, tier, jurisdiction, days, gasLimit = 250_000n }) {
  await assertTestnet(provider);
  const results = [];
  for (const address of addresses) {
    const tx = await registry.verifyInvestor(address, tier, jurisdiction, days, { gasLimit });
    const receipt = await tx.wait();
    const verified = await registry.isKYCVerified(address, tier);
    results.push({ address, hash: tx.hash, ok: receipt?.status === 1, verified });
  }
  return results;
}
