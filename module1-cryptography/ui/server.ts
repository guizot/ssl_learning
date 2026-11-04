import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { serializeTransaction, hashTransaction } from "../transaction.ts";
import type { TransactionData } from "../transaction.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../..");
const M1_DIR = path.join(ROOT_DIR, "module1-cryptography", "generated");
const WALLETS_DIR = path.join(M1_DIR, "wallets");
const TXS_DIR = path.join(M1_DIR, "transactions");
const STORE_FILE = path.join(M1_DIR, "wallets.json");
const TXS_FILE = path.join(M1_DIR, "transactions.json");
const PUBLIC_DIR = path.join(__dirname, "public");

// Ensure generated directories exist
[M1_DIR, WALLETS_DIR, TXS_DIR].forEach((d) => {
  if (!fs.existsSync(d)) {
    fs.mkdirSync(d, { recursive: true });
  }
});

// -----------------------------------------------------------------------------
// DATA MODELS & PERSISTENCE
// -----------------------------------------------------------------------------
export interface WalletMeta {
  id: string;
  name: string;
  balance: number;
  nonce: number;
  createdAt: number;
}

export interface TxRecord {
  id: string;
  fromId: string;
  fromName: string;
  fromAddress: string;
  toId: string;
  toName: string;
  toAddress: string;
  amount: number;
  nonce: number;
  memo: string;
  timestamp: number;
  signed: boolean;
  canonicalJson: string;
  txHashHex: string;
  signatureHex: string;
  senderPublicKeyHex: string;
  senderPubKeyPem: string;
  txFile: string;
  sigFile?: string;
  tampered?: boolean;
  originalAmount?: number;
  settled?: boolean;
  verifiedState?: "unverified" | "valid" | "invalid";
  verifyReason?: string;
  addressMatch?: boolean;
  signatureMatch?: boolean;
  balanceMatch?: boolean;
  derivedAddress?: string;
}

interface M1Store {
  activeRole: "node" | string;
  activeId: string;
  wallets: WalletMeta[];
}

function loadStore(): M1Store {
  if (fs.existsSync(STORE_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(STORE_FILE, "utf-8"));
      if (Array.isArray(data.wallets)) {
        return {
          activeRole: data.activeRole || "node",
          activeId: data.activeId || "",
          wallets: data.wallets,
        };
      }
    } catch {}
  }
  const initial: M1Store = { activeRole: "node", activeId: "", wallets: [] };
  saveStore(initial);
  return initial;
}

function saveStore(store: M1Store) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf-8");
}

function loadTxs(): TxRecord[] {
  if (fs.existsSync(TXS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(TXS_FILE, "utf-8"));
      if (Array.isArray(data)) return data;
    } catch {}
  }
  return [];
}

function saveTxs(txs: TxRecord[]) {
  fs.writeFileSync(TXS_FILE, JSON.stringify(txs, null, 2), "utf-8");
}

