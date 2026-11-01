import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import { createWallet, verifyAddressFromPublicKey } from "../wallet.ts";
import type { Wallet } from "../wallet.ts";
import {
  signTransaction,
  verifyTransaction,
  hashTransaction,
  serializeTransaction,
} from "../transaction.ts";
import type { SignedTransaction, TransactionData, VerificationResult } from "../transaction.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "public");

// -----------------------------------------------------------------------------
// IN-MEMORY BLOCKCHAIN NODE STATE (MODULE 1)
// -----------------------------------------------------------------------------
interface WalletAccount {
  wallet: Wallet;
  balance: number;
  nonce: number;
}

interface RecordedTransaction {
  id: string;
  txHash: string;
  signedTx: SignedTransaction;
  status: "broadcasted" | "rejected";
  recordedAt: number;
  reason?: string;
}

// Map of address -> WalletAccount
let accounts = new Map<string, WalletAccount>();
let transactions: RecordedTransaction[] = [];

function clearAllState() {
  accounts.clear();
  transactions = [];
}

// Start with completely clean / empty state (Zero pre-built accounts)
clearAllState();

// -----------------------------------------------------------------------------
// HTTP UTILITIES
// -----------------------------------------------------------------------------
function sendJson(res: http.ServerResponse, status: number, data: any) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) {
        reject(new Error("Payload too large (max 2MB)"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
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

// -----------------------------------------------------------------------------
// HTTP SERVER (PORT 3001)
// -----------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  // Enable CORS for easy local dev
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    // -------------------------------------------------------------------------
    // 1. GET /api/m1/state: Return all wallets, balances, and transaction history
    // -------------------------------------------------------------------------
    if (req.method === "GET" && pathname === "/api/m1/state") {
      const walletList = Array.from(accounts.values()).map((acc) => {
        // Export private key PEM for educational UI inspection
        const privKeyPem = acc.wallet.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
        return {
          name: acc.wallet.name,
          address: acc.wallet.address,
          publicKeyHex: acc.wallet.publicKeyHex,
          privateKeyPem: privKeyPem,
          balance: acc.balance,
          nonce: acc.nonce,
        };
      });

      return sendJson(res, 200, {
        wallets: walletList,
        transactions,
        stats: {
          totalWallets: walletList.length,
          totalTransactions: transactions.length,
        },
      });
    }

    // -------------------------------------------------------------------------
    // 2. POST /api/m1/wallets: Generate a new secp256k1 wallet
    // -------------------------------------------------------------------------
    if (req.method === "POST" && pathname === "/api/m1/wallets") {
      const body = await parseJsonBody(req);
      const name = (body.name || "Wallet-" + Math.floor(1000 + Math.random() * 9000)).trim();
      const initialBalance = Number(body.initialBalance) >= 0 ? Number(body.initialBalance) : 25;

      const newWallet = createWallet(name);
      accounts.set(newWallet.address.toLowerCase(), {
        wallet: newWallet,
        balance: initialBalance,
        nonce: 0,
      });

      const privKeyPem = newWallet.privateKey.export({ type: "pkcs8", format: "pem" }) as string;

      return sendJson(res, 201, {
        success: true,
        wallet: {
          name: newWallet.name,
          address: newWallet.address,
          publicKeyHex: newWallet.publicKeyHex,
          privateKeyPem: privKeyPem,
          balance: initialBalance,
          nonce: 0,
        },
      });
    }

    // -------------------------------------------------------------------------
    // 3. POST /api/m1/wallets/reset: Reset to empty clean state
    // -------------------------------------------------------------------------
    if (req.method === "POST" && pathname === "/api/m1/wallets/reset") {
      clearAllState();
      return sendJson(res, 200, { success: true, message: "Cleared all wallets and transactions to clean scratch state." });
    }

    // -------------------------------------------------------------------------
    // 3b. POST /api/m1/wallets/seed: Optional helper to seed demo trio
    // -------------------------------------------------------------------------
    if (req.method === "POST" && pathname === "/api/m1/wallets/seed") {
      const alice = createWallet("Alice");
      const bob = createWallet("Bob");
      const mallory = createWallet("Mallory (Attacker)");

      accounts.set(alice.address.toLowerCase(), { wallet: alice, balance: 100, nonce: 0 });
      accounts.set(bob.address.toLowerCase(), { wallet: bob, balance: 50, nonce: 0 });
      accounts.set(mallory.address.toLowerCase(), { wallet: mallory, balance: 10, nonce: 0 });

      return sendJson(res, 200, { success: true, message: "Seeded starter demo wallets (Alice, Bob, Mallory)." });
    }

    // -------------------------------------------------------------------------
    // 4. POST /api/m1/transactions/sign: Sign a transaction using a stored wallet
    // -------------------------------------------------------------------------
    if (req.method === "POST" && pathname === "/api/m1/transactions/sign") {
      const body = await parseJsonBody(req);
      const { senderAddress, to, amount } = body;

      if (!senderAddress || !to || typeof amount !== "number" || amount <= 0) {
        return sendJson(res, 400, { error: "Missing or invalid senderAddress, to, or amount" });
      }

      const senderAccount = accounts.get(senderAddress.toLowerCase());
      if (!senderAccount) {
        return sendJson(res, 404, { error: "Sender wallet not found in local node keystore" });
      }

      // Use sender's current nonce
      const nonce = senderAccount.nonce;
      const signedTx = signTransaction(senderAccount.wallet, to, amount, nonce);
      const canonicalJson = serializeTransaction(signedTx.data);
      const txHash = hashTransaction(signedTx.data).toString("hex");

      return sendJson(res, 200, {
        success: true,
        signedTx,
        canonicalJson,
        txHash,
        nonce,
      });
    }

    // -------------------------------------------------------------------------
    // 5. POST /api/m1/transactions/verify: Cryptographically verify any SignedTransaction
    // -------------------------------------------------------------------------
    if (req.method === "POST" && pathname === "/api/m1/transactions/verify") {
      const body = await parseJsonBody(req);
      const signedTx = body.signedTx as SignedTransaction;

      if (!signedTx || !signedTx.data || !signedTx.signatureHex || !signedTx.senderPublicKeyHex) {
        return sendJson(res, 400, { error: "Invalid SignedTransaction structure" });
      }

      // Detailed step-by-step verification
      const rawPubBuffer = Buffer.from(signedTx.senderPublicKeyHex, "hex");
      const spkiPrefix = Buffer.from("3056301006072a8648ce3d020106052b8104000a034200", "hex");
      const fullSpkiDer = Buffer.concat([spkiPrefix, rawPubBuffer]);

      let publicKey: crypto.KeyObject | null = null;
      let addressMatches = false;
      let derivedAddress = "";
      let signatureValid = false;
      let malformedKey = false;

      try {
        publicKey = crypto.createPublicKey({
          key: fullSpkiDer,
          format: "der",
          type: "spki",
        });
      } catch {
        malformedKey = true;
      }

      if (publicKey) {
        // Derive address manually for visual inspection
        const spki = publicKey.export({ type: "spki", format: "der" });
        const rawPub = spki.subarray(spki.length - 65);
        const coords = rawPub.subarray(1);
        const hash = crypto.createHash("sha3-256").update(coords).digest();
        derivedAddress = "0x" + hash.subarray(hash.length - 20).toString("hex");

        addressMatches = derivedAddress.toLowerCase() === signedTx.data.from.toLowerCase();

        const txHash = hashTransaction(signedTx.data);
        const signatureBuffer = Buffer.from(signedTx.signatureHex, "hex");
        signatureValid = crypto.verify("SHA256", txHash, publicKey, signatureBuffer);
      }

      const result = verifyTransaction(signedTx);
      const canonicalJson = serializeTransaction(signedTx.data);
      const txHashHex = hashTransaction(signedTx.data).toString("hex");

      return sendJson(res, 200, {
        isValid: result.isValid,
        reason: result.reason || "Cryptographic verification succeeded without any central CA!",
        proofs: {
          canonicalJson,
          txHashHex,
          claimedSender: signedTx.data.from,
          derivedAddressFromPubKey: derivedAddress,
          addressMatches,
          signatureValid,
          malformedKey,
        },
      });
    }

    // -------------------------------------------------------------------------
    // 6. POST /api/m1/transactions/broadcast: Verify, enforce balance/nonce, and execute
    // -------------------------------------------------------------------------
    if (req.method === "POST" && pathname === "/api/m1/transactions/broadcast") {
      const body = await parseJsonBody(req);
      const signedTx = body.signedTx as SignedTransaction;

      if (!signedTx || !signedTx.data) {
        return sendJson(res, 400, { error: "Missing signedTx" });
      }

      // Step 1: Cryptographic verification
      const verifyResult = verifyTransaction(signedTx);
      const txHashHex = hashTransaction(signedTx.data).toString("hex");

      if (!verifyResult.isValid) {
        const rejectedTx: RecordedTransaction = {
          id: "tx-" + Date.now(),
          txHash: txHashHex,
          signedTx,
          status: "rejected",
          recordedAt: Date.now(),
          reason: verifyResult.reason,
        };
        transactions.unshift(rejectedTx);
        return sendJson(res, 400, {
          success: false,
          error: `Cryptographic rejection: ${verifyResult.reason}`,
          tx: rejectedTx,
        });
      }

      // Step 2: Blockchain State Verification (Nonce & Balance)
      const senderAcc = accounts.get(signedTx.data.from.toLowerCase());
      if (!senderAcc) {
        return sendJson(res, 400, {
          success: false,
          error: "Sender address has no balance or history on this node",
        });
      }

      if (signedTx.data.nonce !== senderAcc.nonce) {
        return sendJson(res, 400, {
          success: false,
          error: `Invalid Nonce! Expected ${senderAcc.nonce}, received ${signedTx.data.nonce} (Replay Attack Prevention)`,
        });
      }

      if (senderAcc.balance < signedTx.data.amount) {
        return sendJson(res, 400, {
          success: false,
          error: `Insufficient balance! Account has ${senderAcc.balance} coins, tried to spend ${signedTx.data.amount}`,
        });
      }

      // Step 3: Execute transfer
      senderAcc.balance -= signedTx.data.amount;
      senderAcc.nonce += 1;

      const recipientAcc = accounts.get(signedTx.data.to.toLowerCase());
      if (recipientAcc) {
        recipientAcc.balance += signedTx.data.amount;
      }

      const recordedTx: RecordedTransaction = {
        id: "tx-" + Date.now(),
        txHash: txHashHex,
        signedTx,
        status: "broadcasted",
        recordedAt: Date.now(),
      };
      transactions.unshift(recordedTx);

      return sendJson(res, 200, {
        success: true,
        message: "Transaction accepted and confirmed by network consensus rules!",
        tx: recordedTx,
        senderNewBalance: senderAcc.balance,
        senderNewNonce: senderAcc.nonce,
        recipientNewBalance: recipientAcc?.balance,
      });
    }

    // -------------------------------------------------------------------------
    // 7. POST /api/m1/attack-simulation: Execute live interactive attack scenarios
    // -------------------------------------------------------------------------
    if (req.method === "POST" && pathname === "/api/m1/attack-simulation") {
      const body = await parseJsonBody(req);
      const attackType = body.attackType as string;

      // Use existing wallets or generate standalone ephemeral actors for the simulation
      let alice = Array.from(accounts.values()).find((a) => a.wallet.name.toLowerCase().includes("alice"))?.wallet;
      let bob = Array.from(accounts.values()).find((a) => a.wallet.name.toLowerCase().includes("bob"))?.wallet;
      let mallory = Array.from(accounts.values()).find((a) => a.wallet.name.toLowerCase().includes("mallory"))?.wallet;

      if (!alice) alice = createWallet("Alice");
      if (!bob) bob = createWallet("Bob");
      if (!mallory) mallory = createWallet("Mallory (Attacker)");

      // Base legitimate transaction: Alice sends 15 coins to Bob
      const originalTx = signTransaction(alice, bob.address, 15, 0);
      const originalHash = hashTransaction(originalTx.data).toString("hex");

      let tamperedTx: SignedTransaction;
      let title = "";
      let description = "";
      let failureStep = "";
      let explanation = "";

      if (attackType === "tamper_amount") {
        title = "Attack 1: Tampering With Transaction Amount";
        description = "Mallory intercepts Alice's transaction in transit and changes 'amount' from 15 to 1,500 coins.";
        tamperedTx = {
          ...originalTx,
          data: {
            ...originalTx.data,
            amount: 1500, // Altered
          },
        };
        failureStep = "Step 3: ECDSA Signature Verification (crypto.verify)";
        explanation =
          "The signature was created using the SHA-256 hash of the original data (`amount: 15`). Modifying the amount to `1500` produces a completely different hash. Mathematically, Alice's original signature fails to verify against the new hash. Math rejects it without contacting any CA!";
      } else if (attackType === "hijack_recipient") {
        title = "Attack 2: Hijacking the Recipient Address";
        description = "Mallory intercepts the transaction and changes 'to' from Bob's address to Mallory's address.";
        tamperedTx = {
          ...originalTx,
          data: {
            ...originalTx.data,
            to: mallory.address, // Altered
          },
        };
        failureStep = "Step 3: ECDSA Signature Verification (crypto.verify)";
        explanation =
          "Because the recipient address is embedded in the signed message payload, altering the recipient address alters the message hash. Alice's signature will not validate over the altered recipient!";
      } else if (attackType === "spoof_identity") {
        title = "Attack 3: Identity Spoofing (Forged Sender)";
        description = "Mallory signs a transaction spending Alice's coins, but signs it using Mallory's own private key.";
        const spoofed = signTransaction(mallory, bob.address, 50, 0);
        tamperedTx = {
          ...spoofed,
          data: {
            ...spoofed.data,
            from: alice.address, // Mallory claims sender is Alice!
          },
        };
        failureStep = "Step 1: Public Key -> Address Derivation Match (Hash(PubKey) == From)";
        explanation =
          "Mallory can create a valid signature with her own private key, BUT her public key hashes to Mallory's address (`" +
          mallory.address +
          "`), NOT Alice's address (`" +
          alice.address +
          "`). The validator catches this immediately in Check 1!";
      } else if (attackType === "replay_attack") {
        title = "Attack 4: Transaction Replay Attack";
        description = "Mallory broadcasts a legitimate, already-confirmed transaction a second time to drain Alice's funds.";
        // Legitimate transaction with nonce 0
        tamperedTx = originalTx;
        failureStep = "Blockchain State Validation: Account Nonce Check";
        explanation =
          "The cryptographic signature is mathematically valid! However, every transaction includes a strictly incrementing 'nonce'. Once Alice's account processes nonce 0, her next valid transaction must have nonce 1. The validator rejects replayed transactions at the state ledger layer.";
      } else {
        return sendJson(res, 400, { error: "Unknown attackType. Available: tamper_amount, hijack_recipient, spoof_identity, replay_attack" });
      }

      const verifyResult = verifyTransaction(tamperedTx);
      const tamperedHash = hashTransaction(tamperedTx.data).toString("hex");

      return sendJson(res, 200, {
        title,
        description,
        attackType,
        originalTx,
        originalHash,
        tamperedTx,
        tamperedHash,
        verificationResult: verifyResult,
        failureStep,
        explanation,
      });
    }

    // -------------------------------------------------------------------------
    // 8. STATIC FILE SERVER
    // -------------------------------------------------------------------------
    let filePath = pathname === "/" ? path.join(PUBLIC_DIR, "index.html") : path.join(PUBLIC_DIR, pathname);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const contentType = MIME_TYPES[ext] || "application/octet-stream";
      res.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "no-cache, no-store, must-revalidate",
      });
      return fs.createReadStream(filePath).pipe(res);
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  } catch (err: any) {
    console.error("Server error:", err);
    sendJson(res, 500, { error: err.message || "Internal server error" });
  }
});

export { server };

const PORT = Number(process.env.PORT || 3001);
if (process.env.TEST_MODE !== "true") {
  server.listen(PORT, () => {
    console.log(`\n===============================================================`);
    console.log(` ⛓️  Module 1: Blockchain Cryptography & Wallets UI`);
    console.log(` 🌐 Running at http://localhost:${PORT}`);
    console.log(`===============================================================\n`);
  });
}
