// Reads a HiveMind audit topic back from the Hedera mirror node and rebuilds the AIP-01
// messages, reassembling any message the SDK split into chunks (HCS caps each chunk at
// 1,024 bytes, and every chunk takes its own sequence number).
export const MIRRORS = {
  testnet: "https://testnet.mirrornode.hedera.com",
  previewnet: "https://previewnet.mirrornode.hedera.com",
};

export function reassemble(rows) {
  const groups = new Map();
  for (const r of rows) {
    const ci = r.chunk_info;
    const key = ci?.initial_transaction_id
      ? `${ci.initial_transaction_id.account_id}@${ci.initial_transaction_id.transaction_valid_start}`
      : `seq-${r.sequence_number}`;
    if (!groups.has(key)) groups.set(key, { first: r.sequence_number, total: ci?.total ?? 1, parts: [] });
    const g = groups.get(key);
    g.first = Math.min(g.first, r.sequence_number);
    g.parts.push({ n: ci?.number ?? 1, data: Buffer.from(r.message, "base64") });
  }
  const out = [];
  for (const g of [...groups.values()].sort((a, b) => a.first - b.first)) {
    if (g.parts.length !== g.total) {
      out.push({ firstSequence: g.first, incomplete: true });
      continue;
    }
    const text = Buffer.concat(g.parts.sort((a, b) => a.n - b.n).map((p) => p.data)).toString("utf8");
    out.push({ firstSequence: g.first, chunks: g.total, message: JSON.parse(text) });
  }
  return out;
}

export async function fetchTopic(topicId, network = "testnet") {
  const base = MIRRORS[network];
  if (!base) throw new Error(`No mirror node configured for "${network}"`);
  const rows = [];
  let next = `/api/v1/topics/${topicId}/messages?limit=100&order=asc`;
  while (next) {
    const res = await fetch(base + next, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`Mirror node HTTP ${res.status} for topic ${topicId}`);
    const page = await res.json();
    rows.push(...page.messages);
    next = page.links?.next ?? null;
  }
  return rows;
}
