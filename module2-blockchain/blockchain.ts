import {
  type Block,
  type MiningResult,
  calculateBlockHash,
  createBlock,
  mineBlock,
} from "./block.ts";
import { calculateMerkleRoot } from "./merkle.ts";
import {
  type SignedTransaction,
  COINBASE_ADDRESS,
  createCoinbaseTransaction,
  verifyTransaction,
} from "./transaction.ts";

export interface ChainValidationResult {
  isValid: boolean;
  errorBlockIndex?: number;
  reason?: string;
}

export class Blockchain {
  public chain: Block[] = [];
  public mempool: SignedTransaction[] = [];
  public difficulty: number;
  public blockReward: number;

  constructor(difficulty: number = 2, blockReward: number = 50) {
    this.difficulty = difficulty;
    this.blockReward = blockReward;
    this.createGenesisBlock();
  }

  /**
   * Generates Block #0: The Genesis Block.
   * Every blockchain starts with a hardcoded or minted origin block with no predecessor.
   */
  private createGenesisBlock(): void {
    const genesisTx = createCoinbaseTransaction(
      "0x0000000000000000000000000000000000000000",
      0,
      0
    );
    genesisTx.data.to = "GENESIS_NETWORK_ORIGIN";

    const genesisBlock = createBlock(
      0,
      "0".repeat(64),
      [genesisTx],
      this.difficulty,
      1700000000000 // Fixed deterministic timestamp for Genesis
    );

    mineBlock(genesisBlock, this.difficulty);
    this.chain.push(genesisBlock);
  }

  public getLatestBlock(): Block {
    return this.chain[this.chain.length - 1];
  }

  /**
   * Computes the confirmed balance of an address by replaying all confirmed transactions
   * across all blocks in the ledger.
   */
  public getBalance(address: string): number {
    let balance = 0;

    for (const block of this.chain) {
      for (const tx of block.transactions) {
        if (tx.data.to.toLowerCase() === address.toLowerCase()) {
          balance += tx.data.amount;
        }
        if (tx.data.from.toLowerCase() === address.toLowerCase()) {
          balance -= tx.data.amount + tx.data.fee;
        }
      }
    }

    return balance;
  }

  /**
   * Computes the available balance taking into account pending outgoing transactions in the Mempool.
   */
  public getPendingBalance(address: string): number {
    let balance = this.getBalance(address);

    for (const tx of this.mempool) {
      if (tx.data.from.toLowerCase() === address.toLowerCase()) {
        balance -= tx.data.amount + tx.data.fee;
      }
    }

    return balance;
  }

  /**
   * Gets the next expected nonce for a wallet address based on confirmed + mempool transactions.
   */
  public getNextNonce(address: string): number {
    let nonce = 0;

    for (const block of this.chain) {
      for (const tx of block.transactions) {
        if (tx.data.from.toLowerCase() === address.toLowerCase()) {
          nonce++;
        }
      }
    }

    for (const tx of this.mempool) {
      if (tx.data.from.toLowerCase() === address.toLowerCase()) {
        nonce++;
      }
    }

    return nonce;
  }

  /**
   * Submits a signed transaction into the Mempool.
   * Validates:
   * 1. Cryptographic signature and address match.
   * 2. Sender has enough balance (amount + gas fee).
   * 3. Nonce ordering.
   */
  public addTransaction(tx: SignedTransaction): { success: boolean; error?: string } {
    // 1. Verify digital signature & format
    const verification = verifyTransaction(tx);
    if (!verification.isValid) {
      return { success: false, error: verification.reason || "Invalid transaction" };
    }

    // 2. Sender must not be coinbase
    if (tx.data.from === COINBASE_ADDRESS) {
      return { success: false, error: "Cannot submit manual coinbase transactions" };
    }

    // 3. Sender must have sufficient balance for amount + gas fee
    const availableBalance = this.getPendingBalance(tx.data.from);
    const totalRequired = tx.data.amount + tx.data.fee;
    if (availableBalance < totalRequired) {
      return {
        success: false,
        error: `Insufficient balance: available ${availableBalance}, requires ${totalRequired} (${tx.data.amount} amount + ${tx.data.fee} gas fee)`,
      };
    }

    // 4. Nonce validation
    const expectedNonce = this.getNextNonce(tx.data.from);
    if (tx.data.nonce !== expectedNonce) {
      return {
        success: false,
        error: `Invalid nonce: expected ${expectedNonce}, got ${tx.data.nonce}`,
      };
    }

    this.mempool.push(tx);
    return { success: true };
  }

