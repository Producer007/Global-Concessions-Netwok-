// Where the Consensus Agent writes. DryRunLedger keeps the trail in memory (and a local
// JSONL file when asked); HcsLedger submits each message to a Hedera Consensus Service
// topic on TESTNET and records the consensus sequence number.
import fs from "node:fs";
import path from "node:path";
import { canonical } from "./aip01.js";

export class DryRunLedger {
  constructor({ file = null } = {}) {
    this.mode = "dry-run";
    this.topicId = "dry-run";
    this.file = file;
    this.seq = 0;
    if (file) fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  async submit(message) {
    const entry = { sequenceNumber: ++this.seq, topicId: this.topicId, message };
    if (this.file) fs.appendFileSync(this.file, JSON.stringify(entry) + "\n");
    return { topicId: this.topicId, sequenceNumber: entry.sequenceNumber, mode: this.mode };
  }

  async close() {}
}

export class HcsLedger {
  static async open({ network, operatorId, operatorKey, topicId = null }) {
    if (network !== "testnet" && network !== "previewnet") {
      throw new Error(`Refusing live mode on "${network}": HiveMind is pre-audit and testnet-only.`);
    }
    const sdk = await import("@hashgraph/sdk");
    const key = /^(0x)?[0-9a-fA-F]{64}$/.test(operatorKey)
      ? sdk.PrivateKey.fromStringECDSA(operatorKey.replace(/^0x/, ""))
      : sdk.PrivateKey.fromStringDer(operatorKey);
    const client = sdk.Client.forName(network).setOperator(sdk.AccountId.fromString(operatorId), key);
    client.setRequestTimeout(90000);
    const ledger = new HcsLedger(sdk, client, network);
    if (topicId) {
      ledger.topicId = topicId;
    } else {
      const rc = await (await new sdk.TopicCreateTransaction()
        .setTopicMemo("GCN HiveMind audit trail · pre-audit · testnet")
        .setSubmitKey(key.publicKey)
        .execute(client)).getReceipt(client);
      ledger.topicId = rc.topicId.toString();
    }
    return ledger;
  }

  constructor(sdk, client, network) {
    this.mode = "hcs";
    this.sdk = sdk;
    this.client = client;
    this.network = network;
  }

  async submit(message) {
    const tx = await new this.sdk.TopicMessageSubmitTransaction()
      .setTopicId(this.topicId)
      .setMessage(canonical(message))
      .execute(this.client);
    const rc = await tx.getReceipt(this.client);
    return { topicId: this.topicId, sequenceNumber: Number(rc.topicSequenceNumber), mode: this.mode, txId: tx.transactionId.toString() };
  }

  async close() {
    this.client.close();
  }
}
