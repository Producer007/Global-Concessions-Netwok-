

GCN – Global Concessions Network  
Patented RWA Tokenisation • BRICS Pay‑Ready • AI‑Native • Bittensor Subnet

[![License: Proprietary + MIT Modules](https://img.shields.io/badge/License-Proprietary%20%2B%20MIT-blue.svg)](LICENSE)  
[![Patent](https://img.shields.io/badge/USPTO-11%2C485%2C164-green)](https://patents.google.com/patent/US11485164B2/)  
[![TVL (Verified Mining)](https://img.shields.io/badge/Verified%20Portfolio-%2439.85B-brightgreen)](https://gcnrwa-token-sf3bk9dk.manus.space/ni43101)  
[![Pipeline](https://img.shields.io/badge/African%20Pipeline-%2432B-orange)](https://gcnrwa-token-sf3bk9dk.manus.space/ni43101)  
[![AI Layer](https://img.shields.io/badge/HiveMind-Agent_Ready-purple)](docs/llms.txt)


  Overview

GCNis the first real‑world asset (RWA) tokenisation platform protected by a USPTO patent (No. 11,485,164) covering *atomic swap cross‑chain transfers with semantic arbitration*.  

We tokenise **NI 43‑101 certified mining concessions** ($39.85B live US portfolio + $32B African pipeline) and infrastructure assets, and settle them on a BRICS Pay‑ready rail** – no JPM Kinexys, no SWIFT.

Our stack is **AI‑native** (HiveMind agent, MCP server, `llms.txt`) and we are launching a **Bittensor subnet (SN‑ICI)** to decentralise asset arbitration.

| Live Portfolio (USA) | African Pipeline | Current Funding Need |
|---------------------|------------------|----------------------|
| $39.85B NI 43‑101   | $32B             | $50M – $150M         |

> **Platform Preview:** [gcnrwa-token-sf3bk9dk.manus.space/ni43101](https://gcnrwa-token-sf3bk9dk.manus.space/ni43101)



 Key Features

| Feature | Description |
|---------|-------------|
| **USPTO Patent 11,485,164** | Atomic swap + semantic arbitration for cross‑chain RWA transfers. |
| **BRICS Pay‑Ready** | Settlement rail independent of SWIFT, JPM Kinexys – designed for emerging market trade. |
| **AI‑Native Semantic Layer** | `llms.txt`, MCP server, HiveMind agent for intelligent asset arbitration and discovery. |
| **Bittensor Subnet (SN‑ICI)** | Planned decentralised intelligence for real‑time concession valuation and arbitration. |
| **Verified Asset Backlog** | NI 43‑101 certified mining assets (USA) + African pipeline – ready for tokenisation. |
| **Keystone Bank Integration** | Equity stake planned to provide regulated fiat on‑/off‑ramps. |

---

 Whitepaper & Documentation

- [Whitepaper v2.1](/whitepaper-v2.1.pdf) *(link to actual PDF when available)*  
- [Patent Summary & Claims](/patent-US11485164.md)  
- [AI Semantic Layer Spec](/docs/llms.txt)  
- [Bittensor Subnet Design](/docs/bittensor-sn-ici.md)  
- [BRICS Pay Integration](/docs/brics-pay-rail.md)  

---

 Quick Start (for developers & integrators)

GCN provides open tooling for asset onboarding, arbitration, and cross‑chain settlement.

### 1. Clone the repo

```bash
git clone https://github.com/GCN-RWA/GCN.git
cd GCN
```

 2. Run the HiveMind agent locally (semantic arbitration)

```bash
cd ai-agent
pip install -r requirements.txt
python hive_mind.py --config config.yaml
```

3. Interact with the MCP server

```bash
cd mcp-server
npm install
npm start
```

The MCP server exposes endpoints for atomic swap simulation and arbitration log retrieval.

 4. Validate a mining concession against NI 43‑101 schema

```bash
cd validator
python validate_concession.py --file sample_concession.json
```


 Repository Structure

```
GCN/
├── README.md                  # This file
├── LICENSE                    # Proprietary + open modules (see below)
├── whitepaper-v2.1.pdf
├── docs/
│   ├── llms.txt               # AI‑readable semantic layer spec
│   ├── bittensor-sn-ici.md
│   ├── brics-pay-rail.md
│   └── patent-summary.md
├── ai-agent/
│   ├── hive_mind.py
│   ├── requirements.txt
│   └── config.yaml
├── mcp-server/
│   ├── index.js
│   ├── package.json
│   └── routes/
├── validator/
│   ├── validate_concession.py
│   └── ni43-101-schema.json
├── smart-contracts/           # Atomic swap + arbitration contracts (coming soon)
└── testnet/                   # Arc / EVM testnet deployment scripts
```
 License

The core protocol (atomic swap, semantic arbitration, BRICS Pay settlement) is **proprietary** and protected by USPTO patent 11,485,164.  
Helper modules (AI agent, MCP server, validator scripts) are released under the **MIT License**.

See [LICENSE](LICENSE) for details.



 Contributing

We welcome contributions to open‑source modules (AI agent, validator, docs).  
Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting PRs.

For patent‑covered components, contact `legal@gcnrwa.io`.


 Connect & Fundraising

- Investor Relations:** `ir@gcnrwa.io`  
- Partnerships (BRICS Pay, Arc, Bittensor):`partners@gcnrwa.io`  
- Technical Integration:`dev@gcnrwa.io`  

Current funding ask:** $50M – $150M (strategic equity + token warrant).  
Lead investors: Circle ARC Ecosystem Fund, Seedli Capital / Nimbus Capital, Galaxy Digital (target).


  Disclaimer

This project is in active development. Tokenised assets, mining concessions, and investment opportunities are subject to regulatory approval. Nothing in this repository constitutes an offer of securities. Always conduct your own due diligence.


Built for the next generation of onchain real‑world assets.
© 2026 Global Concessions Network
