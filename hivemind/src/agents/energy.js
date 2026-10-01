// Energy Agent — NET8 energy-credit ACCOUNTING only: validates and totals generation
// entries. No token is created, and no kWh-to-credit rate is applied, because none has
// been set. NET8/USD is an internal testnet index.
export class EnergyAgent {
  name = "ENERGY";

  async handle(task, params) {
    if (task !== "RECORD_ENERGY_CREDITS") return { status: "FAIL", reason: `Unknown task ${task}` };
    const entries = params.entries ?? [];
    if (!entries.length) return { status: "FAIL", reason: "No entries supplied" };
    const bad = entries.filter((e) => !e.siteId || !(e.kWh > 0) || !(e.periodStart <= e.periodEnd));
    if (bad.length) return { status: "FAIL", reason: `${bad.length} invalid entr${bad.length === 1 ? "y" : "ies"} (siteId, kWh > 0 and periodStart ≤ periodEnd required)` };
    const totalKWh = entries.reduce((a, e) => a + e.kWh, 0);
    return { status: "OK", result: { entries: entries.length, totalKWh, note: "Accounting only. No NET8 token exists; no conversion rate applied." } };
  }
}
