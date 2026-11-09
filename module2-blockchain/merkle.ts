import crypto from "node:crypto";

/**
 * Computes a SHA-256 hash of two concatenated hash strings.
 */
function hashPair(left: string, right: string): string {
  return crypto.createHash("sha256").update(left + right).digest("hex");
}

/**
 * Computes the Merkle Root of an array of transaction hashes.
 *
 * Why Merkle Trees in Blockchain?
 * Instead of checking all 2,000 transactions one by one, a node can verify
 * the integrity of ALL transactions in a block with a single 32-byte hash (Merkle Root).
 * If even 1 satoshi or 1 character in ANY transaction is altered, the Merkle Root completely changes.
 */
export function calculateMerkleRoot(txHashes: string[]): string {
  if (txHashes.length === 0) {
    return crypto.createHash("sha256").update("").digest("hex");
  }

  let currentLevel = [...txHashes];

  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      // If odd number of hashes, duplicate the last one (standard Bitcoin behavior)
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
      nextLevel.push(hashPair(left, right));
    }

    currentLevel = nextLevel;
  }

  return currentLevel[0];
}

/**
 * Generates all levels of the Merkle Tree (useful for visualizers and audit proofs).
 * Level 0 = Leaf nodes (transaction hashes)
 * Level N = Merkle Root (single hash)
 */
export function buildMerkleTreeLevels(txHashes: string[]): string[][] {
  if (txHashes.length === 0) {
    return [[crypto.createHash("sha256").update("").digest("hex")]];
  }

  const tree: string[][] = [[...txHashes]];
  let currentLevel = [...txHashes];

  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
      nextLevel.push(hashPair(left, right));
    }

    tree.push(nextLevel);
    currentLevel = nextLevel;
  }

  return tree;
}