  /**
   * Mines pending transactions from the mempool into a new Block.
   *
   * Economic Incentives:
   * The miner earns:
   * 1. Base Block Reward (minted new coins, e.g. +50 coins)
   * 2. Total Gas Fees collected from all transactions included in this block
   */
  public minePendingTransactions(
    minerAddress: string,
    onProgress?: (attempts: number, currentHash: string) => void
  ): {
    block: Block;
    miningResult: MiningResult;
    blockReward: number;
    totalGasFees: number;
  } {
    // 1. Take transactions from mempool (in order of fee priority / FIFO)
    const blockTransactions = [...this.mempool];

    // 2. Sum up all gas fees
    const totalGasFees = blockTransactions.reduce((sum, tx) => sum + tx.data.fee, 0);

    // 3. Create the Coinbase Transaction (at index 0 of the block)
    const coinbaseTx = createCoinbaseTransaction(minerAddress, this.blockReward, totalGasFees);
    const fullTransactions = [coinbaseTx, ...blockTransactions];

    // 4. Assemble the new block
    const latestBlock = this.getLatestBlock();
    const newBlock = createBlock(
      this.chain.length,
      latestBlock.hash,
      fullTransactions,
      this.difficulty,
      Date.now()
    );

    // 5. Execute Proof-of-Work mining
    const miningResult = mineBlock(newBlock, this.difficulty, onProgress);

    // 6. Commit block to the ledger
    this.chain.push(newBlock);

    // 7. Clear the processed transactions from mempool
    this.mempool = [];

    return {
      block: newBlock,
      miningResult,
      blockReward: this.blockReward,
      totalGasFees,
    };
  }

  /**
   * Verifies the entire blockchain integrity (Tamper-evident verification).
   *
   * Checks every block from index 1 to N:
   * 1. Does block.previousHash match the previous block's hash?
   * 2. Does block.merkleRoot match the transactions inside the block?
   * 3. Does block.hash match the computed hash of the header?
   * 4. Does block.hash meet the Proof-of-Work difficulty target?
   * 5. Are all digital signatures inside the block valid?
   */
  public isChainValid(): ChainValidationResult {
    for (let i = 1; i < this.chain.length; i++) {
      const currentBlock = this.chain[i];
      const previousBlock = this.chain[i - 1];

      // 1. Check Hash Pointer (Chain linkage)
      if (currentBlock.previousHash !== previousBlock.hash) {
        return {
          isValid: false,
          errorBlockIndex: i,
          reason: `Broken hash pointer! Block #${i} previousHash (${currentBlock.previousHash.slice(0, 10)}...) does not match Block #${i - 1} hash (${previousBlock.hash.slice(0, 10)}...)`,
        };
      }

      // 2. Check Merkle Root
      const txHashes = currentBlock.transactions.map((tx) => tx.id);
      const computedMerkleRoot = calculateMerkleRoot(txHashes);
      if (currentBlock.merkleRoot !== computedMerkleRoot) {
        return {
          isValid: false,
          errorBlockIndex: i,
          reason: `Merkle Root mismatch on Block #${i}! Transactions were altered inside the block.`,
        };
      }

      // 3. Check Block Hash
      const computedHash = calculateBlockHash(
        currentBlock.index,
        currentBlock.previousHash,
        currentBlock.timestamp,
        currentBlock.merkleRoot,
        currentBlock.difficulty,
        currentBlock.nonce
      );
      if (currentBlock.hash !== computedHash) {
        return {
          isValid: false,
          errorBlockIndex: i,
          reason: `Block #${i} hash mismatch! Computed: ${computedHash.slice(0, 10)}..., Recorded: ${currentBlock.hash.slice(0, 10)}...`,
        };
      }

      // 4. Check Proof of Work difficulty
      const targetPrefix = "0".repeat(currentBlock.difficulty);
      if (!currentBlock.hash.startsWith(targetPrefix)) {
        return {
          isValid: false,
          errorBlockIndex: i,
          reason: `Block #${i} does not satisfy Proof of Work difficulty (${currentBlock.difficulty} leading zeroes)!`,
        };
      }

      // 5. Verify individual transactions
      for (const tx of currentBlock.transactions) {
        const txVerification = verifyTransaction(tx);
        if (!txVerification.isValid) {
          return {
            isValid: false,
            errorBlockIndex: i,
            reason: `Invalid transaction ${tx.id.slice(0, 10)}... in Block #${i}: ${txVerification.reason}`,
          };
        }
      }
    }

    return { isValid: true };
  }

  /**
   * Simulates a malicious attacker tampering with a confirmed transaction in history.
   * Useful for testing tamper detection in the CLI and visualizer!
   */
  public tamperBlockTransaction(blockIndex: number, txIndex: number, newAmount: number): void {
    if (blockIndex <= 0 || blockIndex >= this.chain.length) {
      throw new Error(`Cannot tamper block #${blockIndex}: index out of bounds`);
    }
    const block = this.chain[blockIndex];
    if (txIndex < 0 || txIndex >= block.transactions.length) {
      throw new Error(`Cannot tamper transaction #${txIndex}: index out of bounds`);
    }

    // Maliciously change transaction amount
    block.transactions[txIndex].data.amount = newAmount;
  }
}