function getWalletDir(id: string): string {
  const safeId = id.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  const dir = path.join(WALLETS_DIR, safeId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

interface OpenSSLLog {
  command: string;
  output: string;
}

function runM1OpenSSL(args: string[]): OpenSSLLog {
  const cmdString = `openssl ${args.join(" ")}`;
  try {
    const out = execFileSync("openssl", args, {
      cwd: M1_DIR,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { command: cmdString, output: (out || "(Success — 0 exit code)").trim() };
  } catch (err: any) {
    const stderr = err.stderr ? err.stderr.toString() : err.message;
    const stdout = err.stdout ? err.stdout.toString() : "";
    return { command: cmdString, output: `${stdout}\n${stderr}`.trim() };
  }
}

// Extract public key coordinates (X, Y) and SHA3-256 address from a public key PEM
function inspectPublicKeyPem(pubPem: string) {
  const pubKeyObj = crypto.createPublicKey(pubPem);
  const jwk = pubKeyObj.export({ format: "jwk" }) as { x: string; y: string };
  const xBytes = Buffer.from(jwk.x, "base64url");
  const yBytes = Buffer.from(jwk.y, "base64url");

  const prefixByte = "04";
  const xCoordHex = xBytes.toString("hex").padStart(64, "0");
  const yCoordHex = yBytes.toString("hex").padStart(64, "0");
  const publicKeyFullHex = prefixByte + xCoordHex + yCoordHex;

  const coordinates = Buffer.concat([xBytes, yBytes]);
  const hash = crypto.createHash("sha3-256").update(coordinates).digest();
  const sha3HashHex = hash.toString("hex");
  const discardedBytesHex = sha3HashHex.slice(0, 24); // First 12 bytes
  const addressBytesHex = sha3HashHex.slice(24);      // Last 20 bytes
  const derivedAddress = "0x" + addressBytesHex;

  return {
    prefixByte,
    xCoordHex,
    yCoordHex,
    publicKeyFullHex,
    sha3HashHex,
    discardedBytesHex,
    addressBytesHex,
    derivedAddress,
  };
}

// Extract private key scalar from private key PEM
function inspectPrivateKeyPem(privPem: string) {
  const privKeyObj = crypto.createPrivateKey(privPem);
  const jwk = privKeyObj.export({ format: "jwk" }) as { d: string; x: string; y: string };
  const privBytes = Buffer.from(jwk.d, "base64url");
  const privateKeyHex = privBytes.toString("hex").padStart(64, "0");
  const privateKeyDecimal = BigInt("0x" + privateKeyHex).toString(10);
  return {
    privateKeyHex,
    privateKeyDecimal,
    privKeyObj,
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
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
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
const PORT = Number(process.env.PORT) || 3001;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const pathname = url.pathname;

    // =========================================================================
    // 1. GET /api/m1/state
    // =========================================================================
    if (req.method === "GET" && pathname === "/api/m1/state") {
      const store = loadStore();
      const allTxs = loadTxs();

      const walletList = store.wallets.map((w) => {
        const wDir = getWalletDir(w.id);
        const keyP = path.join(wDir, `${w.id}.key`);
        const pubP = path.join(wDir, `${w.id}.pub`);
        const addrP = path.join(wDir, `${w.id}.addr`);

        const keyExists = fs.existsSync(keyP);
        const pubExists = fs.existsSync(pubP);
        const addrExists = fs.existsSync(addrP);

        let pubMatchesKey = false;
        if (keyExists && pubExists) {
          try {
            const kObj = crypto.createPrivateKey(fs.readFileSync(keyP, "utf-8"));
            const derivedPubPem = crypto.createPublicKey(kObj).export({ type: "spki", format: "pem" }).toString().trim();
            const diskPubPem = crypto.createPublicKey(fs.readFileSync(pubP, "utf-8")).export({ type: "spki", format: "pem" }).toString().trim();
            pubMatchesKey = derivedPubPem === diskPubPem;
          } catch {
            pubMatchesKey = false;
          }
        }

        let address = "";
        let addrMatchesPub = false;
        if (addrExists) {
          address = fs.readFileSync(addrP, "utf-8").trim();
          if (pubExists) {
            try {
              const pubInfo = inspectPublicKeyPem(fs.readFileSync(pubP, "utf-8"));
              addrMatchesPub = pubInfo.derivedAddress.toLowerCase() === address.toLowerCase();
            } catch {
              addrMatchesPub = false;
            }
          }
        }

        const sentCount = allTxs.filter((m) => m.fromId === w.id).length;
        const inboxCount = allTxs.filter((m) => m.toId === w.id).length;

        return {
          id: w.id,
          name: w.name,
          balance: w.balance,
          nonce: w.nonce,
          keyExists,
          keySize: keyExists ? fs.statSync(keyP).size : 0,
          pubExists,
          pubSize: pubExists ? fs.statSync(pubP).size : 0,
          addrExists,
          addrSize: addrExists ? fs.statSync(addrP).size : 0,
          address,
          pubMatchesKey,
          addrMatchesPub,
          sentCount,
          inboxCount,
        };
      });

      const activeWallet = walletList.find((w) => w.id === store.activeId) || walletList[0] || null;
      let activeDetails = null;

      if (activeWallet) {
        const wDir = getWalletDir(activeWallet.id);
        const keyP = path.join(wDir, `${activeWallet.id}.key`);
        const pubP = path.join(wDir, `${activeWallet.id}.pub`);
        const addrP = path.join(wDir, `${activeWallet.id}.addr`);

        const keyPem = activeWallet.keyExists ? fs.readFileSync(keyP, "utf-8").trim() : "";
        const pubPem = activeWallet.pubExists ? fs.readFileSync(pubP, "utf-8").trim() : "";
        const address = activeWallet.addrExists ? fs.readFileSync(addrP, "utf-8").trim() : "";

        let privInfo = { privateKeyHex: "", privateKeyDecimal: "" };
        if (keyPem) {
          try {
            const p = inspectPrivateKeyPem(keyPem);
            privInfo = { privateKeyHex: p.privateKeyHex, privateKeyDecimal: p.privateKeyDecimal };
          } catch {}
        }

        let pubInfo = {
          prefixByte: "04",
          xCoordHex: "",
          yCoordHex: "",
          publicKeyFullHex: "",
          sha3HashHex: "",
          discardedBytesHex: "",
          addressBytesHex: "",
          derivedAddress: "",
        };
        if (pubPem) {
          try {
            pubInfo = inspectPublicKeyPem(pubPem);
          } catch {}
        }

        const sentMessages = allTxs.filter((m) => m.fromId === activeWallet.id);
        const inboxMessages = allTxs.filter((m) => m.toId === activeWallet.id);

        activeDetails = {
          ...activeWallet,
          keyPem,
          pubPem,
          address,
          ...privInfo,
          ...pubInfo,
          sentMessages,
          inboxMessages,
        };
      }

      return sendJson(res, 200, {
        wallets: walletList,
        activeRole: store.activeRole || "node",
        activeId: activeWallet ? activeWallet.id : "",
        activeDetails,
        allTransactions: allTxs,
      });
    }

    // =========================================================================
    // 2. POST /api/m1/select-role
    // =========================================================================
    if (req.method === "POST" && pathname === "/api/m1/select-role") {
      const body = await readJsonBody(req);
      const store = loadStore();
      const role = String(body.role || "node").trim();
      store.activeRole = role;
      if (role !== "node" && store.wallets.some((w) => w.id === role)) {
        store.activeId = role;
      }
      saveStore(store);
      return sendJson(res, 200, { success: true, activeRole: store.activeRole, activeId: store.activeId });
    }

    // =========================================================================
    // 3. POST /api/m1/wallets (Register new wallet in clean 0-step state)
    // =========================================================================
    if (req.method === "POST" && pathname === "/api/m1/wallets") {
      const body = await readJsonBody(req);
      const rawName = (body.name || "").trim();
      if (!rawName) {
        return sendJson(res, 400, { error: "Please enter a wallet owner name." });
      }
      const safeId = (body.id || rawName.toLowerCase().replace(/[^a-z0-9_-]/g, "_").replace(/^_+|_+$/g, "")).slice(0, 24);
      if (!safeId) {
        return sendJson(res, 400, { error: "Wallet name must contain at least one letter or number." });
      }
      if (safeId === "node") {
        return sendJson(res, 400, { error: "'node' is a reserved system role ID." });
      }

      const store = loadStore();
      if (store.wallets.some((w) => w.id === safeId)) {
        return sendJson(res, 409, { error: `Wallet '${rawName}' (id: ${safeId}) already exists!` });
      }

      getWalletDir(safeId);
      store.wallets.push({
        id: safeId,
        name: rawName,
        balance: 0,
        nonce: 0,
        createdAt: Date.now(),
      });
      store.activeId = safeId;
      saveStore(store);

      return sendJson(res, 201, { success: true, id: safeId, name: rawName });
    }

    // =========================================================================
    // 4. DELETE /api/m1/wallet/:id
    // =========================================================================
    if (req.method === "DELETE" && pathname.startsWith("/api/m1/wallet/")) {
      const idToDelete = pathname.replace("/api/m1/wallet/", "").trim();
      const store = loadStore();
      const idx = store.wallets.findIndex((w) => w.id === idToDelete);
      if (idx === -1) {
        return sendJson(res, 404, { error: "Wallet not found" });
      }
      store.wallets.splice(idx, 1);
      if (store.activeId === idToDelete) {
        store.activeId = store.wallets[0]?.id || "";
      }
      if (store.activeRole === idToDelete) {
        store.activeRole = "node";
      }
      saveStore(store);

      const wDir = path.join(WALLETS_DIR, idToDelete);
      if (fs.existsSync(wDir)) {
        try {
          fs.rmSync(wDir, { recursive: true, force: true });
        } catch {}
      }

      return sendJson(res, 200, { success: true, activeId: store.activeId, activeRole: store.activeRole });
    }

    // =========================================================================
    // 5. POST /api/m1/wallet/step1-key (Step 1: Generate secp256k1 Private Key)
    // =========================================================================
    if (req.method === "POST" && pathname === "/api/m1/wallet/step1-key") {
      const body = await readJsonBody(req);
      const store = loadStore();
      const id = (body.id || store.activeId || "").trim();
      if (!id || !store.wallets.some((w) => w.id === id)) {
        return sendJson(res, 400, { error: "Wallet not found" });
      }
      getWalletDir(id);

      const logs: OpenSSLLog[] = [];
      logs.push(
        runM1OpenSSL([
          "ecparam",
          "-name",
          "secp256k1",
          "-genkey",
          "-noout",
          "-out",
          `wallets/${id}/${id}.key`,
        ])
      );
      logs.push(runM1OpenSSL(["ec", "-in", `wallets/${id}/${id}.key`, "-text", "-noout"]));

      const keyP = path.join(getWalletDir(id), `${id}.key`);
      const keyPem = fs.readFileSync(keyP, "utf-8").trim();
      const privInfo = inspectPrivateKeyPem(keyPem);

      return sendJson(res, 200, {
        success: true,
        id,
        privateKeyHex: privInfo.privateKeyHex,
        opensslLogs: logs,
      });
    }

    // =========================================================================
    // 6. POST /api/m1/wallet/step2-pub (Step 2: Derive Public Key Point X, Y)
    // =========================================================================
    if (req.method === "POST" && pathname === "/api/m1/wallet/step2-pub") {
      const body = await readJsonBody(req);
      const store = loadStore();
      const id = (body.id || store.activeId || "").trim();
      if (!id || !store.wallets.some((w) => w.id === id)) {
        return sendJson(res, 400, { error: "Wallet not found" });
      }

      const wDir = getWalletDir(id);
      const keyP = path.join(wDir, `${id}.key`);
      if (!fs.existsSync(keyP)) {
        return sendJson(res, 400, {
          error: `Private key wallets/${id}/${id}.key does not exist yet! Generate Private Key (.key) first.`,
        });
      }

      const logs: OpenSSLLog[] = [];
      logs.push(
        runM1OpenSSL([
          "ec",
          "-in",
          `wallets/${id}/${id}.key`,
          "-pubout",
          "-out",
          `wallets/${id}/${id}.pub`,
        ])
      );
      logs.push(runM1OpenSSL(["ec", "-in", `wallets/${id}/${id}.pub`, "-pubin", "-text", "-noout"]));

      const pubP = path.join(wDir, `${id}.pub`);
      const pubPem = fs.readFileSync(pubP, "utf-8").trim();
      const pubInfo = inspectPublicKeyPem(pubPem);

      return sendJson(res, 200, {
        success: true,
        id,
        ...pubInfo,
        opensslLogs: logs,
      });
    }

    // =========================================================================
    // 7. POST /api/m1/wallet/step3-addr (Step 3: Derive 0x Address via SHA3-256)
    // =========================================================================
    if (req.method === "POST" && pathname === "/api/m1/wallet/step3-addr") {
      const body = await readJsonBody(req);
      const store = loadStore();
      const id = (body.id || store.activeId || "").trim();
      const walletMeta = store.wallets.find((w) => w.id === id);
      if (!walletMeta) {
        return sendJson(res, 400, { error: "Wallet not found" });
      }

      const wDir = getWalletDir(id);
      const pubP = path.join(wDir, `${id}.pub`);
      if (!fs.existsSync(pubP)) {
        return sendJson(res, 400, {
          error: `Public key wallets/${id}/${id}.pub does not exist yet! Derive Public Key (.pub) first.`,
        });
      }

      const pubPem = fs.readFileSync(pubP, "utf-8").trim();
      const pubInfo = inspectPublicKeyPem(pubPem);

      const addrP = path.join(wDir, `${id}.addr`);
      fs.writeFileSync(addrP, pubInfo.derivedAddress + "\n", "utf-8");

      return sendJson(res, 200, {
        success: true,
        id,
        address: pubInfo.derivedAddress,
        sha3HashHex: pubInfo.sha3HashHex,
        discardedBytesHex: pubInfo.discardedBytesHex,
        addressBytesHex: pubInfo.addressBytesHex,
        balance: walletMeta.balance,
      });
    }

    // =========================================================================
    // 7b. POST /api/m1/wallet/faucet (Request Testnet Faucet +100 Coins)
    // =========================================================================
    if (req.method === "POST" && pathname === "/api/m1/wallet/faucet") {
      const body = await readJsonBody(req);
      const store = loadStore();
      const id = (body.id || store.activeId || "").trim();
      const walletMeta = store.wallets.find((w) => w.id === id);
      if (!walletMeta) {
        return sendJson(res, 400, { error: "Wallet not found" });
      }

      const wDir = getWalletDir(id);
      const addrP = path.join(wDir, `${id}.addr`);
      if (!fs.existsSync(addrP)) {
        return sendJson(res, 400, {
          error: `Blockchain address wallets/${id}/${id}.addr does not exist yet! Derive Address (.addr) first.`,
        });
      }

      const address = fs.readFileSync(addrP, "utf-8").trim();
      walletMeta.balance += 100;
      saveStore(store);

      return sendJson(res, 200, {
        success: true,
        id,
        address,
        amountAdded: 100,
        balance: walletMeta.balance,
      });
    }

    // =========================================================================
    // 8. POST /api/m1/wallet/remove-file (Remove .key, .pub, or .addr)
    // =========================================================================
    if (req.method === "POST" && pathname === "/api/m1/wallet/remove-file") {
      const body = await readJsonBody(req);
      const store = loadStore();
      const walletId = (body.walletId || store.activeId || "").trim();
      const fileType = (body.fileType || "").trim(); // "key", "pub", "addr", "all"

      if (!walletId) {
        return sendJson(res, 400, { error: "Missing walletId" });
      }

      const wDir = getWalletDir(walletId);
      const keyP = path.join(wDir, `${walletId}.key`);
      const pubP = path.join(wDir, `${walletId}.pub`);
      const addrP = path.join(wDir, `${walletId}.addr`);
      const removedFiles: string[] = [];

      if (fileType === "key" || fileType === "all") {
        if (fs.existsSync(keyP)) { fs.unlinkSync(keyP); removedFiles.push(`${walletId}.key`); }
      }
      if (fileType === "pub" || fileType === "all") {
        if (fs.existsSync(pubP)) { fs.unlinkSync(pubP); removedFiles.push(`${walletId}.pub`); }
      }
      if (fileType === "addr" || fileType === "all") {
        if (fs.existsSync(addrP)) { fs.unlinkSync(addrP); removedFiles.push(`${walletId}.addr`); }
        const walletMeta = store.wallets.find((w) => w.id === walletId);
        if (walletMeta) {
          walletMeta.balance = 0;
          saveStore(store);
        }
      }

      return sendJson(res, 200, {
        success: true,
        walletId,
        removedFiles,
      });
    }

    // =========================================================================
    // 9. POST /api/m1/tx/send (Step 4: Sign & Send Transaction)
    // =========================================================================
    if (req.method === "POST" && pathname === "/api/m1/tx/send") {
      const body = await readJsonBody(req);
      const store = loadStore();
      const fromId = (body.fromId || store.activeId || "").trim();
      const toId = (body.toId || "").trim();
      const amount = Number(body.amount);
      const memo = String(body.memo || "Transfer Coins").trim();
      const attachSignature = body.sign !== false;

      const senderMeta = store.wallets.find((w) => w.id === fromId);
      const recipientMeta = store.wallets.find((w) => w.id === toId);

      if (!senderMeta) {
        return sendJson(res, 400, { error: "Sender wallet not found." });
      }
      if (!recipientMeta) {
        return sendJson(res, 400, { error: "Recipient wallet not found." });
      }
      if (fromId === toId) {
        return sendJson(res, 400, { error: "Cannot send a transaction to the same wallet!" });
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        return sendJson(res, 400, { error: "Amount must be greater than 0." });
      }

      const senderDir = getWalletDir(fromId);
      const recipientDir = getWalletDir(toId);
      const senderKeyP = path.join(senderDir, `${fromId}.key`);
      const senderPubP = path.join(senderDir, `${fromId}.pub`);
      const senderAddrP = path.join(senderDir, `${fromId}.addr`);
      const recipientAddrP = path.join(recipientDir, `${toId}.addr`);

      if (!fs.existsSync(senderPubP)) {
        return sendJson(res, 400, {
          error: `Sender '${senderMeta.name}' is missing Public Key (${fromId}.pub)! Derive Public Key (.pub) first.`,
        });
      }
      if (!fs.existsSync(senderAddrP)) {
        return sendJson(res, 400, {
          error: `Sender '${senderMeta.name}' is missing Blockchain Address (${fromId}.addr)! Derive Address (.addr) first.`,
        });
      }
      if (!fs.existsSync(recipientAddrP)) {
        return sendJson(res, 400, {
          error: `Recipient '${recipientMeta.name}' is missing Blockchain Address (${toId}.addr)!`,
        });
      }
      if (attachSignature && !fs.existsSync(senderKeyP)) {
        return sendJson(res, 400, {
          error: `Sender '${senderMeta.name}' is missing Private Key (${fromId}.key) required to sign transaction!`,
        });
      }
      if (senderMeta.balance < amount) {
        return sendJson(res, 400, {
          error: `Insufficient balance! ${senderMeta.name} has ${senderMeta.balance} Coins, tried to send ${amount} Coins.`,
        });
      }

      const fromAddress = fs.readFileSync(senderAddrP, "utf-8").trim();
      const toAddress = fs.readFileSync(recipientAddrP, "utf-8").trim();
      const senderPubPem = fs.readFileSync(senderPubP, "utf-8").trim();
      const pubInfo = inspectPublicKeyPem(senderPubPem);

      const txId = `tx_${Date.now()}`;
      const nonce = senderMeta.nonce;
      const timestamp = Date.now();

      const txData: TransactionData = {
        from: fromAddress,
        to: toAddress,
        amount,
        nonce,
        timestamp,
      };

      const canonicalJson = serializeTransaction(txData);
      const txHashBuf = hashTransaction(txData);
      const txHashHex = txHashBuf.toString("hex");

      const txFile = `transactions/${txId}.json`;
      fs.writeFileSync(path.join(M1_DIR, txFile), canonicalJson, "utf-8");

      const logs: OpenSSLLog[] = [];
      let signatureHex = "";
      let sigFile: string | undefined = undefined;

      if (attachSignature) {
        sigFile = `transactions/${txId}.sig`;
        logs.push(
          runM1OpenSSL([
            "dgst",
            "-sha256",
            "-sign",
            `wallets/${fromId}/${fromId}.key`,
            "-out",
            sigFile,
            txFile,
          ])
        );
        const sigBuf = fs.readFileSync(path.join(M1_DIR, sigFile));
        signatureHex = sigBuf.toString("hex");
      }

      const record: TxRecord = {
        id: txId,
        fromId,
        fromName: senderMeta.name,
        fromAddress,
        toId,
        toName: recipientMeta.name,
        toAddress,
        amount,
        nonce,
        memo,
        timestamp,
        signed: attachSignature,
        canonicalJson,
        txHashHex,
        signatureHex,
        senderPublicKeyHex: pubInfo.publicKeyFullHex,
        senderPubKeyPem: senderPubPem,
        txFile,
        sigFile,
        tampered: false,
        settled: false,
        verifiedState: "unverified",
      };

      const allTxs = loadTxs();
      allTxs.unshift(record);
      saveTxs(allTxs);

      return sendJson(res, 200, {
        success: true,
        tx: record,
        opensslLogs: logs,
      });
    }

    // =========================================================================
    // 10. POST /api/m1/tx/verify (Zero-Trust Verification & Settlement)
    // =========================================================================
    if (req.method === "POST" && pathname === "/api/m1/tx/verify") {
      const body = await readJsonBody(req);
      const txId = (body.txId || "").trim();
      const shouldSettle = body.settle !== false;
      const store = loadStore();
      const allTxs = loadTxs();
      const tx = allTxs.find((t) => t.id === txId);

      if (!tx) {
        return sendJson(res, 404, { error: "Transaction not found" });
      }

      const senderMeta = store.wallets.find((w) => w.id === tx.fromId);
      const recipientMeta = store.wallets.find((w) => w.id === tx.toId);

      const senderDir = path.join(WALLETS_DIR, tx.fromId.toLowerCase().replace(/[^a-z0-9_-]/g, ""));
      const recipientDir = path.join(WALLETS_DIR, tx.toId.toLowerCase().replace(/[^a-z0-9_-]/g, ""));
      const senderPubP = path.join(senderDir, `${tx.fromId}.pub`);
      const senderAddrP = path.join(senderDir, `${tx.fromId}.addr`);
      const recipientAddrP = path.join(recipientDir, `${tx.toId}.addr`);

      const senderPubExists = Boolean(senderMeta && fs.existsSync(senderPubP));
      const senderAddrExists = Boolean(senderMeta && fs.existsSync(senderAddrP));
      const recipientAddrExists = Boolean(recipientMeta && fs.existsSync(recipientAddrP));
      const sigFileExists = Boolean(!tx.signed || (tx.sigFile && fs.existsSync(path.join(M1_DIR, tx.sigFile))));

      // Recompute canonical JSON & SHA-256 digest from current tx fields
      const currentTxData: TransactionData = {
        from: tx.fromAddress,
        to: tx.toAddress,
        amount: tx.amount,
        nonce: tx.nonce,
        timestamp: tx.timestamp,
      };
      const recomputedCanonicalJson = serializeTransaction(currentTxData);
      const recomputedHashBuf = hashTransaction(currentTxData);
      const recomputedHashHex = recomputedHashBuf.toString("hex");

      // Proof 1: Derive address from sender's public key on disk (SHA3-256(X || Y)[12..32])
      let derivedAddress = "";
      let addressMatch = false;
      const activePubPem = senderPubExists ? fs.readFileSync(senderPubP, "utf-8").trim() : "";
      if (senderPubExists && activePubPem) {
        try {
          const pubInfo = inspectPublicKeyPem(activePubPem);
          derivedAddress = pubInfo.derivedAddress;
          const diskAddr = senderAddrExists ? fs.readFileSync(senderAddrP, "utf-8").trim() : tx.fromAddress;
          addressMatch =
            derivedAddress.toLowerCase() === tx.fromAddress.toLowerCase() &&
            diskAddr.toLowerCase() === tx.fromAddress.toLowerCase();
        } catch {
          addressMatch = false;
        }
      }

      // Proof 2: Verify ECDSA signature using OpenSSL & Node crypto against disk .pub
      let signatureMatch = false;
      const logs: OpenSSLLog[] = [];

      // Update the payload file on disk so OpenSSL verifies the current (possibly tampered) payload
      fs.writeFileSync(path.join(M1_DIR, tx.txFile), recomputedCanonicalJson, "utf-8");

      if (tx.signed && tx.signatureHex && tx.sigFile) {
        logs.push(
          runM1OpenSSL([
            "dgst",
            "-sha256",
            "-verify",
            `wallets/${tx.fromId}/${tx.fromId}.pub`,
            "-signature",
            tx.sigFile,
            tx.txFile,
          ])
        );
        if (senderPubExists && activePubPem && sigFileExists) {
          try {
            const pubKeyObj = crypto.createPublicKey(activePubPem);
            const sigBuf = fs.readFileSync(path.join(M1_DIR, tx.sigFile));
            signatureMatch = crypto.verify("SHA256", Buffer.from(recomputedCanonicalJson, "utf-8"), pubKeyObj, sigBuf);
          } catch {
            signatureMatch = false;
          }
        }
      }

      // Proof 3: Nonce & Balance checks (if not yet settled)
      const nonceMatch = tx.settled
        ? true
        : Boolean(senderMeta && tx.nonce === senderMeta.nonce);
      const balanceMatch = tx.settled
        ? true
        : Boolean(senderMeta && senderMeta.balance >= tx.amount);

      const filesReady =
        Boolean(senderMeta) &&
        senderPubExists &&
        senderAddrExists &&
        sigFileExists &&
        (tx.settled || (Boolean(recipientMeta) && recipientAddrExists));
      const isValid = tx.signed && filesReady && addressMatch && signatureMatch && nonceMatch && balanceMatch;
      let reason = "";
      if (!senderMeta) {
        reason = `REJECTED (Deleted Sender Wallet): Sender wallet '${tx.fromName}' (${tx.fromId}) was deleted from the network!`;
      } else if (!tx.settled && !recipientMeta) {
        reason = `REJECTED (Deleted Recipient Wallet): Recipient wallet '${tx.toName}' (${tx.toId}) was deleted from the network!`;
      } else if (!senderPubExists) {
        reason = `REJECTED (Missing Public Key): Sender's Public Key file (wallets/${tx.fromId}/${tx.fromId}.pub) was removed! Cannot verify ECDSA signature or derive address.`;
      } else if (!senderAddrExists) {
        reason = `REJECTED (Missing Sender Address): Sender's Blockchain Address file (wallets/${tx.fromId}/${tx.fromId}.addr) was removed!`;
      } else if (!tx.settled && !recipientAddrExists) {
        reason = `REJECTED (Missing Recipient Address): Recipient's Blockchain Address file (wallets/${tx.toId}/${tx.toId}.addr) was removed! Cannot settle coins to an uninitialized address.`;
      } else if (!tx.signed) {
        reason = "REJECTED: Transaction was sent without an ECDSA digital signature!";
      } else if (!sigFileExists) {
        reason = `REJECTED (Missing Signature File): ECDSA signature file (${tx.sigFile}) was removed from disk!`;
      } else if (!addressMatch) {
        reason = `REJECTED (Identity / Address Mismatch): SHA3-256(${tx.fromId}.pub) = ${derivedAddress}, which does NOT match sender address ${tx.fromAddress}!`;
      } else if (!signatureMatch) {
        reason = tx.tampered
          ? "REJECTED (Payload Tampered / Invalid Signature): The transaction data was modified in transit! SHA-256 digest no longer matches the ECDSA signature. Zero coins moved."
          : `REJECTED (Key Mismatch / Invalid Signature): ECDSA signature failed verification against wallets/${tx.fromId}/${tx.fromId}.pub! The transaction was signed with a Private Key (.key) that does not match the Public Key (.pub).`;
      } else if (!nonceMatch) {
        reason = `REJECTED (Nonce Replay / Double-Spend Protection): Transaction carries Nonce #${tx.nonce}, but ${tx.fromName}'s current wallet nonce is #${senderMeta?.nonce ?? 0} (Nonce #${tx.nonce} was already settled!).`;
      } else if (!balanceMatch) {
        reason = `REJECTED (Insufficient Funds): Sender only has ${senderMeta?.balance ?? 0} Coins, cannot settle ${tx.amount} Coins.`;
      } else {
        if (!tx.settled && shouldSettle && senderMeta && recipientMeta) {
          senderMeta.balance -= tx.amount;
          senderMeta.nonce += 1;
          recipientMeta.balance += tx.amount;
          tx.settled = true;
          saveStore(store);
          reason = `CONFIRMED & SETTLED (Zero-Trust): Public Key hashes to Sender Address AND ECDSA Signature is valid. Transferred ${tx.amount} Coins from ${tx.fromName} to ${tx.toName}!`;
        } else if (tx.settled) {
          reason = `VALIDATED (Zero-Trust): Cryptographic signature and sender address are 100% authentic (Already settled on ledger).`;
        } else {
          reason = `VALIDATED LOCALLY (Zero-Trust): Public Key hashes to Sender Address AND ECDSA Signature is valid (Awaiting Validator Node settlement).`;
        }
      }

      tx.verifiedState = isValid ? "valid" : "invalid";
      tx.verifyReason = reason;
      tx.addressMatch = addressMatch;
      tx.signatureMatch = signatureMatch;
      tx.balanceMatch = balanceMatch;
      tx.derivedAddress = derivedAddress;
      tx.canonicalJson = recomputedCanonicalJson;
      tx.txHashHex = recomputedHashHex;
      saveTxs(allTxs);

      return sendJson(res, 200, {
        success: true,
        isValid,
        settled: Boolean(tx.settled),
        reason,
        addressMatch,
        signatureMatch,
        balanceMatch,
        nonceMatch,
        derivedAddress,
        recomputedHashHex,
        tx,
        opensslLogs: logs,
      });
    }

    // =========================================================================
    // 11. POST /api/m1/tx/tamper (Simulate MitM Payload Tampering Attack)
    // =========================================================================
    if (req.method === "POST" && pathname === "/api/m1/tx/tamper") {
      const body = await readJsonBody(req);
      const txId = (body.txId || "").trim();
      const allTxs = loadTxs();
      const tx = allTxs.find((t) => t.id === txId);

      if (!tx) {
        return sendJson(res, 404, { error: "Transaction not found" });
      }
      if (tx.settled) {
        return sendJson(res, 400, {
          error: "Cannot tamper in transit: Transaction has already been confirmed and settled on the ledger!",
        });
      }

      if (!tx.tampered) {
        tx.originalAmount = tx.amount;
        tx.amount = tx.amount + 1000;
        tx.tampered = true;
      } else {
        // Restore original amount if clicked again (toggle)
        if (tx.originalAmount !== undefined) {
          tx.amount = tx.originalAmount;
        }
        tx.tampered = false;
      }

      const updatedData: TransactionData = {
        from: tx.fromAddress,
        to: tx.toAddress,
        amount: tx.amount,
        nonce: tx.nonce,
        timestamp: tx.timestamp,
      };
      tx.canonicalJson = serializeTransaction(updatedData);
      tx.txHashHex = hashTransaction(updatedData).toString("hex");
      tx.verifiedState = "unverified";
      tx.verifyReason = undefined;

      fs.writeFileSync(path.join(M1_DIR, tx.txFile), tx.canonicalJson, "utf-8");
      saveTxs(allTxs);

      return sendJson(res, 200, {
        success: true,
        tampered: tx.tampered,
        tx,
      });
    }

    // =========================================================================
    // 11b. DELETE /api/m1/tx/:id (Delete a single transaction record)
    // =========================================================================
    if (req.method === "DELETE" && pathname.startsWith("/api/m1/tx/")) {
      const txIdToDelete = pathname.replace("/api/m1/tx/", "").trim();
      const allTxs = loadTxs();
      const idx = allTxs.findIndex((t) => t.id === txIdToDelete);
      if (idx === -1) {
        return sendJson(res, 404, { error: "Transaction not found" });
      }
      const [removed] = allTxs.splice(idx, 1);
      saveTxs(allTxs);

      if (removed.txFile) {
        const p = path.join(M1_DIR, removed.txFile);
        if (fs.existsSync(p)) {
          try { fs.unlinkSync(p); } catch {}
        }
      }
      if (removed.sigFile) {
        const s = path.join(M1_DIR, removed.sigFile);
        if (fs.existsSync(s)) {
          try { fs.unlinkSync(s); } catch {}
        }
      }

      return sendJson(res, 200, { success: true, deletedId: txIdToDelete });
    }

    // =========================================================================
    // 12. POST /api/m1/reset (Reset all wallets & transactions to zero)
    // =========================================================================
    if (req.method === "POST" && pathname === "/api/m1/reset") {
      [WALLETS_DIR, TXS_DIR].forEach((dir) => {
        if (fs.existsSync(dir)) {
          try {
            fs.rmSync(dir, { recursive: true, force: true });
          } catch {}
        }
        try {
          fs.mkdirSync(dir, { recursive: true });
        } catch {}
      });
      const initial: M1Store = { activeRole: "node", activeId: "", wallets: [] };
      saveStore(initial);
      saveTxs([]);
      return sendJson(res, 200, { success: true, message: "All wallets and transactions reset to zero." });
    }

    // -------------------------------------------------------------------------
    // STATIC FILE SERVER
    // -------------------------------------------------------------------------
    let filePath =
      pathname === "/" ? path.join(PUBLIC_DIR, "index.html") : path.join(PUBLIC_DIR, pathname);
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
        "Pragma": "no-cache",
        "Expires": "0",
      });
      return fs.createReadStream(filePath).pipe(res);
    }

    res.writeHead(404);
    res.end("Not Found");
  } catch (err: any) {
    console.error("Server error:", err);
    sendJson(res, 500, { error: err.message || "Internal Server Error" });
  }
});

if (process.env.TEST_MODE !== "true") {
  server.listen(PORT, () => {
    console.log(`\n===============================================================`);
    console.log(` ⛓️  Module 1: Cryptography & Wallets running at http://localhost:${PORT}`);
    console.log(`===============================================================\n`);
  });
}

export { server };
