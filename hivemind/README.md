# GCN HiveMind

**Pre-audit · Testnet only · Not connected to GCNAtomicSwapV2 or any production system.**

GCN HiveMind is a six-agent orchestration layer for the on-chain steps of a tokenization event. A Supervisor takes a goal, breaks it into steps, delegates each step to a specialist agent, and halts at the first step that does not pass. Every request, response and report is an AIP-01 message: hash-chained locally, and in `--live` mode written to a Hedera Consensus Service (HCS) topic on testnet.

This is the first code built against the *HiveMind Conceptual Agent Architecture* (27 Sep 2026). The orchestration and the audit trail run. The Tokenization Agent's mint step does not exist, and will not until an instrument's gate clears and the contract suite is audited.

## Agents

| Agent | Hedera service | What runs today | What does not |
|---|---|---|---|
| Supervisor | none | Runs a workflow's steps in order, halts on the first non-OK result, reports. A plain-English goal with no named workflow is routed by the planner (Claude) | The planner choosing parameters or steps: it only picks a workflow name |
| Consensus | HCS | Records every AIP-01 message; anchors a document's SHA-256 (never its content) | n/a |
| Supply-Chain | HCS (via Consensus) | Validates custody sensor readings; flags range breaches and z-score spikes; halts on any anomaly | Live sensor feeds (readings come from the input file) |
| Compliance | HTS / Smart Contract Service | Blocks retail-targeted offerings; checks counterparties against one of: native HTS KYC status for a token (`KYC_HTS_TOKEN_ID`), the KYC registry contract on testnet (`KYC_REGISTRY_ADDRESS`), or the labelled stub list when neither is set | Approved identities: `GCNKYCRegistry` is deployed on testnet (`0.0.8285495`) but has no verified addresses yet, so runs default to the **testnet stub** (fictional identities) |
| Tokenization | HTS | Checks the instrument register; returns `GATED` for every instrument today | Any mint. The HTS mint path is **not implemented** |
| Energy | HTS (planned) | NET8 energy-credit accounting: validates and totals kWh entries | A NET8 token or a kWh-to-credit rate (none has been set) |

## Workflows

| Workflow | Steps |
|---|---|
| `track-and-tokenize` | Supply-Chain `LOG_SENSOR_READINGS` → Compliance `CHECK_OFFERING` → Compliance `CHECK_COUNTERPARTIES` → Tokenization `MINT` |
| `energy-accounting` | Energy `RECORD_ENERGY_CREDITS` |
| `anchor-document` | Consensus `ANCHOR_DOCUMENT` |

The instrument register (`config/instruments.json`) mirrors the Token Register in the Platform Page Copy (v3, 28 Sep 2026; the register is unchanged from v2). All five instruments ($JETA, $GOLD, $BROWN, $NET8, $OIL) are gated, so `track-and-tokenize` always ends `HALTED at TOKENIZATION:MINT (GATED)` with the instrument's gate as the reason. That is the correct result today.

## Run

```bash
cd hivemind
npm install
npm test                                              # 33 tests
node bin/hivemind.js run examples/gold-dore-shipment.json   # dry run: nothing sent to Hedera
node bin/hivemind.js verify runs/<file>.jsonl               # re-check a saved trail's hash chain
node bin/hivemind.js verify-topic 0.0.10748998              # re-check the on-chain trail via the mirror node
```

Example inputs (all fictional test data):

| File | Expected outcome |
|---|---|
| `examples/gold-dore-shipment.json` | Readings, offering and KYC pass; halts `GATED`: $GOLD is Pre-Classification |
| `examples/retail-offering.json` | Halts at Compliance `CHECK_OFFERING`; Tokenization is never called |
| `examples/net8-credits.json` | Completes: 12,500 kWh recorded, no token |
| `examples/anchor-document.json` | Completes: this README's SHA-256 anchored |

### Plain-English goals (planner)

```bash
node bin/hivemind.js plan "log last month's solar output for NET8 accounting"
node bin/hivemind.js run examples/planned-goal.json      # input has no "workflow": the planner picks
```

The planner sends the goal to Claude (`claude-opus-5`, low effort, structured JSON output) and gets back one workflow name from a fixed list, or `none`, plus a one-sentence reason. Its choice and reason are written into the run's PLAN message, so the audit trail shows the model decided the route. Guard rails:

