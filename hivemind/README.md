# GCN HiveMind

**Pre-audit · Testnet only · Not connected to GCNAtomicSwapV2 or any production system.**

GCN HiveMind is a six-agent orchestration layer for the on-chain steps of a tokenization event. A Supervisor takes a goal, breaks it into steps, delegates each step to a specialist agent, and halts at the first step that does not pass. Every request, response and report is an AIP-01 message: hash-chained locally, and in `--live` mode written to a Hedera Consensus Service (HCS) topic on testnet.

This is the first code built against the *HiveMind Conceptual Agent Architecture* (27 Sep 2026). The orchestration and the audit trail run. The Tokenization Agent's mint step does not exist, and will not until an instrument's gate clears and the contract suite is audited.

## Agents

| Agent | Hedera service | What runs today | What does not |
|---|---|---|---|
| Supervisor | none | Picks the workflow, runs steps in order, halts on the first non-OK result, reports | Free-text goal planning (workflows are named explicitly) |
| Consensus | HCS | Records every AIP-01 message; anchors a document's SHA-256 (never its content) | n/a |
| Supply-Chain | HCS (via Consensus) | Validates custody sensor readings; flags range breaches and z-score spikes; halts on any anomaly | Live sensor feeds (readings come from the input file) |
| Compliance | Smart Contract Service (planned) | Blocks retail-targeted offerings; checks counterparties against a KYC registry | A real KYC registry: `config/kyc-registry.testnet.json` is a **testnet stub** with fictional identities |
| Tokenization | HTS | Checks the instrument register; returns `GATED` for every instrument today | Any mint. The HTS mint path is **not implemented** |
| Energy | HTS (planned) | NET8 energy-credit accounting: validates and totals kWh entries | A NET8 token or a kWh-to-credit rate (none has been set) |

## Workflows

| Workflow | Steps |
|---|---|
| `track-and-tokenize` | Supply-Chain `LOG_SENSOR_READINGS` → Compliance `CHECK_OFFERING` → Compliance `CHECK_COUNTERPARTIES` → Tokenization `MINT` |
| `energy-accounting` | Energy `RECORD_ENERGY_CREDITS` |
| `anchor-document` | Consensus `ANCHOR_DOCUMENT` |

The instrument register (`config/instruments.json`) mirrors the Token Register in the Platform Page Copy v2. All five instruments ($JETA, $GOLD, $BROWN, $NET8, $OIL) are gated, so `track-and-tokenize` always ends `HALTED at TOKENIZATION:MINT (GATED)` with the instrument's gate as the reason. That is the correct result today.

## Run

```bash
cd hivemind
npm install
npm test                                              # 10 tests
node bin/hivemind.js run examples/gold-dore-shipment.json   # dry run: nothing sent to Hedera
node bin/hivemind.js verify runs/<file>.jsonl               # re-check a saved trail's hash chain
```

Example inputs (all fictional test data):

| File | Expected outcome |
|---|---|
| `examples/gold-dore-shipment.json` | Readings, offering and KYC pass; halts `GATED`: $GOLD is Pre-Classification |
| `examples/retail-offering.json` | Halts at Compliance `CHECK_OFFERING`; Tokenization is never called |
| `examples/net8-credits.json` | Completes: 12,500 kWh recorded, no token |
| `examples/anchor-document.json` | Completes: this README's SHA-256 anchored |

### Live on Hedera testnet

```bash
cp .env.example .env    # HEDERA_OPERATOR_ID=0.0.10717267, add HEDERA_OPERATOR_KEY
node bin/hivemind.js run examples/gold-dore-shipment.json --live
```

`--live` creates an HCS topic (or reuses `HIVEMIND_TOPIC_ID`) and submits each AIP-01 message to it. It costs a small amount of testnet HBAR per message, prints the topic's mirror-node link, and refuses to run on any network except testnet or previewnet.

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
