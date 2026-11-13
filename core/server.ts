import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import {
  CORE_UI_DIR,
  ROOT_DIR,
  sendJson,
  serveCoreAssetIfMatch,
  serveStaticFromDir,
} from "./http.ts";

import { server as m0Server } from "../module0-ca/ui/server.ts";
import { server as m1Server } from "../module1-cryptography/ui/server.ts";
import { server as m2Server } from "../module2-blockchain/ui/server.ts";

const M0_PUBLIC_DIR = path.join(ROOT_DIR, "module0-ca", "ui", "public");
const M1_PUBLIC_DIR = path.join(ROOT_DIR, "module1-cryptography", "ui", "public");
const M2_PUBLIC_DIR = path.join(ROOT_DIR, "module2-blockchain", "ui", "public");

const M0_GEN_DIR = path.join(ROOT_DIR, "module0-ca", "generated");
const M1_GEN_DIR = path.join(ROOT_DIR, "module1-cryptography", "generated");
const M2_GEN_DIR = path.join(ROOT_DIR, "module2-blockchain", "generated");

function readJsonSafe<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function getHubState() {
  // Module 0 summary (module0-ca/generated/)
  const rootKeyExists = fs.existsSync(path.join(M0_GEN_DIR, "ca", "root_ca.key"));
  const rootCrtExists = fs.existsSync(path.join(M0_GEN_DIR, "ca", "root_ca.crt"));
  const m0Store = readJsonSafe<{ activeRole?: string; clients?: unknown[] }>(
    path.join(M0_GEN_DIR, "clients.json"),
    { activeRole: "admin", clients: [] }
  );
  const m0Messages = readJsonSafe<unknown[]>(path.join(M0_GEN_DIR, "messages.json"), []);

  // Module 1 summary (module1-cryptography/generated/)
  const m1Store = readJsonSafe<{ activeRole?: string; wallets?: unknown[] }>(
    path.join(M1_GEN_DIR, "wallets.json"),
    { activeRole: "node", wallets: [] }
  );
  const m1Txs = readJsonSafe<unknown[]>(path.join(M1_GEN_DIR, "transactions.json"), []);

  // Module 2 summary (module2-blockchain/generated/)
  const m2State = readJsonSafe<{ activeRole?: string; chain?: unknown[]; mempool?: unknown[] }>(
    path.join(M2_GEN_DIR, "state.json"),
    { activeRole: "node", chain: [], mempool: [] }
  );
  const m2Wallets = readJsonSafe<unknown[]>(path.join(M2_GEN_DIR, "wallets.json"), []);
  const m2BlocksCount = Array.isArray(m2State.chain) ? m2State.chain.length : 0;

  return {
    m0: {
      generatedDir: "module0-ca/generated/",
      rootCaExists: rootKeyExists && rootCrtExists,
      activeRole: m0Store.activeRole || "admin",
      clientsCount: Array.isArray(m0Store.clients) ? m0Store.clients.length : 0,
      messagesCount: Array.isArray(m0Messages) ? m0Messages.length : 0,
    },
    m1: {
      generatedDir: "module1-cryptography/generated/",
      activeRole: m1Store.activeRole || "node",
      walletsCount: Array.isArray(m1Store.wallets) ? m1Store.wallets.length : 0,
      transactionsCount: Array.isArray(m1Txs) ? m1Txs.length : 0,
    },
    m2: {
      generatedDir: "module2-blockchain/generated/",
      initialized: m2BlocksCount > 0,
      activeRole: m2State.activeRole || "node",
      blocksCount: m2BlocksCount,
      mempoolCount: Array.isArray(m2State.mempool) ? m2State.mempool.length : 0,
      walletsCount: Array.isArray(m2Wallets) ? m2Wallets.length : 0,
      chainValid: true,
    },
  };
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    // 1. Hub Summary Endpoint
    if (req.method === "GET" && pathname === "/api/hub/state") {
      return sendJson(res, 200, getHubState());
    }

    // 2. Delegate Module APIs (each module writes strictly to its own generated/ folder)
    if (pathname.startsWith("/api/ca/")) {
      m0Server.emit("request", req, res);
      return;
    }
    if (pathname.startsWith("/api/m1/")) {
      m1Server.emit("request", req, res);
      return;
    }
    if (pathname.startsWith("/api/m2/")) {
      m2Server.emit("request", req, res);
      return;
    }

    // 3. Shared Core UI Assets (/core/core.css, /core/core.js)
    if (serveCoreAssetIfMatch(res, pathname)) {
      return;
    }

    // 4. Module Static UI Mounts (/m0/, /m1/, /m2/)
    if (pathname === "/m0" || pathname === "/m1" || pathname === "/m2") {
      res.writeHead(302, { Location: `${pathname}/` });
      res.end();
      return;
    }
    if (pathname.startsWith("/m0/")) {
      if (serveStaticFromDir(res, M0_PUBLIC_DIR, pathname.slice(3))) return;
    }
    if (pathname.startsWith("/m1/")) {
      if (serveStaticFromDir(res, M1_PUBLIC_DIR, pathname.slice(3))) return;
    }
    if (pathname.startsWith("/m2/")) {
      if (serveStaticFromDir(res, M2_PUBLIC_DIR, pathname.slice(3))) return;
    }

    // 5. Unified Hub Index Page (/)
    if (pathname === "/" || pathname === "/index.html") {
      if (serveStaticFromDir(res, CORE_UI_DIR, "/index.html")) return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  } catch (err: any) {
    console.error("Unified Server error:", err);
    sendJson(res, 500, { error: err.message || "Internal Server Error" });
  }
});

const PORT = Number(process.env.PORT || 3000);
if (process.env.TEST_MODE !== "true") {
  server.listen(PORT, () => {
    console.log(`\n=======================================================================`);
    console.log(` 🚀 Unified Cryptography & Blockchain Visual Lab: http://localhost:${PORT}`);
    console.log(`    ├─ Hub Index        : http://localhost:${PORT}/`);
    console.log(`    ├─ Module 0 (PKI/CA): http://localhost:${PORT}/m0/  -> module0-ca/generated/`);
    console.log(`    ├─ Module 1 (Crypto): http://localhost:${PORT}/m1/  -> module1-cryptography/generated/`);
    console.log(`    └─ Module 2 (Chain) : http://localhost:${PORT}/m2/  -> module2-blockchain/generated/`);
    console.log(`=======================================================================\n`);
  });
}

export { server };
