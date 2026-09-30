// KYC registries the Compliance Agent can query.
// - StubRegistry: the labelled testnet stand-in (fictional identities) used until the
//   GCN KYC registry contract is deployed.
// - HtsKycRegistry: reads each account's native HTS KYC status for one token from the Hedera
//   mirror node (read-only). Approved = KYC GRANTED and not FROZEN on that token.
// - ContractRegistry: calls a KYC registry contract on Hedera TESTNET through the JSON-RPC
//   relay (read-only eth_call). The view function is configurable because the registry's
//   ABI is set by the contract, e.g. "isApproved(address)", or a tiered check such as the
//   deployed GCNKYCRegistry's "isKYCVerified(address,uint8)" with a required tier.
import { Interface, isAddress, getAddress } from "ethers";
import { MIRRORS } from "./mirror.js";

export class StubRegistry {
  constructor(json) {
    this.approved = new Set(json.approved);
  }

  describe() {
    return "testnet stub (fictional identities)";
  }

  async isApproved(party) {
    return this.approved.has(party);
  }
}

const ALLOWED_CHAINS = { 296: "testnet", 297: "previewnet" };

async function fetchTransport(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`JSON-RPC HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`JSON-RPC error: ${body.error.message}`);
  return body.result;
}

export class ContractRegistry {
  constructor({ address, fn = "isApproved(address)", tier, rpcUrl = "https://testnet.hashio.io/api", transport = fetchTransport }) {
    if (!isAddress(address)) throw new Error(`KYC_REGISTRY_ADDRESS is not an EVM address: ${address}`);
    if (!/^\w+\(address(,uint8)?\)$/.test(fn)) {
      throw new Error(`KYC_REGISTRY_FUNCTION must look like name(address) or name(address,uint8): ${fn}`);
    }
    this.tiered = fn.endsWith(",uint8)");
    if (this.tiered) {
      const t = Number(tier);
      if (tier === undefined || tier === "" || !Number.isInteger(t) || t < 0 || t > 255) {
        throw new Error(`KYC_REGISTRY_TIER must be an integer 0-255 for ${fn}: ${tier}`);
      }
      this.tier = t;
    }
    this.address = getAddress(address);
    this.fn = fn;
    this.rpcUrl = rpcUrl;
    this.transport = transport;
    this.iface = new Interface([`function ${fn} view returns (bool)`]);
    this.name = fn.slice(0, fn.indexOf("("));
    this.network = null;
  }

  describe() {
    const tier = this.tiered ? ` tier ${this.tier}` : "";
    return `contract ${this.address} ${this.fn}${tier} on Hedera ${this.network ?? "testnet"}`;
  }

  async #checkChain() {
    if (this.network) return;
    const id = parseInt(await this.transport(this.rpcUrl, "eth_chainId", []), 16);
    if (!ALLOWED_CHAINS[id]) throw new Error(`Refusing KYC registry on chain ${id}: HiveMind is testnet-only`);
    this.network = ALLOWED_CHAINS[id];
  }

  async isApproved(party) {
    if (!isAddress(party)) throw new Error(`Counterparty must be an EVM address for the contract registry: ${party}`);
    await this.#checkChain();
    const args = this.tiered ? [getAddress(party), this.tier] : [getAddress(party)];
    const data = this.iface.encodeFunctionData(this.name, args);
    const out = await this.transport(this.rpcUrl, "eth_call", [{ to: this.address, data }, "latest"]);
    return this.iface.decodeFunctionResult(this.name, out)[0] === true;
  }
}

const ACCOUNT_ID = /^0\.0\.\d+$/;

export class HtsKycRegistry {
  constructor({ tokenId, network = "testnet", fetchImpl = fetch }) {
    if (!ACCOUNT_ID.test(String(tokenId))) throw new Error(`KYC_HTS_TOKEN_ID must look like 0.0.12345: ${tokenId}`);
    if (!MIRRORS[network]) throw new Error(`Refusing HTS KYC check on "${network}": HiveMind is testnet-only`);
    this.tokenId = tokenId;
    this.network = network;
    this.base = `${MIRRORS[network]}/api/v1`;
    this.fetch = fetchImpl;
    this.token = null;
  }

  describe() {
    const symbol = this.token?.symbol ? ` (${this.token.symbol})` : "";
    return `HTS token ${this.tokenId}${symbol} KYC status on Hedera ${this.network} via mirror node`;
  }

  async #get(path) {
    const res = await this.fetch(this.base + path, { signal: AbortSignal.timeout(20000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Mirror node HTTP ${res.status} for ${path}`);
    return res.json();
  }

  // Fail closed: a token without a KYC key cannot tell approved from unapproved accounts.
  async #checkToken() {
    if (this.token) return;
    const token = await this.#get(`/tokens/${this.tokenId}`);
    if (!token) throw new Error(`HTS token ${this.tokenId} not found on ${this.network}`);
    if (!token.kyc_key) throw new Error(`HTS token ${this.tokenId} has no KYC key, so KYC status cannot be checked`);
    this.token = token;
  }

  /** Counterparty: a Hedera account ID (0.0.x) or an EVM address. */
  async isApproved(party) {
    if (!ACCOUNT_ID.test(party) && !isAddress(party)) {
      throw new Error(`Counterparty must be a Hedera account ID (0.0.x) or EVM address for the HTS KYC check: ${party}`);
    }
    await this.#checkToken();
    const rel = await this.#get(`/accounts/${party}/tokens?token.id=${this.tokenId}`);
    const row = rel?.tokens?.find((t) => t.token_id === this.tokenId);
    // No account, or not associated with the token: not approved.
    return row?.kyc_status === "GRANTED" && row?.freeze_status !== "FROZEN";
  }
}

export function registryFromEnv(env, stubJson) {
  if (env.KYC_HTS_TOKEN_ID && env.KYC_REGISTRY_ADDRESS) {
    throw new Error("Set KYC_HTS_TOKEN_ID or KYC_REGISTRY_ADDRESS, not both");
  }
  if (env.KYC_HTS_TOKEN_ID) {
    return new HtsKycRegistry({ tokenId: env.KYC_HTS_TOKEN_ID, network: env.HEDERA_NETWORK || "testnet" });
  }
  if (env.KYC_REGISTRY_ADDRESS) {
    return new ContractRegistry({
      address: env.KYC_REGISTRY_ADDRESS,
      fn: env.KYC_REGISTRY_FUNCTION || undefined,
      tier: env.KYC_REGISTRY_TIER,
      rpcUrl: env.HEDERA_JSON_RPC_URL || undefined,
    });
  }
  return new StubRegistry(stubJson);
}
