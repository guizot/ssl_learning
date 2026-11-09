import crypto from "node:crypto";
import { calculateMerkleRoot } from "./merkle.ts";
import type { SignedTransaction } from "./transaction.ts";

export interface BlockHeader {
  index: number;
  timestamp: number;
  previousHash: string;
  merkleRoot: string;
  difficulty: number;
  nonce: number;
}

export interface Block {
  index: number;
  timestamp: number;
  previousHash: string;
  merkleRoot: string;
  difficulty: number;
  nonce: number;
  transactions: SignedTransaction[];
  hash: string;
}

/**
 * Calculates the SHA-256 hash of a block header.
 *
 * Notice what goes into the block hash:
 * 1. index: The height in the chain
 * 2. previousHash: The cryptographic link to the parent block (creates the CHAIN!)
 * 3. timestamp: Proof of when the block was created
 * 4. merkleRoot: Fingerprint of ALL transactions inside this block
 * 5. difficulty: The PoW target rule applied
 * 6. nonce: The puzzle variable changed by the miner
 */
export function calculateBlockHash(
  index: number,
  previousHash: string,
  timestamp: number,
  merkleRoot: string,
  difficulty: number,
  nonce: number
): string {
  const payload = `${index}|${previousHash}|${timestamp}|${merkleRoot}|${difficulty}|${nonce}`;
  return crypto.createHash("sha256").update(payload).digest("hex");
}

/**
 * Creates a new block structure with computed Merkle Root.
 * The block is not yet mined (nonce = 0, initial hash computed).
 */
export function createBlock(
  index: number,
  previousHash: string,
  transactions: SignedTransaction[],
  difficulty: number = 2,
  timestamp: number = Date.now()
): Block {
  const txHashes = transactions.map((tx) => tx.id);
  const merkleRoot = calculateMerkleRoot(txHashes);
  const nonce = 0;
  const hash = calculateBlockHash(index, previousHash, timestamp, merkleRoot, difficulty, nonce);

  return {
    index,
    timestamp,
    previousHash,
    merkleRoot,
    difficulty,
    nonce,
    transactions,
    hash,
  };
}

export interface MiningResult {
  hash: string;
  nonce: number;
  attempts: number;
  durationMs: number;
  hashesPerSecond: number;
}

/**
 * Mines a block using Proof-of-Work (PoW).
 *
 * The miner repeatedly increments the `nonce` until the block hash
 * starts with `difficulty` number of leading zeroes ("0" * difficulty).
 *
 * For example:
 * Difficulty 1: Starts with "0..." (16 possibilities on average)
 * Difficulty 2: Starts with "00..." (256 possibilities)
 * Difficulty 3: Starts with "000..." (4,096 possibilities)
 * Difficulty 4: Starts with "0000..." (65,536 possibilities)
 */
export function mineBlock(
  block: Block,
  difficulty: number = block.difficulty,
  onProgress?: (attempts: number, currentHash: string) => void
): MiningResult {
  block.difficulty = difficulty;
  const targetPrefix = "0".repeat(difficulty);
  const startTime = Date.now();
  let attempts = 0;

  while (true) {
    attempts++;
    const currentHash = calculateBlockHash(
      block.index,
      block.previousHash,
      block.timestamp,
      block.merkleRoot,
      block.difficulty,
      block.nonce
    );

    if (currentHash.startsWith(targetPrefix)) {
      block.hash = currentHash;
      const durationMs = Math.max(1, Date.now() - startTime);
      const hashesPerSecond = Math.round((attempts / durationMs) * 1000);

      return {
        hash: currentHash,
        nonce: block.nonce,
        attempts,
        durationMs,
        hashesPerSecond,
      };
    }

    block.nonce++;

    if (onProgress && attempts % 10000 === 0) {
      onProgress(attempts, currentHash);
    }
  }
}
