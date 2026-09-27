// KYC registries the Compliance Agent can query.
// - StubRegistry: the labelled testnet stand-in (fictional identities) used until the
//   GCN KYC registry contract is deployed.
// - ContractRegistry: calls a KYC registry contract on Hedera TESTNET through the JSON-RPC
//   relay (read-only eth_call). The view function is configurable because the registry's
//   ABI is set by the contract, e.g. "isApproved(address)" or "isKYCApproved(address)".
import { Interface, isAddress, getAddress } from "ethers";

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
  constructor({ address, fn = "isApproved(address)", rpcUrl = "https://testnet.hashio.io/api", transport = fetchTransport }) {
    if (!isAddress(address)) throw new Error(`KYC_REGISTRY_ADDRESS is not an EVM address: ${address}`);
    if (!/^\w+\(address\)$/.test(fn)) throw new Error(`KYC_REGISTRY_FUNCTION must look like name(address): ${fn}`);
    this.address = getAddress(address);
    this.fn = fn;
    this.rpcUrl = rpcUrl;
    this.transport = transport;
    this.iface = new Interface([`function ${fn} view returns (bool)`]);
    this.name = fn.slice(0, fn.indexOf("("));
    this.network = null;
  }

  describe() {
    return `contract ${this.address} ${this.fn} on Hedera ${this.network ?? "testnet"}`;
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
    const data = this.iface.encodeFunctionData(this.name, [getAddress(party)]);
    const out = await this.transport(this.rpcUrl, "eth_call", [{ to: this.address, data }, "latest"]);
    return this.iface.decodeFunctionResult(this.name, out)[0] === true;
  }
}

export function registryFromEnv(env, stubJson) {
  if (env.KYC_REGISTRY_ADDRESS) {
    return new ContractRegistry({
      address: env.KYC_REGISTRY_ADDRESS,
      fn: env.KYC_REGISTRY_FUNCTION || undefined,
      rpcUrl: env.HEDERA_JSON_RPC_URL || undefined,
    });
  }
  return new StubRegistry(stubJson);
}
