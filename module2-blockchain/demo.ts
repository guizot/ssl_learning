import { Blockchain } from "./blockchain.ts";
import { createWallet } from "../module1-cryptography/wallet.ts";
import { signTransaction } from "./transaction.ts";

const cyan = (text: string | number) => `\x1b[36m${text}\x1b[0m`;
const green = (text: string | number) => `\x1b[32m${text}\x1b[0m`;
const yellow = (text: string | number) => `\x1b[33m${text}\x1b[0m`;
const red = (text: string | number) => `\x1b[31m${text}\x1b[0m`;
const bold = (text: string | number) => `\x1b[1m${text}\x1b[0m`;
const dim = (text: string | number) => `\x1b[2m${text}\x1b[0m`;

async function runDemo() {
  console.log("\n" + "=".repeat(75));
  console.log(bold(cyan(" ⛓️   MODULE 2: THE BLOCKCHAIN MENTAL MODEL & PROOF-OF-WORK DEMO")));
  console.log("=".repeat(75));
  console.log(dim("Learn how Blocks, Merkle Trees, Mempool, Gas Fees & PoW Mining form an immutable ledger.\n"));

  // 1. Initialize Blockchain
  console.log(bold("\n[Step 1] Initializing Blockchain & Genesis Block"));
  const blockchain = new Blockchain(2, 50); // Difficulty: 2 leading zeroes, Block reward: 50 coins
  const genesis = blockchain.getLatestBlock();

  console.log(`  Difficulty Target : ${yellow(blockchain.difficulty)} leading zeroes ("${'0'.repeat(blockchain.difficulty)}")`);
  console.log(`  Block Reward      : ${green(blockchain.blockReward)} coins per block`);
  console.log(`  Genesis Block #0  :`);
  console.log(`    - Hash          : ${cyan(genesis.hash)}`);
  console.log(`    - Previous Hash : ${dim(genesis.previousHash)}`);
  console.log(`    - Nonce         : ${genesis.nonce}`);
  console.log(`    - Merkle Root   : ${dim(genesis.merkleRoot)}`);

  // 2. Generate Wallets
  console.log(bold("\n[Step 2] Creating Network Participants"));
  const alice = createWallet("Alice");
  const bob = createWallet("Bob");
  const miner = createWallet("Charlie (Miner)");

  console.log(`  👤 Alice   : ${cyan(alice.address)}`);
  console.log(`  👤 Bob     : ${cyan(bob.address)}`);
  console.log(`  ⛏️  Miner   : ${cyan(miner.address)}`);

  // 3. Initial Funding Block
  console.log(bold("\n[Step 3] Mining Initial Block to Fund Alice"));
  console.log(`  Mining Block #1 to credit Alice with protocol block reward (50 coins)...`);
  const fundResult = blockchain.minePendingTransactions(alice.address);
  console.log(`  ✅ Block #1 Mined!`);
  console.log(`    - Hash     : ${green(fundResult.block.hash)}`);
  console.log(`    - Nonce    : ${fundResult.miningResult.nonce} (in ${fundResult.miningResult.attempts} attempts, ${fundResult.miningResult.durationMs}ms)`);
  console.log(`    - Alice Bal: ${green(blockchain.getBalance(alice.address))} coins`);

  // 4. Create Transactions with Gas Fees
  console.log(bold("\n[Step 4] Submitting Signed Transactions to Mempool with Gas Fee"));
  console.log(`  Alice prepares transaction: Send 15 coins to Bob (+ 2.5 coins Gas Fee for miner)`);

  const tx1 = signTransaction(alice, bob.address, 15, 2.5, blockchain.getNextNonce(alice.address));
  const submitResult = blockchain.addTransaction(tx1);

  if (submitResult.success) {
    console.log(`  ✅ Transaction submitted to Mempool!`);
    console.log(`    - Tx ID     : ${dim(tx1.id)}`);
    console.log(`    - Amount    : ${green(tx1.data.amount)} coins`);
    console.log(`    - Gas Fee   : ${yellow(tx1.data.fee)} coins`);
    console.log(`    - Signature : ${dim(tx1.signatureHex.slice(0, 32))}...`);
  } else {
    console.log(`  ❌ Failed: ${submitResult.error}`);
  }

  console.log(`  Current Mempool Size: ${yellow(blockchain.mempool.length)} pending transaction(s)`);
  console.log(`  Alice Pending Balance: ${cyan(blockchain.getPendingBalance(alice.address))} coins (50 - 15 - 2.5)`);

  // 5. Mining Block #2 (Proof of Work)
  console.log(bold("\n[Step 5] Miner Solves Proof-of-Work for Block #2"));
  console.log(`  Miner (${miner.name}) picks up mempool transactions & starts hashing...`);

  const mineResult = blockchain.minePendingTransactions(miner.address);
  const block2 = mineResult.block;

  console.log(`  🎉 Block #2 Successfully Mined!`);
  console.log(`    - Block Index     : ${block2.index}`);
  console.log(`    - Previous Hash   : ${dim(block2.previousHash)}`);
  console.log(`    - Merkle Root     : ${dim(block2.merkleRoot)}`);
  console.log(`    - Nonce Found     : ${yellow(block2.nonce)}`);
  console.log(`    - Block Hash      : ${green(block2.hash)} (starts with "${'0'.repeat(block2.difficulty)}")`);
  console.log(`    - Hash Rate       : ~${mineResult.miningResult.hashesPerSecond.toLocaleString()} hashes/sec`);
  console.log(`    - Total Tx in Blk : ${block2.transactions.length} (1 Coinbase + 1 User Tx)`);
  console.log(`    - Coinbase Reward : ${green(mineResult.blockReward)} base + ${yellow(mineResult.totalGasFees)} gas fee = ${green(mineResult.blockReward + mineResult.totalGasFees)} coins`);

  // 6. Verify Balances
  console.log(bold("\n[Step 6] Ledger Balances After Block #2 Confirmation"));
  console.log(`  Alice Balance : ${cyan(blockchain.getBalance(alice.address))} coins`);
  console.log(`  Bob Balance   : ${green(blockchain.getBalance(bob.address))} coins`);
  console.log(`  Miner Balance : ${yellow(blockchain.getBalance(miner.address))} coins`);
  console.log(`  Total Supply  : ${blockchain.getBalance(alice.address) + blockchain.getBalance(bob.address) + blockchain.getBalance(miner.address)} coins (50 from Block 1 + 50 from Block 2)`);

  // 7. Chain Integrity Check
  console.log(bold("\n[Step 7] Checking Blockchain Integrity"));
  let validation = blockchain.isChainValid();
  console.log(`  Chain Valid? ${validation.isValid ? green("YES (100% Valid & Cryptographically Sealed)") : red("NO")}`);

  // 8. Tamper Simulation (The Attack)
  console.log(bold("\n[Step 8] Tamper Simulation: Malicious Attacker Alters Block #2"));
  console.log(`  ⚠️  Attacker directly modifies the confirmed transaction in Block #2!`);
  console.log(`  Original Tx : Alice -> Bob = 15 coins`);
  console.log(`  Hacked Tx   : Alice -> Bob = 999 coins (Fraudulent attempt!)`);

  blockchain.tamperBlockTransaction(2, 1, 999);

  console.log(`  Re-verifying blockchain integrity...`);
  validation = blockchain.isChainValid();

  if (!validation.isValid) {
    console.log(`  🛡️  ${bold(red("ATTACK DETECTED AND REJECTED!"))}`);
    console.log(`  Faulty Block : ${red("#" + validation.errorBlockIndex)}`);
    console.log(`  Reason       : ${yellow(validation.reason)}`);
    console.log(`  Explanation  : Because transactions are bound by Merkle Root & ECDSA Signatures,`);
    console.log(`                 any modification breaks the block hash and breaks the entire chain!`);
  } else {
    console.log(`  ❌ Error: Tamper was not detected!`);
  }

  console.log("\n" + "=".repeat(75));
  console.log(bold(green(" ✅ MODULE 2 CORE CONCEPTS VERIFIED SUCCESSFULLY!")));
  console.log("=".repeat(75) + "\n");
}

runDemo().catch(console.error);
