import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createWallet, verifyAddressFromPublicKey } from "../module1-cryptography/wallet.ts";
import type { Wallet } from "../module1-cryptography/wallet.ts";
import {
  signTransaction,
  verifyTransaction,
  hashTransaction,
  serializeTransaction,
} from "../module1-cryptography/transaction.ts";
import type { SignedTransaction } from "../module1-cryptography/transaction.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const MODULE0_DIR = path.join(ROOT_DIR, "module0-openssl-keys");
const GENERATED_DIR = path.join(MODULE0_DIR, "generated");
const ACCOUNTS_FILE = path.join(GENERATED_DIR, "accounts.json");
const CA_DIR = path.join(ROOT_DIR, "module0-ca", "generated");
const CA_ROOT_DIR = path.join(CA_DIR, "ca");
const CA_CLIENTS_DIR = path.join(CA_DIR, "clients");
const CA_MESSAGES_DIR = path.join(CA_DIR, "messages");
const CA_CLIENTS_FILE = path.join(CA_DIR, "clients.json");
const CA_MESSAGES_FILE = path.join(CA_DIR, "messages.json");
const PUBLIC_DIR = path.join(__dirname, "public");

// Ensure generated directories exist
[GENERATED_DIR, CA_DIR, CA_ROOT_DIR, CA_CLIENTS_DIR, CA_MESSAGES_DIR].forEach((d) => {
  if (!fs.existsSync(d)) {
    fs.mkdirSync(d, { recursive: true });
  }
});

function getClientDir(id: string): string {
  const dir = path.join(CA_CLIENTS_DIR, id);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// OpenSSL runner specifically in CA_DIR
function runCAOpenSSL(args: string[]): { command: string; output: string } {
  const cmdString = `openssl ${args.join(" ")}`;
  try {
    const out = execFileSync("openssl", args, {
      cwd: CA_DIR,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { command: cmdString, output: (out || "(Executed successfully with no stdout)").trim() };
  } catch (err: any) {
    const stdout = err.stdout ? String(err.stdout) : "";
    const stderr = err.stderr ? String(err.stderr) : "";
    throw new Error(`${cmdString} failed:\n${stdout}\n${stderr}`);
  }
}

interface CAClient {
  id: string;
  name: string;
  createdAt: number;
}

interface CAStore {
  activeRole: string; // "admin" or client id
  activeId: string;
  clients: CAClient[];
}

interface CAMessage {
  id: string;
  senderId: string;
  senderName: string;
  recipientId: string;
  recipientName: string;
  title: string;
  encFilename: string;
  isSigned: boolean;
  signerCertId?: string;
  ciphertextSize: number;
  ciphertextBase64Preview: string;
  createdAt: number;
}

function loadCAMessages(): CAMessage[] {
  if (fs.existsSync(CA_MESSAGES_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(CA_MESSAGES_FILE, "utf-8"));
      if (Array.isArray(data)) return data;
    } catch {}
  }
  return [];
}

function saveCAMessages(messages: CAMessage[]) {
  fs.writeFileSync(CA_MESSAGES_FILE, JSON.stringify(messages, null, 2), "utf-8");
}

function loadCAStore(): CAStore {
  if (fs.existsSync(CA_CLIENTS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(CA_CLIENTS_FILE, "utf-8"));
      if (Array.isArray(data.clients)) {
        if (!data.activeRole) data.activeRole = "admin";
        if (!data.activeId) data.activeId = data.clients[0]?.id || "";
        return data;
      }
    } catch {}
  }
  return { activeRole: "admin", activeId: "", clients: [] };
}

function saveCAStore(store: CAStore) {
  fs.writeFileSync(CA_CLIENTS_FILE, JSON.stringify(store, null, 2), "utf-8");
}

// -----------------------------------------------------------------------------
// CLEANUP LOGIC: Clean temporary / stale files on start or on demand
// -----------------------------------------------------------------------------
function cleanWorkingFiles(clearAllKeys = false): string[] {
  if (!fs.existsSync(GENERATED_DIR)) return [];
  const cleaned: string[] = [];
  const files = fs.readdirSync(GENERATED_DIR);

  for (const file of files) {
    if (!clearAllKeys && (file.endsWith(".pem") || file === "accounts.json")) {
      continue;
    }
    try {
      fs.unlinkSync(path.join(GENERATED_DIR, file));
      cleaned.push(file);
    } catch {
      // ignore
    }
  }
  return cleaned;
}

// Automatically clean stale temporary files (.txt, .bin) on startup
const initialCleaned = cleanWorkingFiles(false);
if (initialCleaned.length > 0) {
  console.log(`[Clean] Cleaned ${initialCleaned.length} stale temporary file(s) on startup.`);
}

// -----------------------------------------------------------------------------
// ACCOUNT METADATA & PERSISTENCE (CRUD)
// -----------------------------------------------------------------------------
export interface AccountMeta {
  id: string;        // e.g. "alice", "account_123"
  name: string;      // e.g. "Alice (Main)", "Cold Storage"
  privFile: string;  // e.g. "alice_private.pem"
  pubFile: string;   // e.g. "alice_public.pem"
  address: string;   // "0x..."
  createdAt: number;
}

interface AccountsStore {
  activeId: string;
  accounts: AccountMeta[];
}

function loadAccountsStore(): AccountsStore {
  if (fs.existsSync(ACCOUNTS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf-8"));
      if (Array.isArray(data.accounts) && data.accounts.length > 0) {
        return data;
      }
    } catch {
      // fall through to init
    }
  }
  return { activeId: "", accounts: [] };
}

function saveAccountsStore(store: AccountsStore) {
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(store, null, 2), "utf-8");
}

interface OpenSSLLog {
  command: string;
  output: string;
}