- It only chooses a workflow name. It never sets parameters or runs a step, and the Supervisor still runs the workflow's fixed steps, so every gate still applies (a test checks that a planner-routed run still halts `GATED`).
- An answer outside the list is rejected; `none` stops before anything runs.
- Refusal fallbacks are on (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`): if the model declines on policy grounds, the API re-runs the request on Anthropic's recommended fallback model. A final refusal stops the run.
- Needs `ANTHROPIC_API_KEY` in `.env`. Each plan is one short API call. Named workflows (`"workflow"` in the input) never call the API. If your key is not scoped to a workspace, also set `ANTHROPIC_WORKSPACE_ID`.

### Native HTS KYC (token KYC key)

```bash
KYC_HTS_TOKEN_ID=0.0.xxxxx     # an HTS token created with a KYC key, on Hedera testnet
```

The Compliance Agent then reads each counterparty's KYC status for that token from the testnet mirror node (`/api/v1/accounts/{id}/tokens?token.id=…`). Read-only; no key needed. A counterparty (Hedera account ID `0.0.x` or EVM address) passes only if its KYC is `GRANTED` and it is not `FROZEN` on the token. An account that never associated with the token, or does not exist, fails. It fails closed: a token with no KYC key, a missing token or a mirror-node error halts the run at Compliance. Setting both `KYC_HTS_TOKEN_ID` and `KYC_REGISTRY_ADDRESS` is refused.

This is the network-enforced model from Hedera's [HTS KYC tutorial](https://docs.hedera.com/native/tutorials/tokens/hts-part2-kyc): KYC is granted per token, per account, by the token's KYC key. It does not apply to GCN's 19 Mar 2026 testnet contracts, which are ERC-20 smart contracts rather than HTS tokens. No GCN HTS token exists yet. On 29 Sep 2026 the check was run against a third-party testnet token with a KYC key (`0.0.10784685`): a holder with KYC granted passed, and an unassociated account failed.

### KYC registry contract

Set these in `.env` and the Compliance Agent queries the contract instead of the stub:

```bash
KYC_REGISTRY_ADDRESS=0xB503f7f03B2f40d69f5C41D728FBC956c7Ea0A68   # GCNKYCRegistry, testnet 0.0.8285495
KYC_REGISTRY_FUNCTION=isKYCVerified(address,uint8)                  # view function returning bool
KYC_REGISTRY_TIER=2                                                 # required tier, for name(address,uint8) functions
```

`KYC_REGISTRY_FUNCTION` accepts `name(address)` or a tiered `name(address,uint8)`; the tiered form needs `KYC_REGISTRY_TIER`.

Each counterparty must then be an EVM address. The check is a read-only `eth_call` through the Hedera JSON-RPC relay. It refuses to run unless the relay reports chain 296 (testnet) or 297 (previewnet), and any registry error halts the workflow at Compliance. On 29 Sep 2026 the adapter queried the deployed `GCNKYCRegistry` (pre-audit, deployed 19 Mar 2026) on testnet: the chain check passed and `isKYCVerified(address, 2)` returned `false` for every address tried, because no address has been approved yet. Approving test addresses needs the registry owner, account `0.0.8204402` (see *Approving test addresses* below); HiveMind's operator `0.0.10717267` is a different account. Until addresses are approved, pointing HiveMind at the registry halts every run at Compliance, which is correct.

### Approving test addresses on the registry

`scripts/approve-kyc.js` approves throwaway test addresses on the deployed registry so the Compliance Agent has something real to check. **The deployed registry is not the `GCNKYCRegistry.sol` in gcn-exchange**: its interface was read from the on-chain bytecode (no verified source exists). It is Ownable, approves with `verifyInvestor(address,uint8,string,uint256)` (owner or authorized verifier) and checks with `isKYCVerified(address,uint8)`. Owner: account `0.0.8204402` (EVM `0xd74265b1…c548`), not HiveMind's operator.

```bash
node scripts/approve-kyc.js --generate 2            # dry run: checks testnet, owner, simulates; sends nothing
node scripts/approve-kyc.js --generate 2 --send     # needs KYC_ADMIN_KEY (owner's ECDSA key) in .env
```

`--send` sends one approval per address (TIER_2, jurisdiction `TEST`, 30-day expiry by default), reads each one back and prints FAILED if it did not take effect. With two or more approvals it writes `examples/gold-dore-shipment-registry.json` using those addresses and prints the command to run HiveMind against the registry. Approvals are testnet fixtures, not KYC decisions about any person.

### Live on Hedera testnet

```bash
cp .env.example .env    # HEDERA_OPERATOR_ID=0.0.10717267, add HEDERA_OPERATOR_KEY
node bin/hivemind.js run examples/gold-dore-shipment.json --live
```

`--live` creates an HCS topic (or reuses `HIVEMIND_TOPIC_ID`) and submits each AIP-01 message to it. It costs a small amount of testnet HBAR per message, prints the topic's mirror-node link, and refuses to run on any network except testnet or previewnet.

HCS caps each topic message at 1,024 bytes. Larger AIP-01 messages (for example, a request carrying many sensor readings) are split into chunks, and each chunk takes its own sequence number, so a topic can show more sequence numbers than messages. `verify-topic` reassembles the chunks before checking the hash chain.

### First live run: 27 Sep 2026

| | |
|---|---|
| HCS audit topic | `0.0.10748998` (testnet) |
| Operator | `0.0.10717267` |
| Workflow | `track-and-tokenize`, `examples/gold-dore-shipment.json` (fictional test data) |
| Result | Supply-Chain, offering and KYC checks OK; **halted `GATED` at Tokenization: $GOLD is Pre-Classification** |
| Trail | 10 AIP-01 messages, hash chain valid, sequence numbers 1–11 (one message chunked) |

No token was created or minted. The run shows the orchestration and the audit trail working on Hedera testnet; it is not a tokenization event.

### Second live run: KYC checked against the deployed registry, 30 Sep 2026

| | |
|---|---|
| Registry | `GCNKYCRegistry` `0xB503…0A68` (`0.0.8285495`, pre-audit), `isKYCVerified(address,uint8)` at tier 2 |
| Approvals | Two throwaway test addresses approved by the registry owner via `scripts/approve-kyc.js` (TIER_2, jurisdiction `TEST`, 30-day validity, expire ~30 Oct 2026). Tx `0xe3da34ba…eeda`, `0x9ec8b3af…5ac7` |
| Workflow | `track-and-tokenize`, `examples/gold-dore-shipment-registry.json` (fictional shipment data) |
| Result | Compliance `CHECK_COUNTERPARTIES` OK against the contract (2 checked, 0 missing); **halted `GATED` at Tokenization: $GOLD is Pre-Classification** |
| Trail | HCS topic `0.0.10748998`, sequence 12–22; workflow `83eecbdf…`; `verify-topic` reports both workflows' hash chains valid |
| Negative check | Same input with one unapproved address (dry run): halted `FAIL` at `CHECK_COUNTERPARTIES`, Tokenization never called |

The approved addresses are test fixtures, not KYC decisions about any person. No token was created or minted.

## AIP-01 message format

```json
{ "aip": "AIP-01", "id": "uuid", "ts": "ISO-8601", "workflowId": "uuid",
  "from": "SUPERVISOR", "to": "TOKENIZATION", "task": "MINT",
  "status": "REQUEST | OK | FAIL | GATED | NOT_IMPLEMENTED",
  "params": {}, "result": null, "reason": null,
  "parentId": "id of the request this answers", "prevHash": "hash of the previous message",
  "hash": "sha256 of the canonical message without this field" }
```

Changing any recorded message, or removing or reordering messages, breaks the chain at that point, and `verify` reports where.

## Sources and what was taken from each

| Source | Used | Not used, and why |
|---|---|---|
| *HiveMind Conceptual Agent Architecture* (27 Sep 2026) | Primary spec: the six agents, Hedera services, Supervisor-Worker pattern, fixed message format, the gold doré workflow, and the prerequisites in its Section 5 | n/a |
| *HiveMind Architecture: Institutional Writing Task Force* | The HCS anchoring of document versions (`anchor-document`) and the retail-offering compliance failure (Test Case 2) | Its agent personas name real people; no named person holds a role in HiveMind. Its Data-Verifier and Narrative agents belong to the writing workflow, not this six-agent design. Its LLM choice is not used, because no LLM is used yet |
| *"MIT Research Review: Algorithm Implementation"* | The idea of flagging custody-sensor anomalies, implemented as a plain z-score and range rule so every flag can be explained | Its authorship cannot be verified, so nothing is attributed to MIT. Its patent-claim mappings, its "What We Built" summary (none of it is built) and its unsourced performance figures are excluded. Its Power Platform (Power BI / Power Automate) integrations are optional future work |

## Before HiveMind could run for real

From the Architecture Overview, Section 5, and still true:

1. A production KYC registry contract for the Compliance Agent to query. The current registry design is pre-audit and testnet-only.
2. A cleared classification gate and an appointed custodian for any instrument the Tokenization Agent would mint.
3. An HTS mint implementation, written and audited after (2).
4. Live sensor data sources for the Supply-Chain Agent.
5. An independent security audit of the contract suite.

No GCN-GOLD token or any other instrument has been created or minted. Nothing in this folder describes a live tokenization process.
