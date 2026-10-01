import { test } from "node:test";
import assert from "node:assert/strict";
import { isAddress } from "ethers";
import {
  generateTestAddresses,
  normalizeEcdsaKey,
  parseArgs,
  planApprovals,
  sendApprovals,
} from "../src/kycAdmin.js";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const ADMIN = "0x3333333333333333333333333333333333333333";
const KEY = "ab".repeat(32);

const provider = (chainId = 296) => ({ getNetwork: async () => ({ chainId: BigInt(chainId) }) });

// Stand-in for the deployed registry: Ownable, verifyInvestor / isKYCVerified, authorized verifiers.
function fakeRegistry({ owner = ADMIN, verifiers = [], revertReason = null } = {}) {
  const approved = new Map();
  const sent = [];
  const verifyInvestor = async (who, tier, jurisdiction, days, overrides) => {
    sent.push({ who, tier, jurisdiction, days, gasLimit: overrides.gasLimit });
    approved.set(who, tier);
    return { hash: `0xtx${sent.length}`, wait: async () => ({ status: 1 }) };
  };
  verifyInvestor.staticCall = async () => {
    if (revertReason) throw Object.assign(new Error(revertReason), { shortMessage: revertReason });
  };
  return {
    sent,
    owner: async () => owner,
    authorizedVerifiers: async (who) => verifiers.includes(who),
    isKYCVerified: async (who, tier) => (approved.get(who) ?? 0) >= tier,
    verifyInvestor,
  };
}

test("kyc admin: normalizes raw and DER-encoded ECDSA keys, rejects others", () => {
  assert.equal(normalizeEcdsaKey(KEY), "0x" + KEY);
  assert.equal(normalizeEcdsaKey("0x" + KEY), "0x" + KEY);
  assert.equal(normalizeEcdsaKey("3030020100300706052b8104000a04220420" + KEY), "0x" + KEY);
  assert.throws(() => normalizeEcdsaKey("302e020100300506032b657004220420" + KEY), /ECDSA/); // ED25519 DER
  assert.throws(() => normalizeEcdsaKey(""), /ECDSA/);
});

test("kyc admin: parses options and refuses unsafe values", () => {
  const o = parseArgs([A.toLowerCase(), "--tier", "3", "--days", "7", "--send"]);
  assert.deepEqual([o.addresses, o.tier, o.days, o.send], [[A], 3, 7, true]);
  assert.equal(parseArgs(["--generate", "2"]).generate, 2);
  assert.throws(() => parseArgs([]), /--generate/);
  assert.throws(() => parseArgs([A, "--tier", "0"]), /tier/);
  assert.throws(() => parseArgs([A, "--days", "0"]), /days/);
  assert.throws(() => parseArgs(["not-an-address"]), /EVM address/);
  assert.throws(() => parseArgs([A, "--mainnet"]), /Unknown option/);
});

test("kyc admin: generates distinct valid addresses", () => {
  const addrs = generateTestAddresses(3);
  assert.equal(new Set(addrs).size, 3);
  assert.ok(addrs.every((a) => isAddress(a)));
});

test("kyc admin: plan is read-only; owner or authorized verifier may approve; simulation runs first", async () => {
  const registry = fakeRegistry({ verifiers: [B] });
  const plan = await planApprovals({ registry, provider: provider(), signerAddress: ADMIN, addresses: [A], tier: 2 });
  assert.deepEqual(plan, { network: "testnet", owner: ADMIN, canApprove: true, simulation: "ok", rows: [{ address: A, verified: false }] });
  assert.equal(registry.sent.length, 0);
  assert.equal((await planApprovals({ registry, provider: provider(), signerAddress: B, addresses: [A], tier: 2 })).canApprove, true);
  const stranger = await planApprovals({ registry, provider: provider(), signerAddress: A, addresses: [A], tier: 2 });
  assert.deepEqual([stranger.canApprove, stranger.simulation], [false, null]);
  const noKey = await planApprovals({ registry, provider: provider(), addresses: [A], tier: 2 });
  assert.equal(noKey.canApprove, null);
  const reverting = fakeRegistry({ revertReason: "Not authorized" });
  const r = await planApprovals({ registry: reverting, provider: provider(), signerAddress: ADMIN, addresses: [A], tier: 2 });
  assert.equal(r.simulation, "reverts: Not authorized");
});

test("kyc admin: refuses mainnet for both plan and send", async () => {
  const registry = fakeRegistry();
  await assert.rejects(planApprovals({ registry, provider: provider(295), addresses: [A], tier: 2 }), /chain 295/);
  await assert.rejects(sendApprovals({ registry, provider: provider(295), addresses: [A], tier: 2, jurisdiction: "TEST", days: 30 }), /chain 295/);
  assert.equal(registry.sent.length, 0);
});

test("kyc admin: send approves each address and confirms by reading back", async () => {
  const registry = fakeRegistry();
  const results = await sendApprovals({ registry, provider: provider(), addresses: [A, B], tier: 2, jurisdiction: "TEST", days: 30 });
  assert.deepEqual(registry.sent.map((s) => [s.who, s.tier, s.jurisdiction, s.days]), [[A, 2, "TEST", 30], [B, 2, "TEST", 30]]);
  assert.ok(registry.sent.every((s) => s.gasLimit > 0n));
  assert.deepEqual(results.map((r) => [r.address, r.ok, r.verified]), [[A, true, true], [B, true, true]]);
});