function runOpenSSL(args: string[]): { command: string; output: string } {
  const cmdString = `openssl ${args.join(" ")}`;
  try {
    const out = execFileSync("openssl", args, {
      cwd: GENERATED_DIR,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { command: cmdString, output: (out || "(Executed successfully with no stdout)").trim() };
  } catch (err: any) {
    const stdout = err.stdout ? String(err.stdout) : "";
    const stderr = err.stderr ? String(err.stderr) : "";
    throw new Error(`${cmdString} failed:\n${stdout}\n${stderr}`);
  }
}

function deriveAccountDataFromPem(privFile: string, pubFile: string, logs: OpenSSLLog[] = []) {
  const privPemPath = path.join(GENERATED_DIR, privFile);
  const pubPemPath = path.join(GENERATED_DIR, pubFile);

  const privatePem = fs.readFileSync(privPemPath, "utf-8").trim();
  const publicPem = fs.readFileSync(pubPemPath, "utf-8").trim();

  const privKeyObj = crypto.createPrivateKey(privatePem);
  const jwk = privKeyObj.export({ format: "jwk" }) as {
    d: string;
    x: string;
    y: string;
  };

  const privBytes = Buffer.from(jwk.d, "base64url");
  const xBytes = Buffer.from(jwk.x, "base64url");
  const yBytes = Buffer.from(jwk.y, "base64url");

  const privateKeyHex = privBytes.toString("hex").padStart(64, "0");
  const privateKeyDecimal = BigInt("0x" + privateKeyHex).toString(10);
  const privateKeyBinary = Array.from(privBytes)
    .map((b) => b.toString(2).padStart(8, "0"))
    .join(" ");

  const prefixByte = "04";
  const xCoordHex = xBytes.toString("hex").padStart(64, "0");
  const yCoordHex = yBytes.toString("hex").padStart(64, "0");
  const publicKeyFullHex = prefixByte + xCoordHex + yCoordHex;

  // Derive Blockchain Account Address: SHA3-256(X || Y) -> last 20 bytes
  const coordinates = Buffer.concat([xBytes, yBytes]);
  const hash = crypto.createHash("sha3-256").update(coordinates).digest();
  const sha3HashHex = hash.toString("hex");
  const discardedBytesHex = sha3HashHex.slice(0, 24); // First 12 bytes
  const addressBytesHex = sha3HashHex.slice(24);      // Last 20 bytes
  const accountAddress = "0x" + addressBytesHex;

  return {
    privatePem,
    publicPem,
    privateKeyHex,
    privateKeyDecimal,
    privateKeyBinary,
    prefixByte,
    xCoordHex,
    yCoordHex,
    publicKeyFullHex,
    sha3HashHex,
    discardedBytesHex,
    addressBytesHex,
    accountAddress,
    opensslLogs: logs,
  };
}

// Generate a new OpenSSL keypair on disk for an account ID
function generateOpenSSLKeypair(id: string): { logs: OpenSSLLog[]; privFile: string; pubFile: string } {
  const privFile = `${id}_private.pem`;
  const pubFile = `${id}_public.pem`;
  const logs: OpenSSLLog[] = [];

  logs.push(runOpenSSL(["ecparam", "-name", "secp256k1", "-genkey", "-noout", "-out", privFile]));
  logs.push(runOpenSSL(["ec", "-in", privFile, "-text", "-noout"]));
  logs.push(runOpenSSL(["ec", "-in", privFile, "-pubout", "-out", pubFile]));
  logs.push(runOpenSSL(["ec", "-in", pubFile, "-pubin", "-text", "-noout"]));

  return { logs, privFile, pubFile };
}

// Initialize default store if empty
function ensureStoreInitialized(): AccountsStore {
  let store = loadAccountsStore();
  if (store.accounts.length === 0) {
    const defaultId = "alice";
    const { logs, privFile, pubFile } = generateOpenSSLKeypair(defaultId);
    const keyData = deriveAccountDataFromPem(privFile, pubFile, logs);
    const defaultAccount: AccountMeta = {
      id: defaultId,
      name: "Alice (Default)",
      privFile,
      pubFile,
      address: keyData.accountAddress,
      createdAt: Date.now(),
    };
    store = {
      activeId: defaultId,
      accounts: [defaultAccount],
    };
    saveAccountsStore(store);
  }
  return store;
}

// In-memory store for Module 1 Wallets
const wallets = new Map<string, Wallet>();
function initModule1Wallets() {
  wallets.clear();
  const alice = createWallet("Alice");
  const bob = createWallet("Bob");
  const mallory = createWallet("Mallory");
  wallets.set("Alice", alice);
  wallets.set("Bob", bob);
  wallets.set("Mallory", mallory);
}
initModule1Wallets();

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

function sendJson(res: http.ServerResponse, status: number, data: any) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    // =========================================================================
    // =========================================================================
    // PURE CERTIFICATE AUTHORITY (CA) & PKI ENDPOINTS (ROLE-BASED FOLDER STRUCTURE)
    // =========================================================================
    if (req.method === "GET" && pathname === "/api/ca/state") {
      const rootKeyPath = path.join(CA_ROOT_DIR, "root_ca.key");
      const rootCrtPath = path.join(CA_ROOT_DIR, "root_ca.crt");
      const rootCaExists = fs.existsSync(rootKeyPath) && fs.existsSync(rootCrtPath);

      let rootCaDetails: any = null;
      if (rootCaExists) {
        const textOut = runCAOpenSSL(["x509", "-in", "ca/root_ca.crt", "-text", "-noout"]).output;
        const certPem = fs.readFileSync(rootCrtPath, "utf-8").trim();
        const keyPem = fs.existsSync(rootKeyPath) ? fs.readFileSync(rootKeyPath, "utf-8").trim() : "";
        let pubKeyPem = "";
        if (fs.existsSync(rootKeyPath)) {
          try {
            pubKeyPem = execFileSync("openssl", ["pkey", "-in", rootKeyPath, "-pubout"], {
              cwd: CA_DIR,
              encoding: "utf-8",
              stdio: ["ignore", "pipe", "ignore"],
            }).trim();
          } catch {
            pubKeyPem = "";
          }
        }
        const issuerMatch = textOut.match(/Issuer:\s*(.+)/);
        const subjectMatch = textOut.match(/Subject:\s*(.+)/);
        const notBeforeMatch = textOut.match(/Not Before:\s*([^\n]+)/);
        const notAfterMatch = textOut.match(/Not After\s*:\s*([^\n]+)/);

        rootCaDetails = {
          issuer: issuerMatch ? issuerMatch[1].trim() : "CN=MyRootCA, O=GlobalTrustAuthority",
          subject: subjectMatch ? subjectMatch[1].trim() : "CN=MyRootCA, O=GlobalTrustAuthority",
          validNotBefore: notBeforeMatch ? notBeforeMatch[1].trim() : "",
          validNotAfter: notAfterMatch ? notAfterMatch[1].trim() : "",
          keyPem,
          pubKeyPem,
          certPem,
          fullText: textOut,
        };
      }

      const store = loadCAStore();
      const messages = loadCAMessages();
      const clientList = store.clients.map((c) => {
        const keyP = path.join(CA_CLIENTS_DIR, c.id, `${c.id}.key`);
        const csrP = path.join(CA_CLIENTS_DIR, c.id, `${c.id}.csr`);
        const crtP = path.join(CA_CLIENTS_DIR, c.id, `${c.id}.crt`);
        const keyExists = fs.existsSync(keyP);
        const csrExists = fs.existsSync(csrP);
        const crtExists = fs.existsSync(crtP);

        let crtValid = false;
        if (crtExists && rootCaExists) {
          try {
            execFileSync("openssl", ["verify", "-CAfile", path.join(CA_ROOT_DIR, "root_ca.crt"), crtP], {
              cwd: CA_DIR,
              encoding: "utf-8",
              stdio: ["ignore", "pipe", "pipe"],
            });
            crtValid = true;
          } catch {
            crtValid = false;
          }
        }

        let keyMatchesCrt = false;
        if (keyExists && crtExists) {
          try {
            const keyPub = execFileSync("openssl", ["pkey", "-in", keyP, "-pubout"], {
              cwd: CA_DIR,
              encoding: "utf-8",
              stdio: ["ignore", "pipe", "ignore"],
            }).trim();
            const crtPub = execFileSync("openssl", ["x509", "-in", crtP, "-pubkey", "-noout"], {
              cwd: CA_DIR,
              encoding: "utf-8",
              stdio: ["ignore", "pipe", "ignore"],
            }).trim();
            keyMatchesCrt = Boolean(keyPub && crtPub && keyPub === crtPub);
          } catch {
            keyMatchesCrt = false;
          }
        }

        const inboxCount = messages.filter((m) => m.recipientId === c.id).length;
        const sentCount = messages.filter((m) => m.senderId === c.id).length;
        return {
          id: c.id,
          name: c.name,
          keyExists,
          keySize: keyExists ? fs.statSync(keyP).size : 0,
          csrExists,
          csrSize: csrExists ? fs.statSync(csrP).size : 0,
          crtExists,
          crtSize: crtExists ? fs.statSync(crtP).size : 0,
          crtValid,
          keyMatchesCrt,
          inboxCount,
          sentCount,
        };
      });

      const targetRoleId = store.activeRole && store.activeRole !== "admin" ? store.activeRole : store.activeId;
      const activeClient = clientList.find((c) => c.id === targetRoleId) || clientList[0];
      let activeDetails: any = null;
      if (activeClient) {
        const keyP = path.join(CA_CLIENTS_DIR, activeClient.id, `${activeClient.id}.key`);
        const csrP = path.join(CA_CLIENTS_DIR, activeClient.id, `${activeClient.id}.csr`);
        const crtP = path.join(CA_CLIENTS_DIR, activeClient.id, `${activeClient.id}.crt`);

        let pubKeyPem = "";
        if (fs.existsSync(keyP)) {
          try {
            pubKeyPem = execFileSync("openssl", ["pkey", "-in", keyP, "-pubout"], {
              cwd: CA_DIR,
              encoding: "utf-8",
              stdio: ["ignore", "pipe", "ignore"],
            }).trim();
          } catch {
            pubKeyPem = "";
          }
        }

        activeDetails = {
          id: activeClient.id,
          name: activeClient.name,
          crtValid: activeClient.crtValid,
          keyMatchesCrt: activeClient.keyMatchesCrt,
          keyPem: fs.existsSync(keyP) ? fs.readFileSync(keyP, "utf-8").trim() : "",
          pubKeyPem,
          csrPem: fs.existsSync(csrP) ? fs.readFileSync(csrP, "utf-8").trim() : "",
          crtPem: fs.existsSync(crtP) ? fs.readFileSync(crtP, "utf-8").trim() : "",
          csrText: fs.existsSync(csrP)
            ? runCAOpenSSL(["req", "-in", `clients/${activeClient.id}/${activeClient.id}.csr`, "-text", "-noout"]).output
            : "",
          crtText: fs.existsSync(crtP)
            ? runCAOpenSSL(["x509", "-in", `clients/${activeClient.id}/${activeClient.id}.crt`, "-text", "-noout"]).output
            : "",
        };
      }

      return sendJson(res, 200, {
        rootCaExists,
        rootCa: rootCaDetails,
        clients: clientList,
        activeRole: store.activeRole || "admin",
        activeId: activeClient ? activeClient.id : "",
        activeDetails,
      });
    }

    if (req.method === "POST" && pathname === "/api/ca/select-role") {
      const body = await readJsonBody(req);
      const store = loadCAStore();
      const role = String(body.role || "admin").trim();
      store.activeRole = role;
      if (role !== "admin" && store.clients.some((c) => c.id === role)) {
        store.activeId = role;
      }
      saveCAStore(store);
      return sendJson(res, 200, { success: true, activeRole: store.activeRole, activeId: store.activeId });
    }

    if (req.method === "POST" && pathname === "/api/ca/init-root") {
      const srlPath = path.join(CA_ROOT_DIR, "root_ca.srl");
      if (fs.existsSync(srlPath)) {
        try { fs.unlinkSync(srlPath); } catch {}
      }
      const logs: OpenSSLLog[] = [];
      logs.push(runCAOpenSSL(["ecparam", "-name", "secp256k1", "-genkey", "-noout", "-out", "ca/root_ca.key"]));
      logs.push(
        runCAOpenSSL([
          "req",
          "-new",
          "-x509",
          "-key",
          "ca/root_ca.key",
          "-out",
          "ca/root_ca.crt",
          "-days",
          "365",
          "-subj",
          "/CN=MyRootCA/O=GlobalTrustAuthority/C=ID",
        ])
      );
      logs.push(runCAOpenSSL(["x509", "-in", "ca/root_ca.crt", "-text", "-noout"]));
      return sendJson(res, 200, { success: true, opensslLogs: logs });
    }

    if (req.method === "POST" && pathname === "/api/ca/clients") {
      const body = await readJsonBody(req);
      const name = (body.name || "").trim() || `Client_${Date.now().toString().slice(-4)}`;
      const safeId = (body.id || name.toLowerCase().replace(/[^a-z0-9_-]/g, "_")).slice(0, 24);
      getClientDir(safeId);

      const logs: OpenSSLLog[] = [];
      // Only generate key and CSR when explicitly requested (action === "generate-key" or generateKey === true)
      if (body.generateKey === true || body.action === "generate-key") {
        logs.push(runCAOpenSSL(["ecparam", "-name", "secp256k1", "-genkey", "-noout", "-out", `clients/${safeId}/${safeId}.key`]));
        logs.push(
          runCAOpenSSL([
            "req",
            "-new",
            "-key",
            `clients/${safeId}/${safeId}.key`,
            "-out",
            `clients/${safeId}/${safeId}.csr`,
            "-subj",
            `/CN=${name}/O=Users/C=ID`,
          ])
        );
        logs.push(runCAOpenSSL(["req", "-in", `clients/${safeId}/${safeId}.csr`, "-text", "-noout"]));
      }

      const store = loadCAStore();
      if (!store.clients.some((c) => c.id === safeId)) {
        store.clients.push({ id: safeId, name, createdAt: Date.now() });
      }
      store.activeId = safeId;
      saveCAStore(store);

      return sendJson(res, 201, { success: true, id: safeId, name, opensslLogs: logs });
    }

    // -------------------------------------------------------------------------
    // REMOVE INDIVIDUAL CLIENT ARTIFACTS (.key, .csr, .crt)
    // -------------------------------------------------------------------------
    if (req.method === "POST" && pathname === "/api/ca/client-remove-file") {
      const body = await readJsonBody(req);
      const clientId = (body.clientId || "").trim();
      const fileType = (body.fileType || "").trim(); // "key", "csr", "crt", or "all"

      if (!clientId) {
        return sendJson(res, 400, { error: "Missing clientId parameter" });
      }

      const clientDir = path.join(CA_CLIENTS_DIR, clientId);
      if (!fs.existsSync(clientDir)) {
        return sendJson(res, 404, { error: `Client directory '${clientId}' not found` });
      }

      const removedFiles: string[] = [];
      const keyP = path.join(clientDir, `${clientId}.key`);
      const csrP = path.join(clientDir, `${clientId}.csr`);
      const crtP = path.join(clientDir, `${clientId}.crt`);

      if (fileType === "key" || fileType === "key_csr" || fileType === "all") {
        if (fs.existsSync(keyP)) { fs.unlinkSync(keyP); removedFiles.push(`${clientId}.key`); }
      }
      if (fileType === "csr" || fileType === "key_csr" || fileType === "all") {
        if (fs.existsSync(csrP)) { fs.unlinkSync(csrP); removedFiles.push(`${clientId}.csr`); }
      }
      if (fileType === "crt" || fileType === "all") {
        if (fs.existsSync(crtP)) { fs.unlinkSync(crtP); removedFiles.push(`${clientId}.crt`); }
      }

      const logCmd = `rm -f clients/${clientId}/${clientId}.{${fileType}}`;
      return sendJson(res, 200, {
        success: true,
        clientId,
        fileType,
        removedFiles,
        opensslLog: {
          command: logCmd,
          output: `Removed [${removedFiles.join(", ")}] from clients/${clientId}/`,
        },
      });
    }

    if (req.method === "POST" && pathname === "/api/ca/select-client") {
      const body = await readJsonBody(req);
      const store = loadCAStore();
      if (store.clients.some((c) => c.id === body.id)) {
        store.activeId = body.id;
        saveCAStore(store);
      }
      return sendJson(res, 200, { success: true, activeId: store.activeId });
    }

    if (req.method === "POST" && pathname === "/api/ca/sign-cert") {
      const body = await readJsonBody(req);
      const store = loadCAStore();
      const id = body.id || store.activeId;

      if (!fs.existsSync(path.join(CA_ROOT_DIR, "root_ca.crt")) || !fs.existsSync(path.join(CA_ROOT_DIR, "root_ca.key"))) {
        return sendJson(res, 400, {
          error: "Root CA has not been initialized yet. Please initialize the Root CA in Admin view before issuing certificates.",
        });
      }

      const clientCsrPath = path.join(CA_CLIENTS_DIR, id, `${id}.csr`);
      if (!fs.existsSync(clientCsrPath)) {
        return sendJson(res, 400, {
          error: `Client '${id}' has not generated a CSR yet (clients/${id}/${id}.csr missing). Please generate keypair & CSR first.`,
        });
      }

      const logs: OpenSSLLog[] = [];

      logs.push(
        runCAOpenSSL([
          "x509",
          "-req",
          "-in",
          `clients/${id}/${id}.csr`,
          "-CA",
          "ca/root_ca.crt",
          "-CAkey",
          "ca/root_ca.key",
          "-CAcreateserial",
          "-out",
          `clients/${id}/${id}.crt`,
          "-days",
          "365",
          "-sha256",
        ])
      );
      logs.push(runCAOpenSSL(["x509", "-in", `clients/${id}/${id}.crt`, "-text", "-noout"]));

      return sendJson(res, 200, { success: true, id, opensslLogs: logs });
    }

    if (req.method === "POST" && pathname === "/api/ca/verify") {
      const body = await readJsonBody(req);
      const store = loadCAStore();
      const id = body.id || store.activeId;
      const isFake = Boolean(body.isFake);

      let targetCrt = `clients/${id}/${id}.crt`;
      const logs: OpenSSLLog[] = [];

      if (isFake) {
        targetCrt = `clients/${id}/fake_${id}.crt`;
        if (!fs.existsSync(path.join(CA_ROOT_DIR, "fake_ca.key"))) {
          logs.push(runCAOpenSSL(["ecparam", "-name", "secp256k1", "-genkey", "-noout", "-out", "ca/fake_ca.key"]));
          logs.push(
            runCAOpenSSL([
              "req",
              "-new",
              "-x509",
              "-key",
              "ca/fake_ca.key",
              "-out",
              "ca/fake_ca.crt",
              "-days",
              "365",
              "-subj",
              "/CN=UntrustedHackerCA/O=FakeOrg",
            ])
          );
        }
        logs.push(
          runCAOpenSSL([
            "x509",
            "-req",
            "-in",
            `clients/${id}/${id}.csr`,
            "-CA",
            "ca/fake_ca.crt",
            "-CAkey",
            "ca/fake_ca.key",
            "-CAcreateserial",
            "-out",
            targetCrt,
            "-days",
            "365",
            "-sha256",
          ])
        );
      }

      const cmdArgs = ["verify", "-CAfile", "ca/root_ca.crt", targetCrt];
      const cmdString = `openssl ${cmdArgs.join(" ")}`;

      try {
        const out = execFileSync("openssl", cmdArgs, {
          cwd: CA_DIR,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "pipe"],
        });

        // Also check if key matches cert
        let keyMatchesCrt = true;
        const keyP = path.join(CA_CLIENTS_DIR, id, `${id}.key`);
        const crtP = path.join(CA_DIR, targetCrt);
        if (fs.existsSync(keyP) && fs.existsSync(crtP)) {
          try {
            const keyPub = execFileSync("openssl", ["pkey", "-in", keyP, "-pubout"], {
              cwd: CA_DIR,
              encoding: "utf-8",
              stdio: ["ignore", "pipe", "ignore"],
            }).trim();
            const crtPub = execFileSync("openssl", ["x509", "-in", crtP, "-pubkey", "-noout"], {
              cwd: CA_DIR,
              encoding: "utf-8",
              stdio: ["ignore", "pipe", "ignore"],
            }).trim();
            keyMatchesCrt = Boolean(keyPub && crtPub && keyPub === crtPub);
          } catch {
            keyMatchesCrt = false;
          }
        }

        return sendJson(res, 200, {
          isValid: true,
          keyMatchesCrt,
          isFake,
          opensslLog: { command: cmdString, output: out.trim() || `${targetCrt}: OK` },
        });
      } catch (err: any) {
        const stdout = err.stdout ? String(err.stdout).trim() : "";
        const stderr = err.stderr ? String(err.stderr).trim() : "";
        return sendJson(res, 200, {
          isValid: false,
          isFake,
          opensslLog: {
            command: cmdString,
            output:
              [stdout, stderr].filter(Boolean).join("\n") ||
              "error 20 at 0 depth lookup: unable to get local issuer certificate",
          },
        });
      }
    }

    // -------------------------------------------------------------------------
    // INBOX: LIST MESSAGES FOR CLIENT
    // -------------------------------------------------------------------------
    if (req.method === "GET" && pathname === "/api/ca/inbox") {
      const parsed = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
      const clientId = (parsed.searchParams.get("clientId") || "").trim();
      const allMessages = loadCAMessages();
      const messages = clientId ? allMessages.filter((m) => m.recipientId === clientId) : allMessages;
      return sendJson(res, 200, { messages });
    }

    // -------------------------------------------------------------------------
    // SENT: LIST MESSAGES SENT BY CLIENT
    // -------------------------------------------------------------------------
    if (req.method === "GET" && pathname === "/api/ca/sent") {
      const parsed = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
      const clientId = (parsed.searchParams.get("clientId") || "").trim();
      const allMessages = loadCAMessages();
      const messages = clientId ? allMessages.filter((m) => m.senderId === clientId) : allMessages;
      return sendJson(res, 200, { messages });
    }

    // -------------------------------------------------------------------------
    // SEND ENCRYPTED DOCUMENT TO RECIPIENT INBOX (WITH OPTIONAL DIGITAL SIGNATURE)
    // -------------------------------------------------------------------------
    if (req.method === "POST" && pathname === "/api/ca/send-message") {
      const body = await readJsonBody(req);
      const senderId = (body.senderId || "").trim();
      const recipientId = (body.recipientId || "").trim();
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const isSigned = body.isSigned !== false; // default true
      const message =
        typeof body.message === "string" && body.message.trim()
          ? body.message.trim()
          : "Confidential Document Content";

      if (!senderId || !recipientId) {
        return sendJson(res, 400, { error: "Sender and recipient are required." });
      }

      if (senderId === recipientId) {
        return sendJson(res, 400, { error: "You cannot send a confidential document to yourself." });
      }

      const recipientCrtPath = path.join(CA_CLIENTS_DIR, recipientId, `${recipientId}.crt`);
      if (!fs.existsSync(recipientCrtPath)) {
        return sendJson(res, 400, {
          error: `Recipient '${recipientId}' does not have an issued certificate (clients/${recipientId}/${recipientId}.crt). The Root CA must sign their certificate before you can send encrypted documents to them!`,
        });
      }

      // If digital signature is requested, sender MUST have an issued certificate!
      if (isSigned) {
        const senderKeyPath = path.join(CA_CLIENTS_DIR, senderId, `${senderId}.key`);
        const senderCrtPath = path.join(CA_CLIENTS_DIR, senderId, `${senderId}.crt`);
        if (!fs.existsSync(senderKeyPath) || !fs.existsSync(senderCrtPath)) {
          return sendJson(res, 400, {
            error: `Digital Signature requires sender '${senderId}' to have an issued certificate (clients/${senderId}/${senderId}.crt). Please switch to Admin to issue your certificate first, or uncheck 'Attach Digital Signature'.`,
          });
        }
      }

      const store = loadCAStore();
      const sender = store.clients.find((c) => c.id === senderId);
      const recipient = store.clients.find((c) => c.id === recipientId);

      const msgId = `msg_${Date.now()}`;
      const encFilename = `${msgId}.enc`;
      const rawRel = `messages/tmp_raw_${msgId}.txt`;
      const signedRel = `messages/tmp_signed_${msgId}.smime`;
      const encRel = `messages/${encFilename}`;
      const rawPath = path.join(CA_DIR, rawRel);
      const signedPath = path.join(CA_DIR, signedRel);
      const encPath = path.join(CA_DIR, encRel);

      fs.writeFileSync(rawPath, message, "utf-8");

      const logSteps: string[] = [];

      try {
        let inputForEncrypt = rawRel;

        if (isSigned) {
          // STEP 1: Sign with sender's private key and certificate
          const signArgs = [
            "cms",
            "-sign",
            "-in",
            rawRel,
            "-signer",
            `clients/${senderId}/${senderId}.crt`,
            "-inkey",
            `clients/${senderId}/${senderId}.key`,
            "-out",
            signedRel,
            "-nodetach",
          ];
          execFileSync("openssl", signArgs, { cwd: CA_DIR, stdio: ["ignore", "pipe", "pipe"] });
          logSteps.push(`[1. Sign] openssl ${signArgs.join(" ")}`);
          inputForEncrypt = signedRel;
        }

        // STEP 2: Encrypt with recipient's certificate
        const encArgs = ["cms", "-encrypt", "-in", inputForEncrypt, "-out", encRel, `clients/${recipientId}/${recipientId}.crt`];
        execFileSync("openssl", encArgs, { cwd: CA_DIR, stdio: ["ignore", "pipe", "pipe"] });
        logSteps.push(`[2. Encrypt] openssl ${encArgs.join(" ")}`);

        // Cleanup temporary intermediate files
        try { fs.unlinkSync(rawPath); } catch {}
        try { if (fs.existsSync(signedPath)) fs.unlinkSync(signedPath); } catch {}

        const encBuffer = fs.readFileSync(encPath);
        const ciphertextBase64Preview = encBuffer.toString("base64").slice(0, 160) + "...";

        const newMsg: CAMessage = {
          id: msgId,
          senderId,
          senderName: sender ? sender.name : senderId,
          recipientId,
          recipientName: recipient ? recipient.name : recipientId,
          title,
          encFilename,
          isSigned,
          signerCertId: isSigned ? senderId : undefined,
          ciphertextSize: encBuffer.length,
          ciphertextBase64Preview,
          createdAt: Date.now(),
        };

        const messages = loadCAMessages();
        messages.unshift(newMsg);
        saveCAMessages(messages);

        return sendJson(res, 201, {
          success: true,
          message: newMsg,
          opensslLog: {
            command: logSteps.join("\n"),
            output: isSigned
              ? `[✓] Digitally signed with clients/${senderId}/${senderId}.crt and encrypted for clients/${recipientId}/${recipientId}.crt (${encBuffer.length} bytes delivered to messages/${encFilename} for ${newMsg.recipientName})`
              : `[✓] Encrypted unsigned document for clients/${recipientId}/${recipientId}.crt (${encBuffer.length} bytes delivered to messages/${encFilename} for ${newMsg.recipientName})`,
          },
        });
      } catch (err: any) {
        try { if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath); } catch {}
        try { if (fs.existsSync(signedPath)) fs.unlinkSync(signedPath); } catch {}
        const stdout = err.stdout ? String(err.stdout).trim() : "";
        const stderr = err.stderr ? String(err.stderr).trim() : "";
        return sendJson(res, 500, {
          error: "OpenSSL CMS operation failed",
          details: [stdout, stderr].filter(Boolean).join("\n"),
        });
      }
    }

    // -------------------------------------------------------------------------
    // DECRYPT INBOX MESSAGE (WITH SIGNATURE VERIFICATION)
    // -------------------------------------------------------------------------
    if (req.method === "POST" && pathname === "/api/ca/decrypt-inbox-message") {
      const body = await readJsonBody(req);
      const messageId = String(body.messageId || "").trim();
      const keyId = String(body.keyId || "").trim();
      const recipientId = String(body.recipientId || "").trim();

      const messages = loadCAMessages();
      const targetMsg = messages.find((m) => m.id === messageId);
      if (!targetMsg) {
        return sendJson(res, 404, { error: "Message not found in inbox." });
      }

      const encRel = `messages/${targetMsg.encFilename}`;
      const encPath = path.join(CA_DIR, encRel);
      if (!fs.existsSync(encPath)) {
        return sendJson(res, 404, { error: `Encrypted file '${encRel}' not found on disk.` });
      }

      // If Mallory is testing, ensure mallory.key exists in clients/mallory/
      if (keyId === "mallory") {
        getClientDir("mallory");
        const malloryKeyRel = "clients/mallory/mallory.key";
        const malloryKeyPath = path.join(CA_DIR, malloryKeyRel);
        if (!fs.existsSync(malloryKeyPath)) {
          runCAOpenSSL(["ecparam", "-name", "secp256k1", "-genkey", "-noout", "-out", malloryKeyRel]);
        }
        const cmdArgs = ["cms", "-decrypt", "-in", encRel, "-inkey", malloryKeyRel];
        const cmdString = `openssl ${cmdArgs.join(" ")}`;
        try {
          execFileSync("openssl", cmdArgs, { cwd: CA_DIR, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
          return sendJson(res, 200, { success: true, keyId, recipientId, plaintext: "Unexpected decryption" });
        } catch (err: any) {
          const stdout = err.stdout ? String(err.stdout).trim() : "";
          const stderr = err.stderr ? String(err.stderr).trim() : "";
          const errorMsg =
            [stdout, stderr].filter(Boolean).join("\n") || "Decryption failed: key does not match recipient's certificate";
          return sendJson(res, 200, {
            success: false,
            keyId,
            recipientId,
            error: errorMsg,
            opensslLog: { command: cmdString, output: errorMsg },
          });
        }
      }

      // Legitimate Recipient Decryption
      const recipKeyPath = path.join(CA_CLIENTS_DIR, recipientId, `${recipientId}.key`);
      if (!fs.existsSync(recipKeyPath)) {
        return sendJson(res, 200, {
          success: false,
          keyId,
          recipientId,
          error: `Missing Private Key: clients/${recipientId}/${recipientId}.key not found. Without your private key, encrypted documents can never be decrypted!`,
          opensslLog: {
            command: `openssl cms -decrypt -in ${encRel} -inkey clients/${recipientId}/${recipientId}.key`,
            output: "Error: private key missing. Decryption impossible.",
          },
        });
      }

      const decTmpRel = `messages/tmp_dec_${targetMsg.id}.tmp`;
      const decTmpPath = path.join(CA_DIR, decTmpRel);
      const decryptArgs = [
        "cms",
        "-decrypt",
        "-in",
        encRel,
        "-inkey",
        `clients/${recipientId}/${recipientId}.key`,
        "-recip",
        `clients/${recipientId}/${recipientId}.crt`,
        "-out",
        decTmpRel,
      ];
      const decryptCmd = `openssl ${decryptArgs.join(" ")}`;

      try {
        execFileSync("openssl", decryptArgs, { cwd: CA_DIR, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });

        let plaintext = "";
        let signatureValid = false;
        let verifyLog = "";

        if (targetMsg.isSigned) {
          // STEP 2: Verify Digital Signature with Root CA
          const verTmpRel = `messages/tmp_ver_${targetMsg.id}.txt`;
          const verTmpPath = path.join(CA_DIR, verTmpRel);
          const verifyArgs = ["cms", "-verify", "-in", decTmpRel, "-CAfile", "ca/root_ca.crt", "-out", verTmpRel];
          const verifyCmd = `openssl ${verifyArgs.join(" ")}`;

          try {
            execFileSync("openssl", verifyArgs, { cwd: CA_DIR, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
            plaintext = fs.readFileSync(verTmpPath, "utf-8").trim();
            signatureValid = true;
            verifyLog = `\n[2. Verify Signature] ${verifyCmd}\nCMS Verification successful: Signer authenticated by Root CA (CN=${targetMsg.senderName})`;
            try { fs.unlinkSync(verTmpPath); } catch {}
          } catch (verErr: any) {
            signatureValid = false;
            verifyLog = `\n[2. Verify Signature] ${verifyCmd}\nSignature verification failed!`;
            plaintext = fs.readFileSync(decTmpPath, "utf-8").trim();
          }
        } else {
          plaintext = fs.readFileSync(decTmpPath, "utf-8").trim();
        }

        try { fs.unlinkSync(decTmpPath); } catch {}

        return sendJson(res, 200, {
          success: true,
          messageId,
          keyId,
          recipientId,
          plaintext,
          isSigned: targetMsg.isSigned,
          signatureValid,
          signerName: targetMsg.senderName,
          opensslLog: {
            command: targetMsg.isSigned ? `${decryptCmd}\nopenssl cms -verify -in ${decTmpRel} -CAfile ca/root_ca.crt` : decryptCmd,
            output: `[1. Decrypt] Decryption successful with clients/${recipientId}/${recipientId}.key` + verifyLog,
          },
        });
      } catch (err: any) {
        try { if (fs.existsSync(decTmpPath)) fs.unlinkSync(decTmpPath); } catch {}
        const stdout = err.stdout ? String(err.stdout).trim() : "";
        const stderr = err.stderr ? String(err.stderr).trim() : "";
        const errorMsg = [stdout, stderr].filter(Boolean).join("\n") || "Decryption failed";
        return sendJson(res, 200, {
          success: false,
          messageId,
          keyId,
          recipientId,
          error: errorMsg,
          opensslLog: { command: decryptCmd, output: errorMsg },
        });
      }
    }

    // -------------------------------------------------------------------------
    // SIMULATE TAMPER / FORGERY ATTACK ON SIGNED MESSAGE
    // -------------------------------------------------------------------------
    if (req.method === "POST" && pathname === "/api/ca/tamper-inbox-message") {
      const body = await readJsonBody(req);
      const messageId = String(body.messageId || "").trim();
      const recipientId = String(body.recipientId || "").trim();

      const messages = loadCAMessages();
      const targetMsg = messages.find((m) => m.id === messageId);
      if (!targetMsg || !targetMsg.isSigned) {
        return sendJson(res, 400, { error: "Message not found or was not digitally signed." });
      }

      const encRel = `messages/${targetMsg.encFilename}`;
      const decTmpRel = `messages/tmp_tamper_dec_${targetMsg.id}.tmp`;
      const decTmpPath = path.join(CA_DIR, decTmpRel);
      const tamperRel = `messages/tmp_tampered_${targetMsg.id}.tmp`;
      const tamperPath = path.join(CA_DIR, tamperRel);

      try {
        execFileSync(
          "openssl",
          ["cms", "-decrypt", "-in", encRel, "-inkey", `clients/${recipientId}/${recipientId}.key`, "-recip", `clients/${recipientId}/${recipientId}.crt`, "-out", decTmpRel],
          { cwd: CA_DIR, stdio: ["ignore", "pipe", "pipe"] }
        );

        const signedContent = fs.readFileSync(decTmpPath, "utf-8");
        // Tamper with the content
        const tamperedContent = signedContent.replace(/\r?\n\r?\n/, "\n\n[TAMPERED IN TRANSIT] ");
        fs.writeFileSync(tamperPath, tamperedContent, "utf-8");

        const verifyArgs = ["cms", "-verify", "-in", tamperRel, "-CAfile", "ca/root_ca.crt", "-out", `/dev/null`];
        const verifyCmd = `openssl ${verifyArgs.join(" ")}`;

        try {
          execFileSync("openssl", verifyArgs, { cwd: CA_DIR, stdio: ["ignore", "pipe", "pipe"] });
          return sendJson(res, 200, { success: true, message: "Unexpected: verification passed" });
        } catch (verErr: any) {
          const stdout = verErr.stdout ? String(verErr.stdout).trim() : "";
          const stderr = verErr.stderr ? String(verErr.stderr).trim() : "";
          const errorMsg = [stdout, stderr].filter(Boolean).join("\n") || "Verification failure: digest failure";

          return sendJson(res, 200, {
            success: false,
            tamperDetected: true,
            messageId,
            error: errorMsg,
            opensslLog: {
              command: verifyCmd,
              output: `TAMPERING DETECTED BY OPENSSL!\n${errorMsg}\nExplanation: Digital signature mathematically proves the document was modified in transit.`,
            },
          });
        } finally {
          try { fs.unlinkSync(decTmpPath); } catch {}
          try { fs.unlinkSync(tamperPath); } catch {}
        }
      } catch (err: any) {
        try { if (fs.existsSync(decTmpPath)) fs.unlinkSync(decTmpPath); } catch {}
        try { if (fs.existsSync(tamperPath)) fs.unlinkSync(tamperPath); } catch {}
        return sendJson(res, 500, { error: "Failed to run tamper simulation test." });
      }
    }

    // -------------------------------------------------------------------------
    // DELETE INBOX MESSAGE
    // -------------------------------------------------------------------------
    if (req.method === "DELETE" && pathname.startsWith("/api/ca/inbox-message/")) {
      const msgId = pathname.replace("/api/ca/inbox-message/", "");
      const messages = loadCAMessages();
      const idx = messages.findIndex((m) => m.id === msgId);
      if (idx !== -1) {
        const [removed] = messages.splice(idx, 1);
        saveCAMessages(messages);
        const encPath = path.join(CA_MESSAGES_DIR, removed.encFilename);
        if (fs.existsSync(encPath)) {
          try {
            fs.unlinkSync(encPath);
          } catch {}
        }
      }
      return sendJson(res, 200, { success: true });
    }

    // -------------------------------------------------------------------------
    // LEGACY COMPATIBILITY: ENCRYPT FILE FOR RECIPIENT
    // -------------------------------------------------------------------------
    if (req.method === "POST" && pathname === "/api/ca/encrypt-file") {
      const body = await readJsonBody(req);
      const senderId = (body.senderId || "alice").trim();
      const recipientId = (body.recipientId || "bob").trim();
      const message = typeof body.message === "string" ? body.message : "Top Secret Financial Report 2026";

      const recipientCrtPath = path.join(CA_CLIENTS_DIR, recipientId, `${recipientId}.crt`);
      if (!fs.existsSync(recipientCrtPath)) {
        return sendJson(res, 400, {
          error: `Recipient certificate 'clients/${recipientId}/${recipientId}.crt' does not exist. Please generate and issue ${recipientId}'s certificate first!`,
        });
      }

      // Write plaintext message to file
      const rawMsgRel = "messages/secret_message.txt";
      const encMsgRel = "messages/secret_message.enc";
      const rawMsgPath = path.join(CA_DIR, rawMsgRel);
      const encMsgPath = path.join(CA_DIR, encMsgRel);
      fs.writeFileSync(rawMsgPath, message, "utf-8");

      // Encrypt using recipient's public certificate
      const cmdArgs = ["cms", "-encrypt", "-in", rawMsgRel, "-out", encMsgRel, `clients/${recipientId}/${recipientId}.crt`];
      const cmdString = `openssl ${cmdArgs.join(" ")}`;

      try {
        const out = execFileSync("openssl", cmdArgs, {
          cwd: CA_DIR,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "pipe"],
        });

        const encBuffer = fs.readFileSync(encMsgPath);
        const ciphertextBase64 = encBuffer.toString("base64");
        const ciphertextHexPreview = encBuffer.subarray(0, 48).toString("hex") + "...";

        return sendJson(res, 200, {
          success: true,
          senderId,
          recipientId,
          message,
          size: encBuffer.length,
          ciphertextBase64,
          ciphertextHexPreview,
          opensslLog: {
            command: cmdString,
            output: `Encrypted ${rawMsgRel} (${Buffer.byteLength(message)} bytes) -> ${encMsgRel} (${encBuffer.length} bytes) using clients/${recipientId}/${recipientId}.crt`,
          },
        });
      } catch (err: any) {
        const stdout = err.stdout ? String(err.stdout).trim() : "";
        const stderr = err.stderr ? String(err.stderr).trim() : "";
        return sendJson(res, 500, {
          error: "Failed to encrypt file with OpenSSL CMS",
          details: [stdout, stderr].filter(Boolean).join("\n"),
        });
      }
    }

    // -------------------------------------------------------------------------
    // LEGACY COMPATIBILITY: DECRYPT FILE
    // -------------------------------------------------------------------------
    if (req.method === "POST" && pathname === "/api/ca/decrypt-file") {
      const body = await readJsonBody(req);
      const keyId = (body.keyId || "bob").trim();
      const recipientId = (body.recipientId || "bob").trim();

      const encMsgRel = "messages/secret_message.enc";
      const encMsgPath = path.join(CA_DIR, encMsgRel);
      if (!fs.existsSync(encMsgPath)) {
        return sendJson(res, 400, { error: "No encrypted file (messages/secret_message.enc) found. Encrypt a message first!" });
      }

      // If Mallory is testing, ensure mallory.key exists
      if (keyId === "mallory") {
        getClientDir("mallory");
        const malloryKeyRel = "clients/mallory/mallory.key";
        const malloryKeyPath = path.join(CA_DIR, malloryKeyRel);
        if (!fs.existsSync(malloryKeyPath)) {
          runCAOpenSSL(["ecparam", "-name", "secp256k1", "-genkey", "-noout", "-out", malloryKeyRel]);
        }
      }

      const keyFile = `clients/${keyId}/${keyId}.key`;
      const cmdArgs = ["cms", "-decrypt", "-in", encMsgRel, "-inkey", keyFile];
      if (keyId === recipientId) {
        cmdArgs.push("-recip", `clients/${recipientId}/${recipientId}.crt`);
      }
      const cmdString = `openssl ${cmdArgs.join(" ")}`;

      try {
        const out = execFileSync("openssl", cmdArgs, {
          cwd: CA_DIR,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "pipe"],
        });

        return sendJson(res, 200, {
          success: true,
          keyId,
          recipientId,
          plaintext: out.trim(),
          opensslLog: {
            command: cmdString,
            output: `Decryption successful! Plaintext restored:\n"${out.trim()}"`,
          },
        });
      } catch (err: any) {
        const stdout = err.stdout ? String(err.stdout).trim() : "";
        const stderr = err.stderr ? String(err.stderr).trim() : "";
        const errorMsg =
          [stdout, stderr].filter(Boolean).join("\n") || "Decryption failed: key does not match recipient's certificate";

        return sendJson(res, 200, {
          success: false,
          keyId,
          recipientId,
          error: errorMsg,
          opensslLog: {
            command: cmdString,
            output: errorMsg,
          },
        });
      }
    }

    if (req.method === "DELETE" && pathname.startsWith("/api/ca/client/")) {
      const clientId = pathname.replace("/api/ca/client/", "");
      const store = loadCAStore();
      const idx = store.clients.findIndex((c) => c.id === clientId);
      if (idx !== -1) {
        store.clients.splice(idx, 1);
        if (store.clients.length === 0) {
          store.clients = [];
          store.activeId = "";
          store.activeRole = "admin";
        } else if (store.activeId === clientId) {
          store.activeId = store.clients[0].id;
        }
        saveCAStore(store);
      }

      // Remove client folder
      const clientDir = path.join(CA_CLIENTS_DIR, clientId);
      if (fs.existsSync(clientDir)) {
        try {
          fs.rmSync(clientDir, { recursive: true, force: true });
        } catch {}
      }

      return sendJson(res, 200, { success: true, activeId: store.activeId, activeRole: store.activeRole });
    }

    if (req.method === "POST" && pathname === "/api/ca/reset") {
      [CA_ROOT_DIR, CA_CLIENTS_DIR, CA_MESSAGES_DIR].forEach((dir) => {
        if (fs.existsSync(dir)) {
          try {
            fs.rmSync(dir, { recursive: true, force: true });
          } catch {}
        }
        try {
          fs.mkdirSync(dir, { recursive: true });
        } catch {}
      });
      const store: CAStore = { activeRole: "admin", activeId: "", clients: [] };
      saveCAStore(store);
      saveCAMessages([]);
      return sendJson(res, 200, { success: true, message: "CA and all mailboxes reset to zero." });
    }

    // =========================================================================
    // STEP-BY-STEP INTERACTIVE WIZARD (CREATE FILES STEP BY STEP)
    // =========================================================================
    if (req.method === "GET" && pathname === "/api/wizard/status") {
      const privPath = path.join(GENERATED_DIR, "alice_private.pem");
      const pubPath = path.join(GENERATED_DIR, "alice_public.pem");
      const msgPath = path.join(GENERATED_DIR, "message.txt");
      const sigPath = path.join(GENERATED_DIR, "signature.bin");

      const files = {
        privExists: fs.existsSync(privPath),
        privSize: fs.existsSync(privPath) ? fs.statSync(privPath).size : 0,
        pubExists: fs.existsSync(pubPath),
        pubSize: fs.existsSync(pubPath) ? fs.statSync(pubPath).size : 0,
        msgExists: fs.existsSync(msgPath),
        msgSize: fs.existsSync(msgPath) ? fs.statSync(msgPath).size : 0,
        sigExists: fs.existsSync(sigPath),
        sigSize: fs.existsSync(sigPath) ? fs.statSync(sigPath).size : 0,
      };

      let currentStep = 0;
      let keyData: any = null;
      if (files.privExists && files.pubExists) {
        currentStep = 2;
        keyData = deriveAccountDataFromPem("alice_private.pem", "alice_public.pem");
        if (files.sigExists) {
          currentStep = 4;
        }
      } else if (files.privExists) {
        currentStep = 1;
      }

      return sendJson(res, 200, { files, currentStep, keyData });
    }

    if (req.method === "POST" && pathname === "/api/wizard/step1-private") {
      const logs: OpenSSLLog[] = [];
      logs.push(
        runOpenSSL(["ecparam", "-name", "secp256k1", "-genkey", "-noout", "-out", "alice_private.pem"])
      );
      logs.push(runOpenSSL(["ec", "-in", "alice_private.pem", "-text", "-noout"]));

      const privPem = fs.readFileSync(path.join(GENERATED_DIR, "alice_private.pem"), "utf-8").trim();
      const privKeyObj = crypto.createPrivateKey(privPem);
      const jwk = privKeyObj.export({ format: "jwk" }) as { d: string };
      const privBytes = Buffer.from(jwk.d, "base64url");
      const privateKeyHex = privBytes.toString("hex").padStart(64, "0");
      const privateKeyDecimal = BigInt("0x" + privateKeyHex).toString(10);
      const privateKeyBinary = Array.from(privBytes)
        .map((b) => b.toString(2).padStart(8, "0"))
        .join(" ");

      return sendJson(res, 200, {
        step: 1,
        privatePem: privPem,
        privateKeyHex,
        privateKeyDecimal,
        privateKeyBinary,
        file: {
          name: "alice_private.pem",
          size: fs.statSync(path.join(GENERATED_DIR, "alice_private.pem")).size,
        },
        opensslLogs: logs,
      });
    }

    if (req.method === "POST" && pathname === "/api/wizard/step2-public") {
      const logs: OpenSSLLog[] = [];
      logs.push(runOpenSSL(["ec", "-in", "alice_private.pem", "-pubout", "-out", "alice_public.pem"]));
      logs.push(runOpenSSL(["ec", "-in", "alice_public.pem", "-pubin", "-text", "-noout"]));

      const privPem = fs.readFileSync(path.join(GENERATED_DIR, "alice_private.pem"), "utf-8").trim();
      const privKeyObj = crypto.createPrivateKey(privPem);
      const jwk = privKeyObj.export({ format: "jwk" }) as { x: string; y: string };
      const xBytes = Buffer.from(jwk.x, "base64url");
      const yBytes = Buffer.from(jwk.y, "base64url");

      const publicPem = fs.readFileSync(path.join(GENERATED_DIR, "alice_public.pem"), "utf-8").trim();
      const prefixByte = "04";
      const xCoordHex = xBytes.toString("hex").padStart(64, "0");
      const yCoordHex = yBytes.toString("hex").padStart(64, "0");
      const publicKeyFullHex = prefixByte + xCoordHex + yCoordHex;

      return sendJson(res, 200, {
        step: 2,
        publicPem,
        prefixByte,
        xCoordHex,
        yCoordHex,
        publicKeyFullHex,
        file: {
          name: "alice_public.pem",
          size: fs.statSync(path.join(GENERATED_DIR, "alice_public.pem")).size,
        },
        opensslLogs: logs,
      });
    }

    if (req.method === "POST" && pathname === "/api/wizard/step3-address") {
      const keyData = deriveAccountDataFromPem("alice_private.pem", "alice_public.pem");
      return sendJson(res, 200, {
        step: 3,
        sha3HashHex: keyData.sha3HashHex,
        discardedBytesHex: keyData.discardedBytesHex,
        addressBytesHex: keyData.addressBytesHex,
        accountAddress: keyData.accountAddress,
      });
    }

    if (req.method === "POST" && pathname === "/api/wizard/step4-sign") {
      const body = await readJsonBody(req);
      const message =
        typeof body.message === "string"
          ? body.message
          : "Hello, I am Alice. I authorize sending 10 coins to Bob.";
      const msgPath = path.join(GENERATED_DIR, "message.txt");
      const sigPath = path.join(GENERATED_DIR, "signature.bin");
      fs.writeFileSync(msgPath, message, "utf-8");

      const signLog = runOpenSSL([
        "dgst",
        "-sha256",
        "-sign",
        "alice_private.pem",
        "-out",
        "signature.bin",
        "message.txt",
      ]);
      const sigBuffer = fs.readFileSync(sigPath);
      const signatureHex = sigBuffer.toString("hex");
      const messageHashHex = crypto.createHash("sha256").update(message, "utf-8").digest("hex");

      return sendJson(res, 200, {
        step: 4,
        message,
        messageHashHex,
        signatureHex,
        signatureLength: sigBuffer.length,
        files: {
          msgFile: { name: "message.txt", size: fs.statSync(msgPath).size },
          sigFile: { name: "signature.bin", size: fs.statSync(sigPath).size },
        },
        opensslLog: {
          command: signLog.command,
          output: `Signed message.txt -> signature.bin (${sigBuffer.length} bytes)\nSignature Hex: ${signatureHex}`,
        },
      });
    }

    if (req.method === "POST" && pathname === "/api/wizard/step5-verify") {
      const body = await readJsonBody(req);
      const message = typeof body.message === "string" ? body.message : "";
      const verifyMsgPath = path.join(GENERATED_DIR, "verify_target.txt");
      fs.writeFileSync(verifyMsgPath, message, "utf-8");

      const verifyMessageHashHex = crypto
        .createHash("sha256")
        .update(message, "utf-8")
        .digest("hex");
      const cmdArgs = [
        "dgst",
        "-sha256",
        "-verify",
        "alice_public.pem",
        "-signature",
        "signature.bin",
        "verify_target.txt",
      ];
      const cmdString = `openssl ${cmdArgs.join(" ")}`;

      try {
        const out = execFileSync("openssl", cmdArgs, {
          cwd: GENERATED_DIR,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        return sendJson(res, 200, {
          isValid: true,
          verifyMessageHashHex,
          opensslLog: { command: cmdString, output: out.trim() || "Verified OK" },
        });
      } catch (err: any) {
        const stdout = err.stdout ? String(err.stdout).trim() : "";
        const stderr = err.stderr ? String(err.stderr).trim() : "";
        return sendJson(res, 200, {
          isValid: false,
          verifyMessageHashHex,
          opensslLog: {
            command: cmdString,
            output: [stdout, stderr].filter(Boolean).join("\n") || "Verification failure",
          },
        });
      }
    }

    if (req.method === "POST" && pathname === "/api/wizard/reset") {
      const cleaned = cleanWorkingFiles(true); // Deletes all .pem, .txt, .bin, accounts.json
      return sendJson(res, 200, {
        message: "Cleaned all files! Ready to start from scratch.",
        cleanedFiles: cleaned,
      });
    }

    // -------------------------------------------------------------------------
    // MODULE 0 CRUD API ENDPOINTS
    // -------------------------------------------------------------------------

    // [R] READ ALL ACCOUNTS & ACTIVE STATE
    if (req.method === "GET" && pathname === "/api/module0/accounts") {
      const store = ensureStoreInitialized();
      const active = store.accounts.find((a) => a.id === store.activeId) || store.accounts[0];
      const keyData = deriveAccountDataFromPem(active.privFile, active.pubFile);
      return sendJson(res, 200, {
        activeId: active.id,
        accounts: store.accounts,
        activeKeyData: keyData,
      });
    }

    // [R] READ SPECIFIC ACCOUNT DETAILS
    if (req.method === "GET" && pathname.startsWith("/api/module0/accounts/")) {
      const accountId = pathname.replace("/api/module0/accounts/", "");
      const store = ensureStoreInitialized();
      const account = store.accounts.find((a) => a.id === accountId);
      if (!account) {
        return sendJson(res, 404, { error: `Account '${accountId}' not found` });
      }
      store.activeId = account.id;
      saveAccountsStore(store);

      const logs: OpenSSLLog[] = [
        runOpenSSL(["ec", "-in", account.privFile, "-text", "-noout"]),
        runOpenSSL(["ec", "-in", account.pubFile, "-pubin", "-text", "-noout"]),
      ];
      const keyData = deriveAccountDataFromPem(account.privFile, account.pubFile, logs);
      return sendJson(res, 200, {
        account,
        activeId: account.id,
        accounts: store.accounts,
        keyData,
      });
    }

    // [C] CREATE NEW ACCOUNT WITH OPENSSL
    if (req.method === "POST" && pathname === "/api/module0/accounts") {
      const body = await readJsonBody(req);
      const name = (body.name || "").trim() || `Account ${Date.now().toString().slice(-4)}`;
      const safeId = name
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "_")
        .slice(0, 20) + "_" + Math.floor(Math.random() * 1000);

      const { logs, privFile, pubFile } = generateOpenSSLKeypair(safeId);
      const keyData = deriveAccountDataFromPem(privFile, pubFile, logs);

      const newAccount: AccountMeta = {
        id: safeId,
        name,
        privFile,
        pubFile,
        address: keyData.accountAddress,
        createdAt: Date.now(),
      };

      const store = ensureStoreInitialized();
      store.accounts.push(newAccount);
      store.activeId = newAccount.id;
      saveAccountsStore(store);

      return sendJson(res, 201, {
        account: newAccount,
        accounts: store.accounts,
        activeId: store.activeId,
        keyData,
        opensslLogs: logs,
      });
    }

    // [U] UPDATE ACCOUNT (Rename or Regenerate Key)
    if (req.method === "PUT" && pathname.startsWith("/api/module0/accounts/")) {
      const accountId = pathname.replace("/api/module0/accounts/", "");
      const body = await readJsonBody(req);
      const store = ensureStoreInitialized();
      const accountIndex = store.accounts.findIndex((a) => a.id === accountId);
      if (accountIndex === -1) {
        return sendJson(res, 404, { error: `Account '${accountId}' not found` });
      }

      let logs: OpenSSLLog[] = [];
      const account = store.accounts[accountIndex];

      // Action 1: Rename
      if (typeof body.name === "string" && body.name.trim()) {
        account.name = body.name.trim();
      }

      // Action 2: Regenerate keypair with OpenSSL
      if (body.action === "regenerate") {
        const genResult = generateOpenSSLKeypair(account.id);
        logs = genResult.logs;
        const keyData = deriveAccountDataFromPem(account.privFile, account.pubFile, logs);
        account.address = keyData.accountAddress;
      }

      store.accounts[accountIndex] = account;
      store.activeId = account.id;
      saveAccountsStore(store);

      const keyData = deriveAccountDataFromPem(account.privFile, account.pubFile, logs);
      return sendJson(res, 200, {
        account,
        accounts: store.accounts,
        activeId: store.activeId,
        keyData,
        opensslLogs: logs,
      });
    }

    // [D] DELETE ACCOUNT
    if (req.method === "DELETE" && pathname.startsWith("/api/module0/accounts/")) {
      const accountId = pathname.replace("/api/module0/accounts/", "");
      const store = ensureStoreInitialized();
      const accountIndex = store.accounts.findIndex((a) => a.id === accountId);
      if (accountIndex === -1) {
        return sendJson(res, 404, { error: `Account '${accountId}' not found` });
      }

      const account = store.accounts[accountIndex];
      // Delete .pem files from disk
      try {
        fs.unlinkSync(path.join(GENERATED_DIR, account.privFile));
        fs.unlinkSync(path.join(GENERATED_DIR, account.pubFile));
      } catch {
        // ignore
      }

      store.accounts.splice(accountIndex, 1);

      // If no accounts left, recreate a clean Alice
      if (store.accounts.length === 0) {
        const { logs, privFile, pubFile } = generateOpenSSLKeypair("alice");
        const keyData = deriveAccountDataFromPem(privFile, pubFile, logs);
        const defaultAccount: AccountMeta = {
          id: "alice",
          name: "Alice (Default)",
          privFile,
          pubFile,
          address: keyData.accountAddress,
          createdAt: Date.now(),
        };
        store.accounts = [defaultAccount];
        store.activeId = defaultAccount.id;
      } else if (store.activeId === accountId) {
        store.activeId = store.accounts[0].id;
      }

      saveAccountsStore(store);
      const active = store.accounts.find((a) => a.id === store.activeId)!;
      const keyData = deriveAccountDataFromPem(active.privFile, active.pubFile);

      return sendJson(res, 200, {
        message: `Account '${account.name}' deleted.`,
        accounts: store.accounts,
        activeId: store.activeId,
        keyData,
      });
    }

    // [CLEAN / RESET ALL] Wipes all generated files and resets to clean state
    if (req.method === "POST" && pathname === "/api/module0/clean") {
      const cleaned = cleanWorkingFiles(true); // deletes all .pem, .txt, .bin, accounts.json

      // Reinitialize one brand new clean account
      const { logs, privFile, pubFile } = generateOpenSSLKeypair("alice");
      const keyData = deriveAccountDataFromPem(privFile, pubFile, logs);
      const freshAccount: AccountMeta = {
        id: "alice",
        name: "Alice (Fresh)",
        privFile,
        pubFile,
        address: keyData.accountAddress,
        createdAt: Date.now(),
      };
      const store: AccountsStore = {
        activeId: "alice",
        accounts: [freshAccount],
      };
      saveAccountsStore(store);

      return sendJson(res, 200, {
        message: `Cleaned ${cleaned.length} files. Reset to 1 fresh account.`,
        cleanedFiles: cleaned,
        accounts: store.accounts,
        activeId: store.activeId,
        keyData,
        opensslLogs: logs,
      });
    }

    // -------------------------------------------------------------------------
    // MODULE 0 SIGN & VERIFY ENDPOINTS (Uses currently active account)
    // -------------------------------------------------------------------------
    if (req.method === "POST" && pathname === "/api/module0/sign") {
      const body = await readJsonBody(req);
      const message =
        typeof body.message === "string"
          ? body.message
          : "Hello, I am Alice. I authorize sending 10 coins to Bob.";

      const store = ensureStoreInitialized();
      const account = store.accounts.find((a) => a.id === store.activeId) || store.accounts[0];

      const msgPath = path.join(GENERATED_DIR, "message.txt");
      const sigPath = path.join(GENERATED_DIR, "signature.bin");
      fs.writeFileSync(msgPath, message, "utf-8");

      const signLog = runOpenSSL([
        "dgst",
        "-sha256",
        "-sign",
        account.privFile,
        "-out",
        "signature.bin",
        "message.txt",
      ]);

      const sigBuffer = fs.readFileSync(sigPath);
      const signatureHex = sigBuffer.toString("hex");
      const messageHashHex = crypto.createHash("sha256").update(message, "utf-8").digest("hex");

      return sendJson(res, 200, {
        signerName: account.name,
        signerAddress: account.address,
        message,
        messageHashHex,
        signatureHex,
        signatureLength: sigBuffer.length,
        opensslLog: {
          command: signLog.command,
          output: `Signed message.txt using ${account.privFile} -> signature.bin (${sigBuffer.length} bytes)\nSignature Hex: ${signatureHex}`,
        },
      });
    }

    if (req.method === "POST" && pathname === "/api/module0/verify") {
      const body = await readJsonBody(req);
      const message = typeof body.message === "string" ? body.message : "";
      const signatureHex = typeof body.signatureHex === "string" ? body.signatureHex : "";

      const store = ensureStoreInitialized();
      const account = store.accounts.find((a) => a.id === store.activeId) || store.accounts[0];

      const verifyMsgPath = path.join(GENERATED_DIR, "verify_target.txt");
      const verifySigPath = path.join(GENERATED_DIR, "verify_sig.bin");

      fs.writeFileSync(verifyMsgPath, message, "utf-8");
      if (signatureHex) {
        fs.writeFileSync(verifySigPath, Buffer.from(signatureHex, "hex"));
      }

      const verifyMessageHashHex = crypto
        .createHash("sha256")
        .update(message, "utf-8")
        .digest("hex");
      const cmdArgs = [
        "dgst",
        "-sha256",
        "-verify",
        account.pubFile,
        "-signature",
        signatureHex ? "verify_sig.bin" : "signature.bin",
        "verify_target.txt",
      ];
      const cmdString = `openssl ${cmdArgs.join(" ")}`;

      try {
        const out = execFileSync("openssl", cmdArgs, {
          cwd: GENERATED_DIR,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        return sendJson(res, 200, {
          isValid: true,
          signerName: account.name,
          verifyMessageHashHex,
          opensslLog: {
            command: cmdString,
            output: out.trim() || "Verified OK",
          },
        });
      } catch (err: any) {
        const stdout = err.stdout ? String(err.stdout).trim() : "";
        const stderr = err.stderr ? String(err.stderr).trim() : "";
        return sendJson(res, 200, {
          isValid: false,
          signerName: account.name,
          verifyMessageHashHex,
          opensslLog: {
            command: cmdString,
            output: [stdout, stderr].filter(Boolean).join("\n") || "Verification failure",
          },
        });
      }
    }

    // -------------------------------------------------------------------------
    // MODULE 1 API ENDPOINTS (Wallets & Zero-Trust Transactions)
    // -------------------------------------------------------------------------
    if (req.method === "GET" && pathname === "/api/module1/wallets") {
      const list = Array.from(wallets.values()).map((w) => ({
        name: w.name,
        address: w.address,
        publicKeyHex: w.publicKeyHex,
      }));
      return sendJson(res, 200, { wallets: list });
    }

    if (req.method === "POST" && pathname === "/api/module1/regenerate-wallets") {
      initModule1Wallets();
      const list = Array.from(wallets.values()).map((w) => ({
        name: w.name,
        address: w.address,
        publicKeyHex: w.publicKeyHex,
      }));
      return sendJson(res, 200, { wallets: list });
    }

    if (req.method === "POST" && pathname === "/api/module1/sign-tx") {
      const body = await readJsonBody(req);
      const signerName = body.signerName || "Alice";
      const to = body.to || wallets.get("Bob")?.address || "";
      const amount = Number(body.amount ?? 15);
      const nonce = Number(body.nonce ?? 0);

      const wallet = wallets.get(signerName);
      if (!wallet) {
        return sendJson(res, 400, { error: `Wallet '${signerName}' not found` });
      }

      const signedTx = signTransaction(wallet, to, amount, nonce);
      const txHashHex = hashTransaction(signedTx.data).toString("hex");
      const serialized = serializeTransaction(signedTx.data);

      return sendJson(res, 200, {
        signedTx,
        txHashHex,
        serialized,
      });
    }

    if (req.method === "POST" && pathname === "/api/module1/verify-tx") {
      const body = await readJsonBody(req);
      const signedTx: SignedTransaction = body.signedTx;
      if (!signedTx || !signedTx.data) {
        return sendJson(res, 400, { error: "Missing signedTx payload" });
      }

      const result = verifyTransaction(signedTx);
      const recomputedHashHex = hashTransaction(signedTx.data).toString("hex");

      let derivedAddress = "Invalid Public Key";
      let addressCheckPassed = false;
      try {
        const rawPubBuffer = Buffer.from(signedTx.senderPublicKeyHex, "hex");
        const coordinates = rawPubBuffer.subarray(1);
        const hash = crypto.createHash("sha3-256").update(coordinates).digest();
        derivedAddress = "0x" + hash.subarray(hash.length - 20).toString("hex");
        addressCheckPassed = derivedAddress.toLowerCase() === signedTx.data.from.toLowerCase();
      } catch {
        addressCheckPassed = false;
      }

      return sendJson(res, 200, {
        isValid: result.isValid,
        reason: result.reason || "All cryptographic checks passed! Authentic & unaltered.",
        recomputedHashHex,
        derivedAddress,
        claimedFromAddress: signedTx.data.from,
        addressCheckPassed,
        signatureCheckPassed: result.isValid,
      });
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
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
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

const PORT = Number(process.env.PORT || 3000);
if (process.env.TEST_MODE !== "true") {
  server.listen(PORT, () => {
    console.log(`\n===============================================================`);
    console.log(` 🚀 Blockchain Visual Lab running at http://localhost:${PORT}`);
    console.log(`===============================================================\n`);
  });
}
