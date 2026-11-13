// ============================================================================
// MODULE 2: BLOCKCHAIN & PROOF-OF-WORK VISUAL LAB CONTROLLER
// ============================================================================

let m2State = {
  initialized: false,
  activeRole: "node",
  config: { difficulty: 2, blockReward: 50, targetPrefix: "00" },
  chain: [],
  mempool: [],
  wallets: [],
  validation: { isValid: true },
  totalSupply: 0,
  lastMiningResult: null,
  logs: [],
};

let activeTab = "tx-mempool";
let selectedBlockIndex = 0;
let lastSenderId = "";
let isLogsPageOpen = false;
let logFilter = "all";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function shortHex(hex, head = 8, tail = 6) {
  if (!hex || typeof hex !== "string") return "-";
  if (hex.length <= head + tail + 3) return hex;
  return `${hex.slice(0, head)}...${hex.slice(-tail)}`;
}

function walletNameForAddress(address) {
  if (!address) return "Unknown";
  if (address === "0x0000000000000000000000000000000000000000") return "COINBASE (Protocol Mint)";
  if (address === "GENESIS_NETWORK_ORIGIN") return "GENESIS_NETWORK_ORIGIN";
  const found = m2State.wallets.find((w) => w.address.toLowerCase() === address.toLowerCase());
  return found ? `${found.name} (${shortHex(address, 6, 4)})` : shortHex(address, 8, 6);
}

function showToast(message, type = "info") {
  const region = document.getElementById("toast-region");
  if (!region) return;
  const colorClass =
    type === "error"
      ? "border-rose-500/50 bg-zinc-900 text-rose-400"
      : type === "success"
        ? "border-emerald-500/50 bg-zinc-900 text-emerald-400"
        : "border-zinc-700 bg-zinc-900 text-zinc-200";

  const el = document.createElement("div");
  el.className = `rounded-lg border px-3.5 py-2.5 text-xs font-mono shadow-xl ${colorClass}`;
  el.textContent = message;
  region.replaceChildren(el);
  setTimeout(() => {
    if (region.contains(el)) el.remove();
  }, 4200);
}

// Theme toggle is unified globally via /core/core.js
function initThemeToggle() {
  if (window.SSLCore?.applyTheme) {
    window.SSLCore.applyTheme(window.SSLCore.getSavedTheme(), false);
  }
}

// ============================================================================
// NATIVE DIALOGS + SAFARI LIGHT-DISMISS FALLBACK
// ============================================================================
function initDialogFallbacks() {
  if (!("closedBy" in HTMLDialogElement.prototype)) {
    const outside = (e, dialog) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
      let pressedOutside = false;
      dialog.addEventListener("pointerdown", (e) => {
        pressedOutside = outside(e, dialog);
      });
      dialog.addEventListener("pointerup", (e) => {
        if (pressedOutside && outside(e, dialog)) dialog.close("");
      });
    }
  }

  for (const dialog of document.querySelectorAll("dialog")) {
    dialog.addEventListener("cancel", () => {
      dialog.returnValue = "";
    });
  }
}

// ============================================================================
// API & STATE SYNC
// ============================================================================
async function apiRequest(url, method = "GET", body = null) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== null) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

async function syncM2State(selectLatestBlock = false) {
  try {
    const state = await apiRequest("/api/m2/state");
    m2State = state;
    if (selectLatestBlock || selectedBlockIndex >= m2State.chain.length) {
      selectedBlockIndex = Math.max(0, m2State.chain.length - 1);
    }
    renderAll();
  } catch (err) {
    showToast(`Failed to sync state: ${err.message}`, "error");
  }
}

