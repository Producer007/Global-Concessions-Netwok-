// Compliance Agent — checks the offering's investor class against policy and every
// counterparty against the KYC registry before any mint step. The registry is either the
// GCN KYC registry contract on testnet (KYC_REGISTRY_ADDRESS) or the labelled testnet stub.
export class ComplianceAgent {
  name = "COMPLIANCE";

  constructor(policy, registry) {
    this.offering = policy.offering;
    this.registry = registry;
  }

  async handle(task, params) {
    if (task === "CHECK_OFFERING") {
      const cls = params.investorClass ?? "institutional";
      if (this.offering.blockedInvestorClasses.includes(cls)) {
        return { status: "FAIL", result: { investorClass: cls }, reason: this.offering.reason };
      }
      return { status: "OK", result: { investorClass: cls } };
    }
    if (task === "CHECK_COUNTERPARTIES") {
      const parties = params.counterparties ?? [];
      if (!parties.length) return { status: "FAIL", reason: "No counterparties supplied" };
      const missing = [];
      try {
        for (const p of parties) if (!(await this.registry.isApproved(p))) missing.push(p);
      } catch (e) {
        return { status: "FAIL", result: { registry: this.registry.describe() }, reason: `KYC registry check failed: ${e.message}` };
      }
      const result = { checked: parties.length, registry: this.registry.describe(), missing };
      if (missing.length) return { status: "FAIL", result, reason: `Not KYC-approved: ${missing.join(", ")}` };
      return { status: "OK", result };
    }
    return { status: "FAIL", reason: `Unknown task ${task}` };
  }
}
