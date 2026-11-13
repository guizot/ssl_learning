import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { serveCoreAssetIfMatch } from "../../core/http.ts";

import { Blockchain } from "../blockchain.ts";
import { type Block, calculateBlockHash, mineBlock } from "../block.ts";
import { buildMerkleTreeLevels, calculateMerkleRoot } from "../merkle.ts";
import {
  COINBASE_ADDRESS,
  type SignedTransaction,
  hashTransaction,
  signTransaction,
  verifyTransaction,
} from "../transaction.ts";
import { type Wallet, createWallet } from "../../module1-cryptography/wallet.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../..");
const M2_DIR = path.join(ROOT_DIR, "module2-blockchain", "generated");
const STATE_FILE = path.join(M2_DIR, "state.json");
const WALLETS_FILE = path.join(M2_DIR, "wallets.json");
const LOGS_FILE = path.join(M2_DIR, "logs.json");
const PUBLIC_DIR = path.join(__dirname, "public");

if (!fs.existsSync(M2_DIR)) {
  fs.mkdirSync(M2_DIR, { recursive: true });
}

interface StoredWallet {
  id: string;
  name: string;
  address: string;
  publicKeyHex: string;
  privateKeyPem: string;
  publicKeyPem: string;
  createdAt: number;
}

export interface MiningTelemetry {
  blockIndex: number;
  minerId: string;
  minerName: string;
  minerAddress: string;
  nonce: number;
  attempts: number;
  durationMs: number;
  hashesPerSecond: number;
  blockReward: number;
  totalGasFees: number;
  txCount: number;
  hash: string;
  timestamp: number;
}

interface PersistedState {
  difficulty: number;
  blockReward: number;
  chain: Block[];
  mempool: SignedTransaction[];
  lastMiningResult: MiningTelemetry | null;
  activeRole?: string;
}

export interface ActivityLogEntry {
  id: string;
  timestamp: number;
  action: string;
  command: string;
  sdk?: string;
  status: "success" | "error";
  summary: string;
  details?: Record<string, unknown>;
}