// ============================================================================
// RENDERING
// ============================================================================
function renderAll() {
  renderRoleSelector();
  renderActiveRoleView();
  renderStepGuide();
  renderHeaderAndStats();
  renderWallets();
  renderChainStrip();
  renderTxFormAndMempool();
  renderMiningPanel();
  renderInspector();
  renderTamperLab();
  renderLogsPage();

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function getEffectiveRole() {
  const r = m2State.activeRole || "node";
  if (r === "node" || r === "attacker") return r;
  if ((m2State.wallets || []).some((w) => w.id === r)) return r;
  return "node";
}

function renderRoleSelector() {
  const activeLabel = document.getElementById("role-active-label");
  const itemsContainer = document.getElementById("role-dropdown-items");
  const activeDot = document.getElementById("role-active-dot");
  if (!itemsContainer) return;

  const role = getEffectiveRole();
  const isNode = role === "node";
  const isAttacker = role === "attacker";
  let activeText = "Validator Node (Network)";

  if (activeDot) {
    if (isAttacker) {
      activeDot.className = "w-2 h-2 rounded-full bg-rose-500 animate-pulse shrink-0";
    } else if (isNode) {
      activeDot.className = m2State.chain.length > 0
        ? "w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0"
        : "w-2 h-2 rounded-full bg-zinc-500 shrink-0";
    } else {
      activeDot.className = "w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0";
    }
  }

  let itemsHtml = `
    <button type="button" class="role-option-item w-full flex items-center justify-between px-3 py-2 sm:px-2.5 sm:py-1.5 rounded-md transition-colors text-left cursor-pointer ${
      isNode ? "bg-zinc-800/70 text-zinc-100 font-medium" : "text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
    }" data-role="node">
      <div class="flex items-center gap-2.5 min-w-0">
        <div class="w-6 h-6 rounded-md bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-300 shrink-0">
          <i data-lucide="cpu" class="w-3.5 h-3.5"></i>
        </div>
        <div class="min-w-0">
          <div class="text-xs font-medium text-zinc-100 truncate">Validator Node (Network)</div>
          <div class="text-[10px] text-zinc-500 font-mono truncate">Ledger, Mempool &amp; Merkle</div>
        </div>
      </div>
      ${isNode ? `<i data-lucide="check" class="w-3.5 h-3.5 text-emerald-400 shrink-0"></i>` : ""}
    </button>
  `;

  if (m2State.wallets && m2State.wallets.length > 0) {
    itemsHtml += `
      <div class="my-1 border-t border-zinc-800/60"></div>
      <div class="px-2.5 py-1 text-[10px] font-mono uppercase font-bold text-zinc-500">Wallet &amp; Miner Clients</div>
    `;
    m2State.wallets.forEach((w) => {
      const isActive = role === w.id;
      if (isActive) activeText = `${w.name} (Wallet/Miner)`;
      const initial = (w.name || "W").charAt(0).toUpperCase();
      itemsHtml += `
        <button type="button" class="role-option-item w-full flex items-center justify-between px-3 py-2 sm:px-2.5 sm:py-1.5 rounded-md transition-colors text-left cursor-pointer ${
          isActive ? "bg-zinc-800/70 text-zinc-100 font-medium" : "text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
        }" data-role="${escapeHtml(w.id)}">
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="w-6 h-6 rounded-md bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xs font-semibold text-zinc-200 shrink-0">
              ${escapeHtml(initial)}
            </div>
            <div class="min-w-0">
              <div class="text-xs font-medium text-zinc-100 truncate">${escapeHtml(w.name)}</div>
              <div class="text-[10px] font-mono text-zinc-500 truncate">${escapeHtml(w.confirmedBalance)} Coins · Nonce ${escapeHtml(w.nextNonce)}</div>
            </div>
          </div>
          ${isActive ? `<i data-lucide="check" class="w-3.5 h-3.5 text-emerald-400 shrink-0"></i>` : ""}
        </button>
      `;
    });
  }

  itemsHtml += `
    <div class="my-1 border-t border-zinc-800/60"></div>
    <div class="px-2.5 py-1 text-[10px] font-mono uppercase font-bold text-zinc-500">Adversary</div>
    <button type="button" class="role-option-item w-full flex items-center justify-between px-3 py-2 sm:px-2.5 sm:py-1.5 rounded-md transition-colors text-left cursor-pointer ${
      isAttacker ? "bg-rose-500/15 text-rose-200 font-medium" : "text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
    }" data-role="attacker">
      <div class="flex items-center gap-2.5 min-w-0">
        <div class="w-6 h-6 rounded-md bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0">
          <i data-lucide="bug" class="w-3.5 h-3.5"></i>
        </div>
        <div class="min-w-0">
          <div class="text-xs font-medium ${isAttacker ? "text-rose-200" : "text-zinc-100"} truncate">Attacker (Tamper Lab)</div>
          <div class="text-[10px] text-zinc-500 font-mono truncate">Tamper &amp; Re-Mine Simulation</div>
        </div>
      </div>
      ${isAttacker ? `<i data-lucide="check" class="w-3.5 h-3.5 text-rose-400 shrink-0"></i>` : ""}
    </button>
  `;

  if (isAttacker) activeText = "Attacker (Tamper Lab)";
  if (activeLabel) activeLabel.textContent = activeText;
  itemsContainer.innerHTML = itemsHtml;
}

function renderActiveRoleView() {
  const role = getEffectiveRole();
  const nodeView = document.getElementById("view-role-node");
  const walletView = document.getElementById("view-role-wallet");
  const attackerView = document.getElementById("view-role-attacker");

  const isNode = role === "node";
  const isAttacker = role === "attacker";
  const activeWallet = !isNode && !isAttacker
    ? (m2State.wallets || []).find((w) => w.id === role)
    : null;

  if (nodeView) nodeView.classList.toggle("hidden", !isNode);
  if (attackerView) attackerView.classList.toggle("hidden", !isAttacker);
  if (walletView) walletView.classList.toggle("hidden", !activeWallet);

  if (activeWallet) {
    const avatar = document.getElementById("wallet-role-avatar");
    const nameEl = document.getElementById("wallet-role-name");
    const addrEl = document.getElementById("wallet-role-address");
    const confEl = document.getElementById("wallet-role-confirmed");
    const pendEl = document.getElementById("wallet-role-pending");
    const nonceEl = document.getElementById("wallet-role-nonce");

    if (avatar) avatar.textContent = (activeWallet.name || "W").charAt(0).toUpperCase();
    if (nameEl) nameEl.textContent = activeWallet.name;
    if (addrEl) addrEl.textContent = activeWallet.address;
    if (confEl) confEl.textContent = `${activeWallet.confirmedBalance} Coins`;
    if (pendEl) pendEl.textContent = `${activeWallet.pendingBalance} Coins`;
    if (nonceEl) nonceEl.textContent = String(activeWallet.nextNonce);
  }
}

function toggleRoleDropdown(show) {
  const menu = document.getElementById("role-dropdown-menu");
  const trigger = document.getElementById("role-dropdown-trigger");
  const chevron = document.getElementById("role-dropdown-chevron");
  if (!menu) return;
  const shouldOpen = typeof show === "boolean" ? show : menu.classList.contains("hidden");
  menu.classList.toggle("hidden", !shouldOpen);
  if (trigger) trigger.setAttribute("aria-expanded", String(shouldOpen));
  if (chevron) chevron.classList.toggle("rotate-180", shouldOpen);
}

async function selectRole(role) {
  toggleRoleDropdown(false);
  if (isLogsPageOpen) toggleLogsPage(false);
  try {
    const res = await apiRequest("/api/m2/select-role", "POST", { role });
    m2State = res.state;
    renderAll();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function toggleLogsPage(open) {
  isLogsPageOpen = typeof open === "boolean" ? open : !isLogsPageOpen;
  const workbench = document.getElementById("main-workbench");
  const logsPage = document.getElementById("logs-page");
  const btn = document.getElementById("btn-open-logs");
  if (workbench) workbench.classList.toggle("hidden", isLogsPageOpen);
  if (logsPage) logsPage.classList.toggle("hidden", !isLogsPageOpen);
  if (btn) {
    btn.classList.toggle("bg-zinc-800", isLogsPageOpen);
    btn.classList.toggle("text-zinc-100", isLogsPageOpen);
    btn.title = isLogsPageOpen ? "Back to Lab" : "View Action & Command Logs";
    btn.setAttribute("aria-label", isLogsPageOpen ? "Back to Lab" : "View Action & Command Logs");
    btn.innerHTML = `<i data-lucide="${isLogsPageOpen ? "home" : "terminal"}" class="w-4 h-4 sm:w-3.5 sm:h-3.5"></i>`;
  }
  renderLogsPage();
  if (window.lucide) window.lucide.createIcons();
}

function renderLogsPage() {
  const logs = Array.isArray(m2State.logs) ? m2State.logs : [];
  const headerCount = document.getElementById("header-logs-count");
  const pageCount = document.getElementById("logs-page-count");
  if (headerCount) headerCount.textContent = String(logs.length);
  if (pageCount) pageCount.textContent = `${logs.length} ${logs.length === 1 ? "entry" : "entries"}`;

  const list = document.getElementById("logs-list");
  if (!list) return;

  const filtered = logs.filter((entry) => {
    if (logFilter === "all") return true;
    return entry.status === logFilter;
  });

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="rounded-lg border border-dashed border-zinc-800 p-8 text-center text-xs text-zinc-400">
        ${logs.length === 0 ? "No commands executed yet. Run any step in the lab to record activity logs." : `No ${escapeHtml(logFilter)} log entries found.`}
      </div>
    `;
    return;
  }

  list.innerHTML = filtered
    .map((entry) => {
      const isErr = entry.status === "error";
      const timeStr = new Date(entry.timestamp).toLocaleTimeString();
      const detailsJson = entry.details ? JSON.stringify(entry.details) : "";
      return `
        <div class="rounded-lg border ${isErr ? "border-rose-500/40 bg-rose-500/5" : "border-zinc-800 bg-zinc-950"} p-3 space-y-2 text-xs">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2 min-w-0">
              <span class="vault-badge ${isErr ? "invalid" : "valid"} shrink-0">${isErr ? "ERR" : "OK"}</span>
              <span class="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 font-mono text-[10px] text-zinc-200 font-semibold">${escapeHtml(entry.action)}</span>
            </div>
            <span class="text-[11px] font-mono text-zinc-500 shrink-0">${escapeHtml(timeStr)}</span>
          </div>
          <div class="rounded bg-zinc-900/90 border border-zinc-800/80 px-2.5 py-1.5 font-mono text-[11px] text-zinc-200 flex items-start justify-between gap-2">
            <div class="break-all min-w-0">
              <span class="text-zinc-500 select-none">$ </span>${escapeHtml(entry.command)}
            </div>
            <button type="button" class="btn-copy-log-cmd text-zinc-400 hover:text-zinc-100 p-1 rounded hover:bg-zinc-800 shrink-0" data-cmd="${escapeHtml(entry.command)}" title="Copy command" aria-label="Copy command">
              <i data-lucide="copy" class="w-3.5 h-3.5"></i>
            </button>
          </div>
          ${entry.sdk ? `<div class="text-[11px] font-mono text-zinc-400 break-all"><span class="text-zinc-500">TS:</span> ${escapeHtml(entry.sdk)}</div>` : ""}
          <div class="text-xs ${isErr ? "text-rose-300" : "text-zinc-300"}">${escapeHtml(entry.summary)}</div>
          ${detailsJson ? `<div class="text-[10px] font-mono text-zinc-500 break-all">${escapeHtml(detailsJson)}</div>` : ""}
        </div>
      `;
    })
    .join("");

  list.querySelectorAll(".btn-copy-log-cmd").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const cmd = btn.getAttribute("data-cmd") || "";
      try {
        await navigator.clipboard.writeText(cmd);
        showToast("Command copied to clipboard!", "success");
      } catch {
        showToast("Failed to copy command.", "error");
      }
    });
  });
}

function renderStepGuide() {
  const listEl = document.getElementById("steps-list");
  const badgeEl = document.getElementById("steps-progress-badge");
  if (!listEl || !badgeEl) return;

  const hasGenesis = m2State.chain.length > 0;
  const hasWallets = m2State.wallets.length >= 2;
  const hasMinedBlock = m2State.chain.length >= 2;
  const hasTxInBlock = m2State.chain.some((b) => b.index > 0 && b.transactions.length > 1);
  const hasTxCreated = m2State.mempool.length > 0 || hasTxInBlock;
  const hasTamperTested = hasGenesis && !m2State.validation.isValid;

  const steps = [
    {
      num: 1,
      title: "Initialize Genesis Block (#0)",
      desc: "Create the foundational Block #0 with Proof-of-Work.",
      done: hasGenesis,
      enabled: true,
      actionLabel: hasGenesis ? "Initialized" : "Init Genesis",
      actionId: "step-btn-init",
    },
    {
      num: 2,
      title: "Create 2+ Wallets",
      desc: "Generate secp256k1 keypairs (e.g. Alice & Bob).",
      done: hasWallets,
      enabled: true,
      actionLabel: hasWallets ? "Add More" : "Add Wallet",
      actionId: "step-btn-wallet",
    },
    {
      num: 3,
      title: "Mine Block #1 (Mint Coins)",
      desc: "Run PoW to mint the first coinbase reward into a wallet.",
      done: hasMinedBlock,
      enabled: hasGenesis && m2State.wallets.length >= 1,
      actionLabel: "Go to Mining",
      actionId: "step-btn-mine-1",
    },
    {
      num: 4,
      title: "Sign & Broadcast Transaction",
      desc: "Send coins from a funded wallet into the Mempool.",
      done: hasTxCreated,
      enabled: hasMinedBlock && m2State.wallets.length >= 1,
      actionLabel: "Create Tx",
      actionId: "step-btn-tx",
    },
    {
      num: 5,
      title: "Mine Block with Transaction",
      desc: "Confirm Mempool transactions into a new Merkle-sealed block.",
      done: hasTxInBlock,
      enabled: hasMinedBlock && m2State.mempool.length > 0,
      actionLabel: "Mine Tx Block",
      actionId: "step-btn-mine-2",
    },
    {
      num: 6,
      title: "Inspect Merkle Tree & Tamper Lab",
      desc: "Explore SHA-256 Merkle proofs or test chain tampering.",
      done: hasTamperTested,
      enabled: hasTxInBlock,
      actionLabel: "Tamper Lab",
      actionId: "step-btn-tamper",
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;
  badgeEl.className = `vault-badge ${completedCount === steps.length ? "valid" : "muted"}`;
  badgeEl.textContent = `${completedCount}/${steps.length} Completed`;

  const currentIdx = steps.findIndex((s) => !s.done);

  listEl.innerHTML = steps
    .map((step, idx) => {
      const isCurrent = idx === currentIdx;
      const borderClass = step.done
        ? "border-emerald-500/30 bg-emerald-500/5"
        : isCurrent
          ? "border-zinc-500 bg-zinc-900/90"
          : "border-zinc-800 bg-zinc-950/60";
      const numBadgeClass = step.done
        ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
        : isCurrent
          ? "bg-zinc-100 text-zinc-950 border-zinc-100"
          : "bg-zinc-900 text-zinc-500 border-zinc-800";

      return `
        <div class="rounded-lg border ${borderClass} p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div class="flex items-start gap-2.5 min-w-0">
            <span class="w-6 h-6 rounded-full border ${numBadgeClass} flex items-center justify-center text-[11px] font-mono font-bold shrink-0 mt-0.5">
              ${step.done ? "✓" : step.num}
            </span>
            <div class="min-w-0">
              <div class="text-xs font-semibold ${step.done ? "text-emerald-300" : "text-zinc-100"}">${escapeHtml(step.title)}</div>
              <div class="text-[11px] text-zinc-400">${escapeHtml(step.desc)}</div>
            </div>
          </div>
          <button
            type="button"
            id="${step.actionId}"
            class="btn-outline text-[11px] px-3 min-h-[30px] shrink-0 ${!step.enabled || (step.num === 1 && step.done) ? "opacity-50 cursor-not-allowed" : ""}"
            ${!step.enabled || (step.num === 1 && step.done) ? "disabled" : ""}
          >
            ${escapeHtml(step.actionLabel)}
          </button>
        </div>
      `;
    })
    .join("");

  document.getElementById("step-btn-init")?.addEventListener("click", () => handleInitGenesis());
  document.getElementById("step-btn-wallet")?.addEventListener("click", () => {
    document.getElementById("add-wallet-error")?.classList.add("hidden");
    document.getElementById("input-wallet-name").value = "";
    document.getElementById("modal-add-wallet")?.showModal();
  });
  document.getElementById("step-btn-mine-1")?.addEventListener("click", () => {
    const firstWallet = m2State.wallets[0];
    if (firstWallet) selectRole(firstWallet.id);
  });
  document.getElementById("step-btn-tx")?.addEventListener("click", () => {
    const firstWallet = m2State.wallets[0];
    if (firstWallet) selectRole(firstWallet.id);
  });
  document.getElementById("step-btn-mine-2")?.addEventListener("click", () => {
    const firstWallet = m2State.wallets[0];
    if (firstWallet) selectRole(firstWallet.id);
  });
  document.getElementById("step-btn-tamper")?.addEventListener("click", () => selectRole("attacker"));
}

async function handleInitGenesis() {
  try {
    const res = await apiRequest("/api/m2/init", "POST", {
      difficulty: m2State.config.difficulty,
      blockReward: m2State.config.blockReward,
    });
    m2State = res.state;
    selectedBlockIndex = 0;
    renderAll();
    showToast(`Genesis Block #0 mined (${res.genesis.hash.slice(0, 10)}...)`, "success");
  } catch (err) {
    showToast(err.message, "error");
  }
}

function renderHeaderAndStats() {
  const { config, chain, mempool, validation, totalSupply } = m2State;

  const headerPill = document.getElementById("header-chain-status");
  const chainSummary = document.getElementById("chain-validation-summary");
  if (chain.length === 0) {
    headerPill.className = "vault-badge muted shrink-0";
    headerPill.innerHTML = `<i data-lucide="circle-dashed" class="w-3 h-3"></i><span>Not Initialized</span>`;
    chainSummary.className = "text-[11px] font-mono text-zinc-400 hidden";
    chainSummary.textContent = "";
  } else if (validation.isValid) {
    headerPill.className = "vault-badge valid shrink-0";
    headerPill.innerHTML = `<i data-lucide="shield-check" class="w-3 h-3"></i><span>Chain Valid</span>`;
    chainSummary.className = "text-[11px] font-mono text-zinc-400 break-words";
    chainSummary.textContent = `All ${chain.length} block(s) cryptographically sealed`;
  } else {
    headerPill.className = "vault-badge invalid shrink-0";
    headerPill.innerHTML = `<i data-lucide="shield-alert" class="w-3 h-3"></i><span>Compromised #${escapeHtml(validation.errorBlockIndex)}</span>`;
    chainSummary.className = "text-[11px] font-mono text-rose-400 break-words";
    chainSummary.textContent = validation.reason || "Chain integrity check failed";
  }

  document.getElementById("stat-height").textContent = `${chain.length} Block${chain.length === 1 ? "" : "s"}`;
  document.getElementById("stat-difficulty").textContent = `${config.difficulty} ("${config.targetPrefix}...")`;
  document.getElementById("stat-reward").textContent = `${config.blockReward} Coins`;
  document.getElementById("stat-mempool").textContent = `${mempool.length} Pending`;
  document.getElementById("stat-supply").textContent = `${totalSupply} Coins`;
  const tabMempoolCount = document.getElementById("tab-mempool-count");
  if (tabMempoolCount) tabMempoolCount.textContent = String(mempool.length);
  const smCount = document.getElementById("tab-mempool-count-sm");
  if (smCount) smCount.textContent = String(mempool.length);
}

function renderWallets() {
  const grid = document.getElementById("wallets-grid");
  if (!grid) return;

  if (m2State.wallets.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full rounded-lg border border-dashed border-zinc-800 p-6 text-center space-y-3">
        <p class="text-xs text-zinc-400">No wallets created yet. Create at least 2 wallets (e.g., Alice &amp; Bob) to mine rewards and send transactions.</p>
        <button type="button" id="btn-empty-add-wallet" class="btn-outline text-xs px-3 min-h-[32px]">
          <i data-lucide="user-plus" class="w-3.5 h-3.5"></i>
          <span>Create First Wallet</span>
        </button>
      </div>
    `;
    document.getElementById("btn-empty-add-wallet")?.addEventListener("click", () => {
      document.getElementById("add-wallet-error")?.classList.add("hidden");
      document.getElementById("modal-add-wallet")?.showModal();
    });
    return;
  }

  const canMine = m2State.chain.length > 0;
  grid.innerHTML = m2State.wallets
    .map((w) => {
      return `
        <div class="rounded-lg border border-zinc-800 bg-zinc-950 p-3.5 space-y-2.5">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="text-xs font-semibold text-zinc-100 truncate">${escapeHtml(w.name)}</div>
              <div class="text-[11px] font-mono text-zinc-400 break-all" title="${escapeHtml(w.address)}">${escapeHtml(w.address)}</div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <button type="button" class="btn-outline text-[11px] px-2 min-h-[28px] btn-open-wallet-role" data-role-id="${escapeHtml(w.id)}" title="Switch to ${escapeHtml(w.name)} role">
                <span>Open Role</span>
              </button>
              <button type="button" class="btn-outline text-[11px] px-2 min-h-[28px] btn-quick-mine ${canMine ? "" : "opacity-50 cursor-not-allowed"}" data-miner-id="${escapeHtml(w.id)}" ${canMine ? "" : "disabled"} title="${canMine ? `Mine next block &amp; credit reward to ${escapeHtml(w.name)}` : "Initialize Genesis Block (#0) first"}">
                <i data-lucide="pickaxe" class="w-3 h-3"></i>
                <span>+${escapeHtml(m2State.config.blockReward)}</span>
              </button>
            </div>
          </div>
          <div class="grid grid-cols-3 gap-2 pt-1 border-t border-zinc-800/80 text-[11px] font-mono">
            <div>
              <div class="text-[10px] text-zinc-500">Confirmed</div>
              <div class="text-zinc-100 font-semibold">${escapeHtml(w.confirmedBalance)}</div>
            </div>
            <div>
              <div class="text-[10px] text-zinc-500">Pending</div>
              <div class="text-zinc-300 font-semibold">${escapeHtml(w.pendingBalance)}</div>
            </div>
            <div>
              <div class="text-[10px] text-zinc-500">Next Nonce</div>
              <div class="text-zinc-300 font-semibold">${escapeHtml(w.nextNonce)}</div>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  grid.querySelectorAll(".btn-quick-mine").forEach((btn) => {
    btn.addEventListener("click", () => {
      const minerId = btn.getAttribute("data-miner-id");
      handleMineBlock(minerId);
    });
  });
  grid.querySelectorAll(".btn-open-wallet-role").forEach((btn) => {
    btn.addEventListener("click", () => {
      const roleId = btn.getAttribute("data-role-id");
      if (roleId) selectRole(roleId);
    });
  });
}

function highlightPowHash(hash, difficulty) {
  const prefix = "0".repeat(difficulty);
  if (hash.startsWith(prefix)) {
    return `<span class="text-emerald-400 font-bold">${escapeHtml(hash.slice(0, difficulty))}</span>${escapeHtml(shortHex(hash.slice(difficulty), 8, 6))}`;
  }
  return `<span class="text-rose-400">${escapeHtml(shortHex(hash, 10, 6))}</span>`;
}

function updateChainNavControls() {
  const prevBtn = document.getElementById("btn-chain-prev");
  const nextBtn = document.getElementById("btn-chain-next");
  const total = m2State.chain.length;

  if (prevBtn) {
    prevBtn.disabled = total === 0 || selectedBlockIndex <= 0;
  }
  if (nextBtn) {
    nextBtn.disabled = total === 0 || selectedBlockIndex >= total - 1;
  }
}

function scrollSelectedBlockIntoView() {
  const strip = document.getElementById("chain-strip");
  const activeNode = strip?.querySelector(`.block-node[data-block-index="${selectedBlockIndex}"]`);
  if (activeNode) {
    activeNode.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
  }
}

function renderChainStrip() {
  const strip = document.getElementById("chain-strip");
  if (!strip) return;

  if (m2State.chain.length === 0) {
    updateChainNavControls();
    strip.innerHTML = `
      <div class="w-full rounded-lg border border-dashed border-zinc-800 p-6 text-center space-y-3">
        <p class="text-xs text-zinc-400">The blockchain ledger is currently empty (0 blocks).</p>
        <button type="button" id="btn-empty-init-genesis" class="btn-outline text-xs px-3 min-h-[32px]">
          <i data-lucide="sparkles" class="w-3.5 h-3.5"></i>
          <span>Initialize Genesis Block (#0)</span>
        </button>
      </div>
    `;
    document.getElementById("btn-empty-init-genesis")?.addEventListener("click", () => handleInitGenesis());
    return;
  }

  if (selectedBlockIndex < 0 || selectedBlockIndex >= m2State.chain.length) {
    selectedBlockIndex = m2State.chain.length - 1;
  }
  updateChainNavControls();

  const html = [];
  m2State.chain.forEach((block, idx) => {
    const isSelected = idx === selectedBlockIndex;
    const isBroken = !block.diagnostics.isValid;
    const nodeClass = `block-node ${isSelected ? "selected" : ""} ${isBroken ? "compromised" : ""}`;

    if (idx > 0) {
      const pointerValid = block.diagnostics.checks.hashPointer.passed;
      html.push(`
        <div class="chain-link-arrow ${pointerValid ? "" : "broken"}" title="${pointerValid ? "Hash pointer matches previous block" : "BROKEN hash pointer!"}">
          <i data-lucide="${pointerValid ? "arrow-right" : "unlink"}" class="w-4 h-4"></i>
          <span class="text-[9px] font-mono uppercase mt-0.5">${pointerValid ? "linked" : "broken"}</span>
        </div>
      `);
    }

    html.push(`
      <button type="button" class="${nodeClass}" data-block-index="${block.index}">
        <div class="flex items-center justify-between gap-2 mb-2">
          <span class="text-xs font-bold font-mono text-zinc-100">
            ${block.index === 0 ? "Block #0 (Genesis)" : `Block #${block.index}`}
          </span>
          <span class="vault-badge ${isBroken ? "invalid" : "valid"}">
            ${isBroken ? "Invalid" : "Sealed"}
          </span>
        </div>
        <div class="space-y-1 text-[11px] font-mono">
          <div class="flex justify-between gap-2">
            <span class="text-zinc-500">Prev:</span>
            <span class="text-zinc-300 truncate">${escapeHtml(shortHex(block.previousHash, 6, 4))}</span>
          </div>
          <div class="flex justify-between gap-2">
            <span class="text-zinc-500">Merkle:</span>
            <span class="text-zinc-300 truncate">${escapeHtml(shortHex(block.merkleRoot, 6, 4))}</span>
          </div>
          <div class="flex justify-between gap-2">
            <span class="text-zinc-500">Nonce:</span>
            <span class="text-zinc-200">${escapeHtml(block.nonce)}</span>
          </div>
          <div class="flex justify-between gap-2">
            <span class="text-zinc-500">Txs:</span>
            <span class="text-zinc-200">${block.transactions.length}</span>
          </div>
          <div class="pt-1.5 mt-1.5 border-t border-zinc-800/80 flex justify-between gap-2">
            <span class="text-zinc-500">Hash:</span>
            <span class="truncate">${highlightPowHash(block.hash, block.difficulty)}</span>
          </div>
        </div>
      </button>
    `);
  });

  strip.innerHTML = html.join("");
  strip.querySelectorAll(".block-node").forEach((el) => {
    el.addEventListener("click", () => {
      selectedBlockIndex = Number(el.getAttribute("data-block-index"));
      if (getEffectiveRole() !== "node") {
        selectRole("node");
      } else {
        renderChainStrip();
        renderInspector();
        scrollSelectedBlockIntoView();
        if (window.lucide) window.lucide.createIcons();
      }
    });
  });
}

function renderTxFormAndMempool() {
  const fromSelect = document.getElementById("tx-from");
  const toSelect = document.getElementById("tx-to");
  if (!fromSelect || !toSelect) return;

  const submitBtn = document.getElementById("btn-submit-tx");
  const hasWallets = m2State.wallets.length > 0;
  const canSubmitTx = m2State.chain.length > 0 && hasWallets;

  if (!hasWallets) {
    fromSelect.innerHTML = `<option value="">Create wallets first</option>`;
    toSelect.innerHTML = `<option value="">Create wallets first</option>`;
    const hintEl = document.getElementById("tx-sender-hint");
    if (hintEl) hintEl.textContent = "Create at least 2 wallets first (Step 2).";
    lastSenderId = null;
  } else {
    const role = getEffectiveRole();
    const roleIsWallet = m2State.wallets.some((w) => w.id === role);
    const prevFrom = roleIsWallet ? role : (fromSelect.value || m2State.wallets[0]?.id || "");
    const otherWallet = m2State.wallets.find((w) => w.id !== prevFrom);
    const prevTo = toSelect.value || otherWallet?.address || m2State.wallets[0]?.address || "";

    fromSelect.innerHTML = m2State.wallets
      .map(
        (w) =>
          `<option value="${escapeHtml(w.id)}">${escapeHtml(w.name)} (${escapeHtml(w.pendingBalance)} avail)</option>`
      )
      .join("");
    if (m2State.wallets.some((w) => w.id === prevFrom)) {
      fromSelect.value = prevFrom;
    }
    fromSelect.disabled = roleIsWallet;

    toSelect.innerHTML = m2State.wallets
      .map(
        (w) =>
          `<option value="${escapeHtml(w.address)}">${escapeHtml(w.name)} (${escapeHtml(shortHex(w.address, 6, 4))})</option>`
      )
      .join("");
    if (m2State.wallets.some((w) => w.address === prevTo && w.id !== fromSelect.value)) {
      toSelect.value = prevTo;
    } else if (otherWallet) {
      toSelect.value = otherWallet.address;
    }

    syncSenderHintAndNonce(fromSelect.value !== lastSenderId);
    lastSenderId = fromSelect.value;
  }

  if (submitBtn) {
    submitBtn.disabled = !canSubmitTx;
    submitBtn.classList.toggle("opacity-50", !canSubmitTx);
    submitBtn.classList.toggle("cursor-not-allowed", !canSubmitTx);
  }

  // Render Mempool
  const mempoolList = document.getElementById("mempool-list");
  const totalFees = m2State.mempool.reduce((s, tx) => s + tx.data.fee, 0);
  document.getElementById("mempool-fees-pill").textContent = `Fees: ${totalFees}`;

  if (m2State.mempool.length === 0) {
    mempoolList.innerHTML = `
      <div class="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-400">
        Mempool is empty. Sign and broadcast a transaction above, or mine an empty block to mint a coinbase reward.
      </div>
    `;
    return;
  }

  mempoolList.innerHTML = m2State.mempool
    .map(
      (tx, idx) => `
      <div class="rounded-lg border border-zinc-800 bg-zinc-950 p-3 space-y-2 text-xs font-mono">
        <div class="flex items-center justify-between gap-2">
          <span class="text-zinc-200 font-semibold">Pending Tx #${idx + 1} &middot; Nonce ${escapeHtml(tx.data.nonce)}</span>
          <span class="vault-badge muted">Fee: ${escapeHtml(tx.data.fee)}</span>
        </div>
        <div class="text-[11px] text-zinc-400 space-y-0.5">
          <div>From: <span class="text-zinc-200">${escapeHtml(walletNameForAddress(tx.data.from))}</span></div>
          <div>To: <span class="text-zinc-200">${escapeHtml(walletNameForAddress(tx.data.to))}</span></div>
          <div>Amount: <span class="text-zinc-100 font-semibold">${escapeHtml(tx.data.amount)} Coins</span></div>
          <div class="truncate">Tx ID: <span class="text-zinc-500">${escapeHtml(tx.id)}</span></div>
        </div>
      </div>
    `
    )
    .join("");
}

function syncSenderHintAndNonce(forceNonce = false) {
  const fromId = document.getElementById("tx-from")?.value;
  const sender = m2State.wallets.find((w) => w.id === fromId);
  const hintEl = document.getElementById("tx-sender-hint");
  const nonceInput = document.getElementById("tx-nonce");
  if (!sender || !hintEl || !nonceInput) return;

  hintEl.textContent = `Available: ${sender.pendingBalance} Coins · Next Nonce: ${sender.nextNonce}`;
  if (forceNonce) {
    nonceInput.value = String(sender.nextNonce);
  }
  updateTxTotalPreview();
}

function updateTxTotalPreview() {
  const amount = Number(document.getElementById("tx-amount")?.value || 0);
  const fee = Number(document.getElementById("tx-fee")?.value || 0);
  const preview = document.getElementById("tx-total-preview");
  if (preview) {
    const total = (Number.isFinite(amount) ? amount : 0) + (Number.isFinite(fee) ? fee : 0);
    preview.textContent = `${total} Coins`;
  }
}

function renderMiningPanel() {
  const diffSelect = document.getElementById("cfg-difficulty");
  const rewardInput = document.getElementById("cfg-reward");
  if (diffSelect) diffSelect.value = String(m2State.config.difficulty);
  if (rewardInput && document.activeElement !== rewardInput) {
    rewardInput.value = String(m2State.config.blockReward);
  }

  const minerSelect = document.getElementById("mine-miner-select");
  if (minerSelect) {
    if (m2State.wallets.length === 0) {
      minerSelect.innerHTML = `<option value="">Create a wallet first</option>`;
    } else {
      const role = getEffectiveRole();
      const roleIsWallet = m2State.wallets.some((w) => w.id === role);
      const prevMiner = roleIsWallet ? role : minerSelect.value;
      minerSelect.innerHTML = m2State.wallets
        .map((w) => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.name)} (${escapeHtml(w.confirmedBalance)} Coins)</option>`)
        .join("");
      if (m2State.wallets.some((w) => w.id === prevMiner)) {
        minerSelect.value = prevMiner;
      } else {
        const defaultMiner = m2State.wallets.find((w) => w.name.toLowerCase().includes("miner")) || m2State.wallets[0];
        if (defaultMiner) minerSelect.value = defaultMiner.id;
      }
      minerSelect.disabled = roleIsWallet;
    }
  }

  const mineBtn = document.getElementById("btn-mine-block");
  const canMine = m2State.chain.length > 0 && m2State.wallets.length > 0;
  if (mineBtn) {
    mineBtn.disabled = !canMine;
    mineBtn.classList.toggle("opacity-50", !canMine);
    mineBtn.classList.toggle("cursor-not-allowed", !canMine);
  }

  const totalFees = m2State.mempool.reduce((s, tx) => s + tx.data.fee, 0);
  document.getElementById("mine-next-index").textContent = `#${m2State.chain.length}`;
  document.getElementById("mine-mempool-count").textContent = `${m2State.mempool.length} (+1 Coinbase)`;
  document.getElementById("mine-payout-preview").textContent =
    `${m2State.config.blockReward} + ${totalFees} = ${m2State.config.blockReward + totalFees} Coins`;

  const box = document.getElementById("mining-telemetry-box");
  const t = m2State.lastMiningResult;
  if (m2State.chain.length === 0 || m2State.wallets.length === 0) {
    box.innerHTML = `<p class="text-zinc-400">Initialize Genesis Block (#0) and create at least one wallet before mining Block #1.</p>`;
    return;
  }
  if (!t) {
    box.innerHTML = `<p class="text-zinc-400">No user blocks mined yet. Click <strong>Mine Next Block</strong> to run Proof-of-Work and mint the first block reward.</p>`;
    return;
  }

  box.innerHTML = `
    <div class="flex items-center justify-between">
      <span class="text-zinc-100 font-semibold">Block #${escapeHtml(t.blockIndex)} Mined</span>
      <span class="text-zinc-400">${escapeHtml(t.durationMs)} ms</span>
    </div>
    <div class="grid grid-cols-2 gap-2 pt-2 border-t border-zinc-800/80 text-[11px]">
      <div><span class="text-zinc-500">Miner:</span> <span class="text-zinc-200">${escapeHtml(t.minerName)}</span></div>
      <div><span class="text-zinc-500">Nonce Found:</span> <span class="text-zinc-100 font-semibold">${escapeHtml(t.nonce)}</span></div>
      <div><span class="text-zinc-500">Attempts:</span> <span class="text-zinc-200">${escapeHtml(t.attempts.toLocaleString())}</span></div>
      <div><span class="text-zinc-500">Hash Rate:</span> <span class="text-zinc-200">${escapeHtml(t.hashesPerSecond.toLocaleString())} H/s</span></div>
      <div class="col-span-2"><span class="text-zinc-500">Coinbase Payout:</span> <span class="text-zinc-100">${escapeHtml(t.blockReward)} base + ${escapeHtml(t.totalGasFees)} gas = ${escapeHtml(t.blockReward + t.totalGasFees)} Coins</span></div>
      <div class="col-span-2 break-all"><span class="text-zinc-500">Hash:</span> <span class="text-zinc-200">${escapeHtml(t.hash)}</span></div>
    </div>
  `;
}

function renderInspector() {
  const select = document.getElementById("inspector-block-select");
  if (!select) return;
  if (m2State.chain.length === 0) {
    select.innerHTML = `<option value="">No blocks yet</option>`;
    document.getElementById("inspector-header-grid").innerHTML = `
      <div class="rounded-lg border border-dashed border-zinc-800 p-4 text-xs text-zinc-400">
        No blocks to inspect yet. Initialize Genesis Block (#0) in Step 1.
      </div>
    `;
    document.getElementById("inspector-txs-list").innerHTML = "";
    document.getElementById("inspector-merkle-tree").innerHTML = "";
    return;
  }

  if (selectedBlockIndex < 0 || selectedBlockIndex >= m2State.chain.length) {
    selectedBlockIndex = m2State.chain.length - 1;
  }

  select.innerHTML = m2State.chain
    .map((b) => `<option value="${b.index}">${b.index === 0 ? "Block #0 (Genesis)" : `Block #${b.index}`}</option>`)
    .join("");
  select.value = String(selectedBlockIndex);

  const block = m2State.chain[selectedBlockIndex] || m2State.chain[0];
  const diag = block.diagnostics;

  const headerGrid = document.getElementById("inspector-header-grid");
  headerGrid.innerHTML = `
    <div class="rounded-lg border border-zinc-800 bg-zinc-950 p-3 space-y-1.5">
      <div class="text-[10px] uppercase text-zinc-500">Block Index &amp; Timestamp</div>
      <div class="text-zinc-200">#${escapeHtml(block.index)} &middot; ${escapeHtml(new Date(block.timestamp).toLocaleString())}</div>
      <div class="text-[10px] uppercase text-zinc-500 pt-1">Previous Block Hash</div>
      <div class="break-all ${diag.checks.hashPointer.passed ? "text-zinc-300" : "text-rose-400"}">${escapeHtml(block.previousHash)}</div>
    </div>
    <div class="rounded-lg border border-zinc-800 bg-zinc-950 p-3 space-y-1.5">
      <div class="text-[10px] uppercase text-zinc-500">Nonce &amp; Difficulty</div>
      <div class="text-zinc-200">Nonce: ${escapeHtml(block.nonce)} &middot; Difficulty: ${escapeHtml(block.difficulty)} ("${"0".repeat(block.difficulty)}...")</div>
      <div class="text-[10px] uppercase text-zinc-500 pt-1">Block Hash (SHA-256)</div>
      <div class="break-all ${diag.checks.blockHash.passed && diag.checks.powTarget.passed ? "text-zinc-100" : "text-rose-400"}">${escapeHtml(block.hash)}</div>
    </div>
  `;

  const txsList = document.getElementById("inspector-txs-list");
  txsList.innerHTML = block.transactions
    .map((tx, txIndex) => {
      const isCoinbase = tx.data.from === "0x0000000000000000000000000000000000000000";
      const txDiag = diag.txValidations[txIndex];
      const valid = txDiag ? txDiag.isValid : true;
      return `
        <div class="rounded-lg border ${valid ? "border-zinc-800" : "border-rose-500/60 bg-rose-500/5"} bg-zinc-950 p-3 text-xs font-mono space-y-1">
          <div class="flex items-center justify-between gap-2">
            <span class="font-semibold text-zinc-200">
              ${isCoinbase ? `[#${txIndex}] COINBASE MINT` : `[#${txIndex}] Signed Tx (Nonce ${escapeHtml(tx.data.nonce)})`}
            </span>
            <span class="vault-badge ${valid ? "valid" : "invalid"}">${valid ? "Valid" : "Invalid"}</span>
          </div>
          <div class="text-[11px] text-zinc-400">From: <span class="text-zinc-200">${escapeHtml(walletNameForAddress(tx.data.from))}</span></div>
          <div class="text-[11px] text-zinc-400">To: <span class="text-zinc-200">${escapeHtml(walletNameForAddress(tx.data.to))}</span></div>
          <div class="text-[11px] text-zinc-400">
            Amount: <span class="text-zinc-100 font-semibold">${escapeHtml(tx.data.amount)}</span>
            ${isCoinbase ? "" : ` &middot; Gas Fee: <span class="text-zinc-300">${escapeHtml(tx.data.fee)}</span>`}
          </div>
          <div class="text-[10px] text-zinc-500 break-all" title="${escapeHtml(tx.id)}">Tx ID: ${escapeHtml(tx.id)}</div>
          ${!valid && txDiag?.reason ? `<div class="text-[11px] text-rose-400 pt-1">Reason: ${escapeHtml(txDiag.reason)}</div>` : ""}
        </div>
      `;
    })
    .join("");

  // Merkle Tree Levels (Root at top, Leaves at bottom)
  const treeEl = document.getElementById("inspector-merkle-tree");
  const levels = block.merkleLevels || [];
  const merkleValid = diag.checks.merkleRoot.passed;
  const topDown = [...levels].reverse();

  treeEl.innerHTML = topDown
    .map((hashes, revIdx) => {
      const originalLevel = levels.length - 1 - revIdx;
      const isRoot = originalLevel === levels.length - 1;
      const isLeaf = originalLevel === 0;
      const label = isRoot
        ? `Level ${originalLevel} (Merkle Root)`
        : isLeaf
          ? `Level 0 (Leaf Transaction Hashes)`
          : `Level ${originalLevel} (Internal Pair Hashes)`;

      return `
        <div class="merkle-level">
          <div class="text-[10px] font-mono uppercase tracking-wider text-zinc-400">${escapeHtml(label)}</div>
          <div class="merkle-level-nodes">
            ${hashes
              .map((h, nodeIdx) => {
                const nodeClass = isRoot
                  ? `merkle-node ${merkleValid ? "root" : "compromised"}`
                  : "merkle-node";
                return `
                  <div class="${nodeClass}" title="${escapeHtml(h)}">
                    <div class="text-[10px] text-zinc-500">${isRoot ? "Root" : isLeaf ? `Tx #${nodeIdx}` : `Node #${nodeIdx}`}</div>
                    <div class="text-zinc-200 break-all">${escapeHtml(h)}</div>
                  </div>
                `;
              })
              .join("")}
          </div>
        </div>
      `;
    })
    .join("");
}

function renderTamperLab() {
  const blockSelect = document.getElementById("tamper-block");
  const txSelect = document.getElementById("tamper-tx");
  const nonGenesis = m2State.chain.filter((b) => b.index > 0);

  if (nonGenesis.length === 0) {
    blockSelect.innerHTML = `<option value="">Mine Block #1 first</option>`;
    txSelect.innerHTML = `<option value="">-</option>`;
  } else {
    const prevBlockVal = blockSelect.value;
    blockSelect.innerHTML = nonGenesis
      .map((b) => `<option value="${b.index}">Block #${b.index} (${b.transactions.length} txs)</option>`)
      .join("");
    if (nonGenesis.some((b) => String(b.index) === prevBlockVal)) {
      blockSelect.value = prevBlockVal;
    }
    populateTamperTxOptions();
  }

  const auditBadge = document.getElementById("tamper-audit-badge");
  const list = document.getElementById("tamper-diagnostics-list");
  if (m2State.chain.length === 0) {
    auditBadge.className = "vault-badge muted";
    auditBadge.textContent = "NOT INITIALIZED";
    list.innerHTML = `<div class="rounded-lg border border-dashed border-zinc-800 p-4 text-xs text-zinc-400">No blocks yet. Initialize Genesis Block (#0) and mine at least one block first.</div>`;
    return;
  }
  if (m2State.validation.isValid) {
    auditBadge.className = "vault-badge valid";
    auditBadge.textContent = "VALID";
  } else {
    auditBadge.className = "vault-badge invalid";
    auditBadge.textContent = `FAILED AT BLOCK #${m2State.validation.errorBlockIndex}`;
  }

  list.innerHTML = m2State.chain
    .map((block) => {
      const d = block.diagnostics;
      const items = [
        ["Hash Pointer", d.checks.hashPointer],
        ["Merkle Root", d.checks.merkleRoot],
        ["Block Hash", d.checks.blockHash],
        ["PoW Target", d.checks.powTarget],
        ["Tx Signatures", d.checks.txSignatures],
      ];

      return `
        <div class="rounded-lg border ${d.isValid ? "border-zinc-800" : "border-rose-500/60 bg-rose-500/5"} bg-zinc-950 p-3 space-y-2 text-xs font-mono">
          <div class="flex items-center justify-between">
            <span class="font-semibold text-zinc-100">${block.index === 0 ? "Block #0 (Genesis)" : `Block #${block.index}`}</span>
            <span class="vault-badge ${d.isValid ? "valid" : "invalid"}">${d.isValid ? "Passed" : "Failed"}</span>
          </div>
          <div class="space-y-1.5 text-[11px]">
            ${items
              .map(
                ([label, check]) => `
                <div class="flex flex-col sm:flex-row sm:items-start gap-0.5 sm:gap-2 ${check.passed ? "text-zinc-400" : "text-rose-400"}">
                  <div class="flex items-center gap-1.5 shrink-0 sm:w-32 font-semibold">
                    <span>${check.passed ? "✓" : "✗"}</span>
                    <span>${escapeHtml(label)}:</span>
                  </div>
                  <span class="break-all pl-4 sm:pl-0">${escapeHtml(check.detail)}</span>
                </div>
              `
              )
              .join("")}
          </div>
        </div>
      `;
    })
    .join("");
}

function populateTamperTxOptions() {
  const blockIdx = Number(document.getElementById("tamper-block").value);
  const txSelect = document.getElementById("tamper-tx");
  const block = m2State.chain.find((b) => b.index === blockIdx);
  if (!block) {
    txSelect.innerHTML = `<option value="">-</option>`;
    return;
  }

  const prevTxVal = txSelect.value;
  txSelect.innerHTML = block.transactions
    .map((tx, idx) => {
      const label =
        tx.data.from === "0x0000000000000000000000000000000000000000"
          ? `#${idx} Coinbase (${tx.data.amount} Coins)`
          : `#${idx} ${walletNameForAddress(tx.data.from)} → ${tx.data.amount} Coins`;
      return `<option value="${idx}">${escapeHtml(label)}</option>`;
    })
    .join("");

  if (prevTxVal !== "" && block.transactions[Number(prevTxVal)]) {
    txSelect.value = prevTxVal;
  } else if (block.transactions.length > 1) {
    txSelect.value = "1";
  }
}

// ============================================================================
// ACTIONS & EVENT HANDLERS
// ============================================================================
function switchTab(tabId) {
  activeTab = tabId;
  document.querySelectorAll(".subtab-btn[data-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === tabId);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    const match = panel.id === `panel-${tabId}`;
    panel.style.display = match ? "" : "none";
  });
}

async function handleMineBlock(explicitMinerId = null) {
  const minerId = explicitMinerId || document.getElementById("mine-miner-select")?.value;
  const errEl = document.getElementById("mining-error");
  const mineBtn = document.getElementById("btn-mine-block");
  if (errEl) {
    errEl.classList.add("hidden");
    errEl.textContent = "";
  }
  if (mineBtn) mineBtn.disabled = true;

  try {
    const res = await apiRequest("/api/m2/mine", "POST", { minerId });
    m2State = res.state;
    selectedBlockIndex = m2State.chain.length - 1;
    renderAll();
    showToast(
      `Mined Block #${res.telemetry.blockIndex} in ${res.telemetry.attempts} tries (${res.telemetry.durationMs}ms)!`,
      "success"
    );
  } catch (err) {
    if (errEl) {
      errEl.textContent = err.message;
      errEl.classList.remove("hidden");
    }
    showToast(err.message, "error");
  } finally {
    if (mineBtn) mineBtn.disabled = false;
  }
}

function initEventListeners() {
  // Collapsible sections
  document.querySelectorAll(".section-header").forEach((hdr) => {
    hdr.addEventListener("click", () => {
      hdr.closest(".section-card")?.classList.toggle("collapsed");
    });
  });

  // Tab switching
  document.querySelectorAll(".subtab-btn[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchTab(btn.getAttribute("data-tab"));
    });
  });

  // Logs page navigation & filters
  document.getElementById("btn-open-logs")?.addEventListener("click", () => toggleLogsPage());
  document.getElementById("btn-back-to-lab")?.addEventListener("click", () => toggleLogsPage(false));
  document.querySelectorAll(".logs-filter-btn[data-log-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      logFilter = btn.getAttribute("data-log-filter") || "all";
      document.querySelectorAll(".logs-filter-btn[data-log-filter]").forEach((b) => {
        const active = b.getAttribute("data-log-filter") === logFilter;
        b.className = active
          ? "logs-filter-btn w-full py-1.5 rounded-md font-medium text-center bg-zinc-800 text-zinc-100"
          : "logs-filter-btn w-full py-1.5 rounded-md font-medium text-center text-zinc-400 hover:text-zinc-200";
      });
      renderLogsPage();
    });
  });
  document.getElementById("btn-clear-logs")?.addEventListener("click", async () => {
    try {
      const res = await apiRequest("/api/m2/logs", "DELETE");
      m2State = res.state;
      renderLogsPage();
      showToast("Command logs cleared.", "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  // Tx form live hints
  document.getElementById("tx-from")?.addEventListener("change", () => {
    syncSenderHintAndNonce(true);
    lastSenderId = document.getElementById("tx-from").value;
  });
  document.getElementById("tx-amount")?.addEventListener("input", updateTxTotalPreview);
  document.getElementById("tx-fee")?.addEventListener("input", updateTxTotalPreview);

  // Submit Tx
  document.getElementById("form-send-tx")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = document.getElementById("tx-form-error");
    const submitBtn = document.getElementById("btn-submit-tx");
    errEl.classList.add("hidden");
    errEl.textContent = "";
    submitBtn.disabled = true;

    try {
      const payload = {
        fromId: document.getElementById("tx-from").value,
        toAddress: document.getElementById("tx-to").value,
        amount: Number(document.getElementById("tx-amount").value),
        fee: Number(document.getElementById("tx-fee").value),
        nonce: Number(document.getElementById("tx-nonce").value),
      };
      const res = await apiRequest("/api/m2/tx", "POST", payload);
      m2State = res.state;
      renderAll();
      syncSenderHintAndNonce(true);
      showToast("Signed transaction added to Mempool!", "success");
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove("hidden");
      showToast(err.message, "error");
    } finally {
      submitBtn.disabled = false;
    }
  });

  // Apply Consensus Config
  document.getElementById("form-config")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const res = await apiRequest("/api/m2/config", "POST", {
        difficulty: Number(document.getElementById("cfg-difficulty").value),
        blockReward: Number(document.getElementById("cfg-reward").value),
      });
      m2State = res.state;
      renderAll();
      showToast(`Consensus updated: Difficulty ${m2State.config.difficulty}, Reward ${m2State.config.blockReward}`, "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  // Mine block button
  document.getElementById("btn-mine-block")?.addEventListener("click", () => handleMineBlock());

  // Chain Prev / Next controller
  document.getElementById("btn-chain-prev")?.addEventListener("click", () => {
    if (selectedBlockIndex > 0) {
      selectedBlockIndex -= 1;
      renderChainStrip();
      renderInspector();
      scrollSelectedBlockIntoView();
      if (window.lucide) window.lucide.createIcons();
    }
  });
  document.getElementById("btn-chain-next")?.addEventListener("click", () => {
    if (selectedBlockIndex < m2State.chain.length - 1) {
      selectedBlockIndex += 1;
      renderChainStrip();
      renderInspector();
      scrollSelectedBlockIntoView();
      if (window.lucide) window.lucide.createIcons();
    }
  });

  // Inspector block selector
  document.getElementById("inspector-block-select")?.addEventListener("change", (e) => {
    selectedBlockIndex = Number(e.target.value);
    renderChainStrip();
    renderInspector();
    scrollSelectedBlockIntoView();
    if (window.lucide) window.lucide.createIcons();
  });

  // Tamper lab
  document.getElementById("tamper-block")?.addEventListener("change", populateTamperTxOptions);

  document.getElementById("form-tamper")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = document.getElementById("tamper-error");
    errEl.classList.add("hidden");
    try {
      const res = await apiRequest("/api/m2/tamper", "POST", {
        blockIndex: Number(document.getElementById("tamper-block").value),
        txIndex: Number(document.getElementById("tamper-tx").value),
        newAmount: Number(document.getElementById("tamper-amount").value),
      });
      m2State = res.state;
      selectedBlockIndex = Number(document.getElementById("tamper-block").value);
      renderAll();
      showToast("Block data tampered! Integrity check failed immediately.", "error");
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove("hidden");
    }
  });

  document.getElementById("btn-tamper-remine")?.addEventListener("click", async () => {
    const errEl = document.getElementById("tamper-error");
    errEl.classList.add("hidden");
    try {
      const blockIndex = Number(document.getElementById("tamper-block").value);
      const res = await apiRequest("/api/m2/remine", "POST", { blockIndex });
      m2State = res.state;
      selectedBlockIndex = blockIndex;
      renderAll();
      showToast(`Re-mined Block #${blockIndex} in ${res.miningResult.attempts} attempts — check Integrity Audit!`, "info");
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove("hidden");
    }
  });

  // Add Wallet modal (<dialog>) & Role Dropdown
  const addWalletDialog = document.getElementById("modal-add-wallet");
  document.getElementById("role-dropdown-trigger")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleRoleDropdown();
  });
  document.addEventListener("click", (e) => {
    const container = document.getElementById("role-dropdown-container");
    if (container && !container.contains(e.target)) {
      toggleRoleDropdown(false);
    }
  });
  document.getElementById("role-dropdown-items")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".role-option-item");
    if (!btn) return;
    const role = btn.getAttribute("data-role");
    if (role) selectRole(role);
  });
  document.getElementById("role-dropdown-add-wallet")?.addEventListener("click", () => {
    toggleRoleDropdown(false);
    document.getElementById("add-wallet-error").classList.add("hidden");
    document.getElementById("input-wallet-name").value = "";
    addWalletDialog.showModal();
  });
  document.getElementById("btn-wallet-back-node")?.addEventListener("click", () => selectRole("node"));
  document.getElementById("btn-attacker-back-node")?.addEventListener("click", () => selectRole("node"));
  document.getElementById("btn-close-add-wallet")?.addEventListener("click", () => addWalletDialog.close());
  document.getElementById("btn-cancel-add-wallet")?.addEventListener("click", () => addWalletDialog.close());

  document.getElementById("form-add-wallet")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById("input-wallet-name");
    const errEl = document.getElementById("add-wallet-error");
    errEl.classList.add("hidden");

    try {
      const res = await apiRequest("/api/m2/wallets", "POST", { name: nameInput.value.trim() });
      m2State = res.state;
      addWalletDialog.close();
      renderAll();
      showToast(`Wallet "${res.wallet.name}" created!`, "success");
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove("hidden");
    }
  });

  // Reset modal (<dialog>)
  const resetDialog = document.getElementById("modal-confirm-reset");
  document.getElementById("btn-m2-reset")?.addEventListener("click", () => {
    resetDialog.showModal();
  });
  resetDialog?.addEventListener("close", async () => {
    const action = resetDialog.returnValue;
    resetDialog.returnValue = "";
    if (action === "confirm") {
      try {
        const res = await apiRequest("/api/m2/reset", "POST", {});
        m2State = res.state;
        selectedBlockIndex = 0;
        lastSenderId = "";
        renderAll();
        showToast("Blockchain reset to Genesis Block #0.", "success");
      } catch (err) {
        showToast(err.message, "error");
      }
    }
  });
}

// ============================================================================
// BOOTSTRAP
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
  initThemeToggle();
  initDialogFallbacks();
  initEventListeners();
  syncM2State(true);
});
