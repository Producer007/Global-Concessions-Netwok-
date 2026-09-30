import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { HtsKycRegistry, registryFromEnv, StubRegistry } from "../src/registry.js";
import { createHiveMind, loadConfig } from "../src/hivemind.js";
import { DryRunLedger } from "../src/ledger.js";

const TOKEN = "0.0.5005";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// Stand-in mirror node. `accounts` maps account -> { kyc_status, freeze_status } for TOKEN;
// an account listed with null exists but never associated with the token.
function fakeMirror({ token = { token_id: TOKEN, symbol: "GCN-TST", kyc_key: { _type: "ED25519", key: "ab" } }, accounts = {}, status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (status !== 200) return json(status, {});
    const path = new URL(url).pathname + new URL(url).search;
    const tokenMatch = path.match(/^\/api\/v1\/tokens\/(.+)$/);
    if (tokenMatch) return token && tokenMatch[1] === TOKEN ? json(200, token) : json(404, {});
    const acct = path.match(/^\/api\/v1\/accounts\/([^/]+)\/tokens\?token\.id=(.+)$/);
    if (acct) {
      if (!(acct[1] in accounts)) return json(404, {});
      const rel = accounts[acct[1]];
      return json(200, { tokens: rel ? [{ token_id: acct[2], ...rel }] : [], links: { next: null } });
    }
    return json(404, {});
  };
  return { fetchImpl, calls };
}

test("hts kyc: GRANTED and unfrozen is approved; revoked, frozen, unassociated and unknown are not", async () => {
  const { fetchImpl, calls } = fakeMirror({
    accounts: {
      "0.0.101": { kyc_status: "GRANTED", freeze_status: "UNFROZEN" },
      "0.0.102": { kyc_status: "REVOKED", freeze_status: "UNFROZEN" },
      "0.0.103": { kyc_status: "GRANTED", freeze_status: "FROZEN" },
      "0.0.104": null,
    },
  });
  const reg = new HtsKycRegistry({ tokenId: TOKEN, fetchImpl });
  assert.equal(await reg.isApproved("0.0.101"), true);
  assert.equal(await reg.isApproved("0.0.102"), false);
  assert.equal(await reg.isApproved("0.0.103"), false);
  assert.equal(await reg.isApproved("0.0.104"), false);
  assert.equal(await reg.isApproved("0.0.999"), false);
  assert.ok(calls.every((u) => u.startsWith("https://testnet.mirrornode.hedera.com/api/v1/")));
  assert.equal(calls.filter((u) => u.endsWith(`/tokens/${TOKEN}`)).length, 1, "token looked up once");
  assert.match(reg.describe(), /HTS token 0\.0\.5005 \(GCN-TST\) KYC status on Hedera testnet/);
});

test("hts kyc: fails closed when the token has no KYC key, is missing, or the mirror errors", async () => {
  const noKey = new HtsKycRegistry({ tokenId: TOKEN, fetchImpl: fakeMirror({ token: { token_id: TOKEN, kyc_key: null } }).fetchImpl });
  await assert.rejects(noKey.isApproved("0.0.101"), /no KYC key/);
  const missing = new HtsKycRegistry({ tokenId: TOKEN, fetchImpl: fakeMirror({ token: null }).fetchImpl });
  await assert.rejects(missing.isApproved("0.0.101"), /not found on testnet/);
  const down = new HtsKycRegistry({ tokenId: TOKEN, fetchImpl: fakeMirror({ status: 503 }).fetchImpl });
  await assert.rejects(down.isApproved("0.0.101"), /HTTP 503/);
});

test("hts kyc: validates inputs and refuses non-testnet networks", async () => {
  assert.throws(() => new HtsKycRegistry({ tokenId: "GCN-TST" }), /0\.0\.12345/);
  assert.throws(() => new HtsKycRegistry({ tokenId: TOKEN, network: "mainnet" }), /testnet-only/);
  const reg = new HtsKycRegistry({ tokenId: TOKEN, fetchImpl: fakeMirror().fetchImpl });
  await assert.rejects(reg.isApproved("TEST-COUNTERPARTY-A"), /account ID/);
  // EVM addresses are accepted as counterparties (the mirror node resolves them).
  assert.equal(await reg.isApproved("0x1111111111111111111111111111111111111111"), false);
});

test("hts kyc: registryFromEnv picks the HTS check, and refuses two registries at once", () => {
  assert.ok(registryFromEnv({ KYC_HTS_TOKEN_ID: TOKEN }, { approved: [] }) instanceof HtsKycRegistry);
  assert.throws(() => registryFromEnv({ KYC_HTS_TOKEN_ID: TOKEN, KYC_REGISTRY_ADDRESS: "0x3333333333333333333333333333333333333333" }, { approved: [] }), /not both/);
  assert.throws(() => registryFromEnv({ KYC_HTS_TOKEN_ID: TOKEN, HEDERA_NETWORK: "mainnet" }, { approved: [] }), /testnet-only/);
  assert.ok(registryFromEnv({}, { approved: [] }) instanceof StubRegistry);
});

test("hts kyc: a HiveMind run passes Compliance only when every counterparty is GRANTED, and still halts GATED", async () => {
  const example = JSON.parse(fs.readFileSync(new URL("../examples/gold-dore-shipment.json", import.meta.url)));
  const input = { ...example, counterparties: ["0.0.101", "0.0.102"] };
  const run = (accounts) =>
    createHiveMind(new DryRunLedger(), loadConfig(), {
      registry: new HtsKycRegistry({ tokenId: TOKEN, fetchImpl: fakeMirror({ accounts }).fetchImpl }),
    }).run(input);

  const granted = { kyc_status: "GRANTED", freeze_status: "UNFROZEN" };
  const ok = await run({ "0.0.101": granted, "0.0.102": granted });
  assert.equal(ok.halted.status, "GATED");
  assert.equal(ok.halted.task, "MINT");

  const oneRevoked = await run({ "0.0.101": granted, "0.0.102": { kyc_status: "REVOKED", freeze_status: "UNFROZEN" } });
  assert.equal(oneRevoked.halted.task, "CHECK_COUNTERPARTIES");
  assert.match(oneRevoked.halted.reason, /Not KYC-approved: 0\.0\.102/);
});
