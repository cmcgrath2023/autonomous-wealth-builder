import { createHash } from 'crypto';
import { WitnessRecord } from '../types/index.js';

export function computeHash(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function createWitnessRecord(
  action: string,
  actor: string,
  module: string,
  payload: Record<string, unknown>,
  previousHash: string
): WitnessRecord {
  const timestamp = new Date();
  const payloadStr = JSON.stringify(payload);
  const hashInput = `${previousHash}|${timestamp.toISOString()}|${action}|${actor}|${module}|${payloadStr}`;
  const hash = computeHash(hashInput);

  return {
    hash,
    previousHash,
    timestamp,
    action,
    actor,
    module,
    payload: payloadStr,
  };
}

export function verifyChain(records: WitnessRecord[]): { valid: boolean; brokenAt?: number } {
  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1];
    if (records[i].previousHash !== prev.hash) {
      return { valid: false, brokenAt: i };
    }
    // Re-compute hash to verify integrity
    const hashInput = `${records[i].previousHash}|${records[i].timestamp instanceof Date ? records[i].timestamp.toISOString() : records[i].timestamp}|${records[i].action}|${records[i].actor}|${records[i].module}|${records[i].payload}`;
    const expectedHash = computeHash(hashInput);
    if (records[i].hash !== expectedHash) {
      return { valid: false, brokenAt: i };
    }
  }
  return { valid: true };
}

export const GENESIS_HASH = computeHash('MTWM_GENESIS_BLOCK_v6');
