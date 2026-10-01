// Supply-Chain Agent — validates custody sensor readings and flags anomalies before any
// later step may proceed. Anomaly rule: a reading more than `anomalyZ` standard deviations
// from the mean of the previous `anomalyWindow` readings, or outside the configured range.
// A plain, inspectable statistic, chosen over opaque models so every flag can be explained.
import { canonical, sha256 } from "../aip01.js";

export function detectAnomalies(readings, { ranges, anomalyZ, anomalyWindow }) {
  const anomalies = [];
  for (const [field, [min, max]] of Object.entries(ranges)) {
    readings.forEach((r, i) => {
      const v = r[field];
      if (typeof v !== "number") return;
      if (v < min || v > max) anomalies.push({ index: i, ts: r.ts, field, value: v, rule: `outside range [${min}, ${max}]` });
      const prev = readings.slice(Math.max(0, i - anomalyWindow), i).map((p) => p[field]).filter((x) => typeof x === "number");
      if (prev.length < 3) return;
      const mean = prev.reduce((a, b) => a + b, 0) / prev.length;
      const sd = Math.max(Math.sqrt(prev.reduce((a, b) => a + (b - mean) ** 2, 0) / prev.length), 0.1);
      const z = (v - mean) / sd;
      if (Math.abs(z) > anomalyZ) anomalies.push({ index: i, ts: r.ts, field, value: v, rule: `z=${z.toFixed(1)} vs previous ${prev.length} readings (mean ${mean.toFixed(2)})` });
    });
  }
  return anomalies;
}

export class SupplyChainAgent {
  name = "SUPPLY_CHAIN";

  constructor(policy) {
    this.policy = policy.sensors;
  }

  async handle(task, params) {
    if (task !== "LOG_SENSOR_READINGS") return { status: "FAIL", reason: `Unknown task ${task}` };
    const readings = params.readings ?? [];
    if (!readings.length) return { status: "FAIL", reason: "No sensor readings supplied" };
    const anomalies = detectAnomalies(readings, this.policy);
    const result = { shipmentId: params.shipmentId, readings: readings.length, readingsSha256: sha256(canonical(readings)), anomalies };
    if (anomalies.length) {
      return { status: "FAIL", result, reason: `Custody anomaly: ${anomalies.length} reading(s) flagged; workflow halted before any mint step` };
    }
    return { status: "OK", result };
  }
}