function loadLogs(): ActivityLogEntry[] {
  if (!fs.existsSync(LOGS_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(LOGS_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function appendLog(entry: Omit<ActivityLogEntry, "id" | "timestamp">): ActivityLogEntry {
  const logs = loadLogs();
  const full: ActivityLogEntry = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    ...entry,
  };
  logs.unshift(full);
  if (logs.length > 200) {
    logs.length = 200;
  }
  fs.writeFileSync(LOGS_FILE, JSON.stringify(logs, null, 2), "utf8");
  return full;
}

function clearLogs() {
  if (fs.existsSync(LOGS_FILE)) {
    fs.unlinkSync(LOGS_FILE);
  }
}

function makeWalletId(name: string, existing: StoredWallet[]): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "wallet";
  let candidate = base;
  let n = 2;
  while (existing.some((w) => w.id === candidate)) {
    candidate = `${base}_${n++}`;
  }
  return candidate;
}

function createStoredWallet(name: string, existing: StoredWallet[]): StoredWallet {
  const wallet = createWallet(name);
  const privateKeyPem = wallet.privateKey.export({ type: "sec1", format: "pem" }).toString();
  const publicKeyPem = wallet.publicKey.export({ type: "spki", format: "pem" }).toString();
  return {
    id: makeWalletId(name, existing),
    name: wallet.name,
    address: wallet.address,
    publicKeyHex: wallet.publicKeyHex,
    privateKeyPem,
    publicKeyPem,
    createdAt: Date.now(),
  };
}

function hydrateWallet(stored: StoredWallet): Wallet {
  return {
    name: stored.name,
    address: stored.address,
    publicKeyHex: stored.publicKeyHex,
    privateKey: crypto.createPrivateKey(stored.privateKeyPem),
    publicKey: crypto.createPublicKey(stored.publicKeyPem),
  };
}

function loadWallets(): StoredWallet[] {
  if (fs.existsSync(WALLETS_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(WALLETS_FILE, "utf-8"));
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {}
  }
  saveWallets([]);
  return [];
}

function saveWallets(wallets: StoredWallet[]): void {
  fs.writeFileSync(WALLETS_FILE, JSON.stringify(wallets, null, 2), "utf-8");
}

function createInitialPersistedState(): PersistedState {
  const initial: PersistedState = {
    difficulty: 2,
    blockReward: 50,
    chain: [],
    mempool: [],
    lastMiningResult: null,
    activeRole: "node",
  };
  savePersistedState(initial);
  return initial;
}

function loadPersistedState(): PersistedState {
  if (fs.existsSync(STATE_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
      if (parsed && Array.isArray(parsed.chain)) {
        return {
          difficulty: Number(parsed.difficulty) || 2,
          blockReward: Number(parsed.blockReward) || 50,
          chain: parsed.chain,
          mempool: Array.isArray(parsed.mempool) ? parsed.mempool : [],
          lastMiningResult: parsed.lastMiningResult || null,
          activeRole: typeof parsed.activeRole === "string" && parsed.activeRole ? parsed.activeRole : "node",
        };
      }
    } catch {}
  }
  return createInitialPersistedState();
}

function savePersistedState(state: PersistedState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

function hydrateBlockchain(state: PersistedState): Blockchain {
  const bc = new Blockchain(state.difficulty, state.blockReward);
  bc.chain = state.chain;
  bc.mempool = state.mempool;
  return bc;
}

interface BlockCheckDiagnostics {
  index: number;
  isGenesis: boolean;
  isValid: boolean;
  checks: {
    hashPointer: { passed: boolean; detail: string };
    merkleRoot: { passed: boolean; detail: string; computedMerkleRoot: string };
    blockHash: { passed: boolean; detail: string; computedHash: string };
    powTarget: { passed: boolean; detail: string };
    txSignatures: {
      passed: boolean;
      detail: string;
      failures: Array<{ txIndex: number; txId: string; reason: string }>;
    };
  };
  txValidations: Array<{ txIndex: number; txId: string; isValid: boolean; reason?: string }>;
}

function diagnoseBlock(bc: Blockchain, index: number): BlockCheckDiagnostics {
  const current = bc.chain[index];
  const isGenesis = index === 0;
  const previous = index > 0 ? bc.chain[index - 1] : null;

  const hashPointerPassed = isGenesis
    ? current.previousHash === "0".repeat(64)
    : previous !== null && current.previousHash === previous.hash;
  const hashPointerDetail = isGenesis
    ? "Genesis root pointer (64 zeroes)"
    : hashPointerPassed
      ? `Matches Block #${index - 1} hash`
      : `Mismatch: expected ${previous?.hash.slice(0, 12)}..., got ${current.previousHash.slice(0, 12)}...`;

  const txHashes = current.transactions.map((tx) => tx.id);
  const computedMerkleRoot = calculateMerkleRoot(txHashes);
  const merkleRootPassed = current.merkleRoot === computedMerkleRoot;
  const merkleRootDetail = merkleRootPassed
    ? "Matches Merkle Tree root of all transactions"
    : `Mismatch: computed ${computedMerkleRoot.slice(0, 12)}..., recorded ${current.merkleRoot.slice(0, 12)}...`;

  const computedHash = calculateBlockHash(
    current.index,
    current.previousHash,
    current.timestamp,
    current.merkleRoot,
    current.difficulty,
    current.nonce
  );
  const blockHashPassed = current.hash === computedHash;
  const blockHashDetail = blockHashPassed
    ? "Header SHA-256 matches recorded block hash"
    : `Mismatch: computed ${computedHash.slice(0, 12)}..., recorded ${current.hash.slice(0, 12)}...`;

  const targetPrefix = "0".repeat(current.difficulty);
  const powPassed = current.hash.startsWith(targetPrefix);
  const powDetail = powPassed
    ? `Satisfies difficulty ${current.difficulty} ("${targetPrefix}...")`
    : `Does not start with "${targetPrefix}"`;

  const txValidations = current.transactions.map((tx, txIndex) => {
    if (isGenesis) {
      return { txIndex, txId: tx.id, isValid: true };
    }
    const res = verifyTransaction(tx);
    if (!res.isValid) {
      return { txIndex, txId: tx.id, isValid: false, reason: res.reason };
    }
    if (tx.data.from === COINBASE_ADDRESS) {
      const expectedId = hashTransaction(tx.data).toString("hex");
      if (tx.id !== expectedId) {
        return {
          txIndex,
          txId: tx.id,
          isValid: false,
          reason: "Coinbase Transaction ID does not match payload hash (Payload Tampered)",
        };
      }
    }
    return { txIndex, txId: tx.id, isValid: true };
  });

  const failures = txValidations
    .filter((v) => !v.isValid)
    .map((v) => ({ txIndex: v.txIndex, txId: v.txId, reason: v.reason || "Invalid transaction" }));

  const txSignaturesPassed = failures.length === 0;
  const txSignaturesDetail = txSignaturesPassed
    ? `All ${current.transactions.length} transaction(s) verified`
    : `${failures.length} invalid transaction(s) detected`;

  const isValid =
    hashPointerPassed &&
    merkleRootPassed &&
    blockHashPassed &&
    powPassed &&
    txSignaturesPassed;

  return {
    index,
    isGenesis,
    isValid,
    checks: {
      hashPointer: { passed: hashPointerPassed, detail: hashPointerDetail },
      merkleRoot: { passed: merkleRootPassed, detail: merkleRootDetail, computedMerkleRoot },
      blockHash: { passed: blockHashPassed, detail: blockHashDetail, computedHash },
      powTarget: { passed: powPassed, detail: powDetail },
      txSignatures: { passed: txSignaturesPassed, detail: txSignaturesDetail, failures },
    },
    txValidations,
  };
}

function validateChainWithDiagnostics(bc: Blockchain) {
  const blockDiagnostics = bc.chain.map((_, idx) => diagnoseBlock(bc, idx));
  let validation = bc.isChainValid();

  if (validation.isValid) {
    const failedDiag = blockDiagnostics.find((d) => !d.isGenesis && !d.isValid);
    if (failedDiag) {
      const txFailure = failedDiag.checks.txSignatures.failures[0];
      validation = {
        isValid: false,
        errorBlockIndex: failedDiag.index,
        reason: txFailure
          ? `Invalid transaction ${txFailure.txId.slice(0, 10)}... in Block #${failedDiag.index}: ${txFailure.reason}`
          : `Block #${failedDiag.index} failed integrity checks`,
      };
    }
  }

  return { validation, blockDiagnostics };
}

function buildStatePayload() {
  const wallets = loadWallets();
  const persisted = loadPersistedState();
  const bc = hydrateBlockchain(persisted);
  const { validation, blockDiagnostics } = validateChainWithDiagnostics(bc);
  const enrichedChain = bc.chain.map((block, idx) => ({
    ...block,
    merkleLevels: buildMerkleTreeLevels(block.transactions.map((tx) => tx.id)),
    diagnostics: blockDiagnostics[idx],
  }));

  const walletSummaries = wallets.map((w) => ({
    id: w.id,
    name: w.name,
    address: w.address,
    publicKeyHex: w.publicKeyHex,
    confirmedBalance: bc.getBalance(w.address),
    pendingBalance: bc.getPendingBalance(w.address),
    nextNonce: bc.getNextNonce(w.address),
    createdAt: w.createdAt,
  }));

  const totalSupply = walletSummaries.reduce((sum, w) => sum + w.confirmedBalance, 0);

  const rawRole = persisted.activeRole || "node";
  const resolvedRole =
    rawRole === "node" || rawRole === "attacker" || wallets.some((w) => w.id === rawRole)
      ? rawRole
      : "node";

  return {
    initialized: bc.chain.length > 0,
    activeRole: resolvedRole,
    config: {
      difficulty: bc.difficulty,
      blockReward: bc.blockReward,
      targetPrefix: "0".repeat(bc.difficulty),
    },
    chain: enrichedChain,
    mempool: bc.mempool,
    wallets: walletSummaries,
    validation,
    totalSupply,
    lastMiningResult: persisted.lastMiningResult,
    logs: loadLogs(),
  };
}

function sendJson(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const PORT = Number(process.env.PORT) || 3002;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const pathname = url.pathname;

    // 1. GET /api/m2/state
    if (req.method === "GET" && pathname === "/api/m2/state") {
      return sendJson(res, 200, buildStatePayload());
    }

    // 1b. POST /api/m2/init (Initialize Genesis Block #0)
    if (req.method === "POST" && pathname === "/api/m2/init") {
      const persisted = loadPersistedState();
      if (persisted.chain.length > 0) {
        return sendJson(res, 400, { error: "Genesis Block (#0) is already initialized." });
      }
      const body = await readJsonBody(req);
      const difficulty =
        body.difficulty !== undefined ? Number(body.difficulty) : persisted.difficulty;
      const blockReward =
        body.blockReward !== undefined ? Number(body.blockReward) : persisted.blockReward;

      if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 4) {
        return sendJson(res, 400, {
          error: "Difficulty must be an integer between 1 and 4.",
        });
      }
      if (!Number.isFinite(blockReward) || blockReward <= 0 || blockReward > 1000000) {
        return sendJson(res, 400, {
          error: "Block reward must be a positive number up to 1,000,000.",
        });
      }

      const bc = new Blockchain(difficulty, blockReward);
      persisted.difficulty = bc.difficulty;
      persisted.blockReward = bc.blockReward;
      persisted.chain = bc.chain;
      savePersistedState(persisted);

      appendLog({
        action: "INIT_GENESIS",
        command: `curl -s -X POST http://localhost:${PORT}/api/m2/init -H 'Content-Type: application/json' -d '${JSON.stringify({ difficulty, blockReward })}'`,
        sdk: `new Blockchain(${difficulty}, ${blockReward})`,
        status: "success",
        summary: `Initialized Genesis Block (#0) with difficulty ${difficulty} and reward ${blockReward} Coins`,
        details: { hash: bc.chain[0].hash, nonce: bc.chain[0].nonce, merkleRoot: bc.chain[0].merkleRoot },
      });

      return sendJson(res, 201, {
        success: true,
        genesis: bc.chain[0],
        state: buildStatePayload(),
      });
    }

    // 2. POST /api/m2/wallets
    if (req.method === "POST" && pathname === "/api/m2/wallets") {
      const body = await readJsonBody(req);
      const name = String(body.name || "").trim();
      if (!name || name.length > 40) {
        return sendJson(res, 400, { error: "Wallet name must be between 1 and 40 characters." });
      }
      const wallets = loadWallets();
      if (wallets.some((w) => w.name.toLowerCase() === name.toLowerCase())) {
        return sendJson(res, 400, { error: `Wallet "${name}" already exists.` });
      }
      const created = createStoredWallet(name, wallets);
      wallets.push(created);
      saveWallets(wallets);

      appendLog({
        action: "CREATE_WALLET",
        command: `curl -s -X POST http://localhost:${PORT}/api/m2/wallets -H 'Content-Type: application/json' -d '${JSON.stringify({ name })}'`,
        sdk: `createWallet(${JSON.stringify(name)})`,
        status: "success",
        summary: `Created secp256k1 wallet "${created.name}" (${created.address})`,
        details: { id: created.id, address: created.address },
      });

      return sendJson(res, 201, {
        success: true,
        wallet: {
          id: created.id,
          name: created.name,
          address: created.address,
          publicKeyHex: created.publicKeyHex,
        },
        state: buildStatePayload(),
      });
    }

    // 3. POST /api/m2/config
    if (req.method === "POST" && pathname === "/api/m2/config") {
      const body = await readJsonBody(req);
      const difficulty = Number(body.difficulty);
      const blockReward = Number(body.blockReward);

      if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 4) {
        return sendJson(res, 400, {
          error: "Difficulty must be an integer between 1 and 4 to keep PoW responsive.",
        });
      }
      if (!Number.isFinite(blockReward) || blockReward <= 0 || blockReward > 1000000) {
        return sendJson(res, 400, {
          error: "Block reward must be a positive number up to 1,000,000.",
        });
      }

      const persisted = loadPersistedState();
      persisted.difficulty = difficulty;
      persisted.blockReward = blockReward;
      savePersistedState(persisted);

      appendLog({
        action: "UPDATE_CONFIG",
        command: `curl -s -X POST http://localhost:${PORT}/api/m2/config -H 'Content-Type: application/json' -d '${JSON.stringify({ difficulty, blockReward })}'`,
        sdk: `bc.difficulty = ${difficulty}; bc.blockReward = ${blockReward};`,
        status: "success",
        summary: `Updated mining difficulty to ${difficulty} and block reward to ${blockReward} Coins`,
        details: { difficulty, blockReward },
      });

      return sendJson(res, 200, {
        success: true,
        state: buildStatePayload(),
      });
    }

    // 4. POST /api/m2/tx
    if (req.method === "POST" && pathname === "/api/m2/tx") {
      const body = await readJsonBody(req);
      const fromId = String(body.fromId || "").trim();
      const toAddress = String(body.toAddress || "").trim();
      const amount = Number(body.amount);
      const fee = body.fee === undefined || body.fee === "" ? 0 : Number(body.fee);

      const wallets = loadWallets();
      const senderStored = wallets.find((w) => w.id === fromId);
      if (!senderStored) {
        return sendJson(res, 404, { error: "Sender wallet not found." });
      }
      if (!/^0x[0-9a-fA-F]{40}$/.test(toAddress)) {
        return sendJson(res, 400, { error: "Recipient must be a valid 0x... 40-hex address." });
      }
      if (toAddress.toLowerCase() === senderStored.address.toLowerCase()) {
        return sendJson(res, 400, { error: "Sender and recipient addresses cannot be the same." });
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        return sendJson(res, 400, { error: "Amount must be greater than 0." });
      }
      if (!Number.isFinite(fee) || fee < 0) {
        return sendJson(res, 400, { error: "Gas fee cannot be negative." });
      }

      const persisted = loadPersistedState();
      if (persisted.chain.length === 0) {
        return sendJson(res, 400, {
          error: "Blockchain not initialized. Initialize Genesis Block (#0) in Step 1 first.",
        });
      }
      const bc = hydrateBlockchain(persisted);
      const senderWallet = hydrateWallet(senderStored);

      const nonce =
        body.nonce !== undefined && body.nonce !== "" && body.nonce !== null
          ? Number(body.nonce)
          : bc.getNextNonce(senderWallet.address);

      if (!Number.isInteger(nonce) || nonce < 0) {
        return sendJson(res, 400, { error: "Nonce must be a non-negative integer." });
      }

      const signedTx = signTransaction(senderWallet, toAddress, amount, fee, nonce);
      const result = bc.addTransaction(signedTx);

      if (!result.success) {
        appendLog({
          action: "SIGN_TX",
          command: `curl -s -X POST http://localhost:${PORT}/api/m2/tx -H 'Content-Type: application/json' -d '${JSON.stringify({ fromId, toAddress, amount, fee, nonce })}'`,
          sdk: `bc.addTransaction(signTransaction(${senderStored.name}, "${toAddress}", ${amount}, ${fee}, ${nonce}))`,
          status: "error",
          summary: result.error || "Transaction rejected by Mempool.",
          details: { txId: signedTx.id, nonce, amount, fee },
        });
        return sendJson(res, 400, {
          error: result.error || "Transaction rejected by Mempool.",
          rejectedTx: signedTx,
        });
      }

      persisted.mempool = bc.mempool;
      savePersistedState(persisted);

      appendLog({
        action: "SIGN_TX",
        command: `curl -s -X POST http://localhost:${PORT}/api/m2/tx -H 'Content-Type: application/json' -d '${JSON.stringify({ fromId, toAddress, amount, fee, nonce })}'`,
        sdk: `signTransaction(${senderStored.name}, "${toAddress}", ${amount}, ${fee}, ${nonce})`,
        status: "success",
        summary: `Signed & queued Tx from ${senderStored.name} -> ${toAddress.slice(0, 10)}... (${amount} Coins, Fee ${fee}, Nonce ${nonce})`,
        details: { txId: signedTx.id, nonce, amount, fee },
      });

      return sendJson(res, 201, {
        success: true,
        tx: signedTx,
        state: buildStatePayload(),
      });
    }

    // 5. POST /api/m2/mine
    if (req.method === "POST" && pathname === "/api/m2/mine") {
      const body = await readJsonBody(req);
      const minerId = String(body.minerId || "").trim();
      const wallets = loadWallets();
      const miner = wallets.find((w) => w.id === minerId) || wallets[0];
      if (!miner) {
        return sendJson(res, 400, { error: "No miner wallet available." });
      }

      const persisted = loadPersistedState();
      if (persisted.chain.length === 0) {
        return sendJson(res, 400, {
          error: "Blockchain not initialized. Initialize Genesis Block (#0) in Step 1 first.",
        });
      }
      const bc = hydrateBlockchain(persisted);

      const { validation: chainCheck } = validateChainWithDiagnostics(bc);
      if (!chainCheck.isValid) {
        appendLog({
          action: "MINE_BLOCK",
          command: `curl -s -X POST http://localhost:${PORT}/api/m2/mine -H 'Content-Type: application/json' -d '${JSON.stringify({ minerId: miner.id })}'`,
          sdk: `bc.minePendingTransactions("${miner.address}")`,
          status: "error",
          summary: `Blocked mining: chain compromised at Block #${chainCheck.errorBlockIndex} (${chainCheck.reason})`,
        });
        return sendJson(res, 400, {
          error: `Cannot mine on a compromised chain (${chainCheck.reason}). Reset the chain first.`,
        });
      }

      const mineResult = bc.minePendingTransactions(miner.address);
      const telemetry: MiningTelemetry = {
        blockIndex: mineResult.block.index,
        minerId: miner.id,
        minerName: miner.name,
        minerAddress: miner.address,
        nonce: mineResult.miningResult.nonce,
        attempts: mineResult.miningResult.attempts,
        durationMs: mineResult.miningResult.durationMs,
        hashesPerSecond: mineResult.miningResult.hashesPerSecond,
        blockReward: mineResult.blockReward,
        totalGasFees: mineResult.totalGasFees,
        txCount: mineResult.block.transactions.length,
        hash: mineResult.block.hash,
        timestamp: Date.now(),
      };

      persisted.chain = bc.chain;
      persisted.mempool = bc.mempool;
      persisted.lastMiningResult = telemetry;
      savePersistedState(persisted);

      appendLog({
        action: "MINE_BLOCK",
        command: `curl -s -X POST http://localhost:${PORT}/api/m2/mine -H 'Content-Type: application/json' -d '${JSON.stringify({ minerId: miner.id })}'`,
        sdk: `bc.minePendingTransactions("${miner.address}")`,
        status: "success",
        summary: `Mined Block #${telemetry.blockIndex} in ${telemetry.attempts} tries (${telemetry.durationMs}ms), reward ${telemetry.blockReward} + ${telemetry.totalGasFees} gas -> ${miner.name}`,
        details: {
          blockIndex: telemetry.blockIndex,
          nonce: telemetry.nonce,
          attempts: telemetry.attempts,
          durationMs: telemetry.durationMs,
          hash: telemetry.hash,
        },
      });

      return sendJson(res, 200, {
        success: true,
        telemetry,
        block: mineResult.block,
        state: buildStatePayload(),
      });
    }

    // 6. POST /api/m2/tamper
    if (req.method === "POST" && pathname === "/api/m2/tamper") {
      const body = await readJsonBody(req);
      const blockIndex = Number(body.blockIndex);
      const txIndex = Number(body.txIndex);
      const newAmount = Number(body.newAmount);

      if (!Number.isInteger(blockIndex) || blockIndex <= 0) {
        return sendJson(res, 400, { error: "Select a non-genesis block (#1 or higher) to tamper." });
      }
      if (!Number.isInteger(txIndex) || txIndex < 0) {
        return sendJson(res, 400, { error: "Select a valid transaction index." });
      }
      if (!Number.isFinite(newAmount) || newAmount < 0) {
        return sendJson(res, 400, { error: "Tampered amount must be a valid non-negative number." });
      }

      const persisted = loadPersistedState();
      if (persisted.chain.length === 0) {
        return sendJson(res, 400, {
          error: "Blockchain not initialized. Initialize Genesis Block (#0) in Step 1 first.",
        });
      }
      const bc = hydrateBlockchain(persisted);

      try {
        bc.tamperBlockTransaction(blockIndex, txIndex, newAmount);
      } catch (err: any) {
        return sendJson(res, 400, { error: err.message });
      }

      persisted.chain = bc.chain;
      savePersistedState(persisted);

      appendLog({
        action: "TAMPER_BLOCK",
        command: `curl -s -X POST http://localhost:${PORT}/api/m2/tamper -H 'Content-Type: application/json' -d '${JSON.stringify({ blockIndex, txIndex, newAmount })}'`,
        sdk: `bc.tamperBlockTransaction(${blockIndex}, ${txIndex}, ${newAmount})`,
        status: "success",
        summary: `Simulated payload tamper on Block #${blockIndex}, Tx #${txIndex} (new amount: ${newAmount} Coins)`,
        details: { blockIndex, txIndex, newAmount },
      });

      return sendJson(res, 200, {
        success: true,
        state: buildStatePayload(),
      });
    }

    // 7. POST /api/m2/remine
    if (req.method === "POST" && pathname === "/api/m2/remine") {
      const body = await readJsonBody(req);
      const blockIndex = Number(body.blockIndex);

      const persisted = loadPersistedState();
      if (persisted.chain.length === 0) {
        return sendJson(res, 400, {
          error: "Blockchain not initialized. Initialize Genesis Block (#0) in Step 1 first.",
        });
      }
      const bc = hydrateBlockchain(persisted);

      if (!Number.isInteger(blockIndex) || blockIndex <= 0 || blockIndex >= bc.chain.length) {
        return sendJson(res, 400, { error: "Block index out of bounds (cannot re-mine Genesis)." });
      }

      const targetBlock = bc.chain[blockIndex];
      // Attacker updates tx.id and Merkle Root to try hiding payload changes, then re-mines PoW.
      for (const tx of targetBlock.transactions) {
        tx.id = hashTransaction(tx.data).toString("hex");
      }
      targetBlock.merkleRoot = calculateMerkleRoot(targetBlock.transactions.map((tx) => tx.id));
      targetBlock.nonce = 0;
      const miningResult = mineBlock(targetBlock, targetBlock.difficulty);

      persisted.chain = bc.chain;
      savePersistedState(persisted);

      appendLog({
        action: "REMINE_BLOCK",
        command: `curl -s -X POST http://localhost:${PORT}/api/m2/remine -H 'Content-Type: application/json' -d '${JSON.stringify({ blockIndex })}'`,
        sdk: `mineBlock(bc.chain[${blockIndex}], ${targetBlock.difficulty})`,
        status: "success",
        summary: `Attacker re-computed Merkle Root & re-mined Block #${blockIndex} (nonce ${miningResult.nonce}, ${miningResult.attempts} tries)`,
        details: { blockIndex, nonce: miningResult.nonce, attempts: miningResult.attempts, hash: targetBlock.hash },
      });

      return sendJson(res, 200, {
        success: true,
        miningResult,
        state: buildStatePayload(),
      });
    }

    // 8. POST /api/m2/reset
    if (req.method === "POST" && pathname === "/api/m2/reset") {
      if (fs.existsSync(WALLETS_FILE)) {
        fs.unlinkSync(WALLETS_FILE);
      }
      if (fs.existsSync(STATE_FILE)) {
        fs.unlinkSync(STATE_FILE);
      }
      loadWallets();
      createInitialPersistedState();
      appendLog({
        action: "RESET_LAB",
        command: `curl -s -X POST http://localhost:${PORT}/api/m2/reset`,
        sdk: `rm -f state.json wallets.json`,
        status: "success",
        summary: "Reset blockchain and wallets back to clean slate (0 blocks, 0 wallets)",
      });
      return sendJson(res, 200, {
        success: true,
        state: buildStatePayload(),
      });
    }

    // 10. POST /api/m2/select-role
    if (req.method === "POST" && pathname === "/api/m2/select-role") {
      const body = await readJsonBody(req);
      const role = String(body.role || "node").trim();
      const wallets = loadWallets();
      const valid = role === "node" || role === "attacker" || wallets.some((w) => w.id === role);
      if (!valid) {
        return sendJson(res, 400, { error: `Unknown role "${role}".` });
      }
      const persisted = loadPersistedState();
      persisted.activeRole = role;
      savePersistedState(persisted);
      return sendJson(res, 200, {
        success: true,
        state: buildStatePayload(),
      });
    }

    // 9. DELETE /api/m2/logs
    if (req.method === "DELETE" && pathname === "/api/m2/logs") {
      clearLogs();
      return sendJson(res, 200, {
        success: true,
        state: buildStatePayload(),
      });
    }

    // Static File Server
    if (serveCoreAssetIfMatch(res, pathname)) return;

    const safePath = pathname === "/" ? "/index.html" : pathname;
    const filePath = path.resolve(PUBLIC_DIR, `.${safePath}`);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const contentType = MIME_TYPES[ext] || "application/octet-stream";
      res.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      });
      return fs.createReadStream(filePath).pipe(res);
    }

    res.writeHead(404);
    res.end("Not Found");
  } catch (err: any) {
    console.error("Module 2 Server error:", err);
    sendJson(res, 500, { error: err.message || "Internal Server Error" });
  }
});

const isMain = process.argv[1] ? path.resolve(process.argv[1]) === __filename : false;
if (isMain && process.env.TEST_MODE !== "true") {
  server.listen(PORT, () => {
    console.log(`\n===============================================================`);
    console.log(` ⛓️  Module 2: Blockchain & Proof-of-Work UI running at http://localhost:${PORT}`);
    console.log(`===============================================================\n`);
  });
}

export { server };
