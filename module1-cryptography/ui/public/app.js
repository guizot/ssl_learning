// ============================================================================
// MODULE 1: CRYPTOGRAPHY & WALLETS - ROLE-BASED STEP-BY-STEP CONTROLLER
// ============================================================================

let m1State = {
  wallets: [],
  activeRole: "node",
  activeId: "",
  activeDetails: null,
  allTransactions: [],
};

let currentSubtab = "identity";
let currentAdminSubtab = "vault";

function escapeHtml(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderCmdOutput(detailsId, codeId, { commands = [], outputs = [], status = "success", customHtml = null }) {
  const detailsEl = document.getElementById(detailsId);
  const codeEl = document.getElementById(codeId);
  if (!codeEl) return;

  codeEl.setAttribute("data-has-output", "true");

  if (customHtml) {
    codeEl.innerHTML = customHtml;
  } else {
    let html = "";
    if (commands && commands.length > 0) {
      const cmdsFormatted = commands
        .map((c) => {
          const trimmed = String(c || "").trim();
          if (trimmed.startsWith("$") || trimmed.startsWith("[") || trimmed.startsWith("#")) {
            return `<span class="text-zinc-200 font-semibold">${escapeHtml(trimmed)}</span>`;
          }
          return `<span class="text-zinc-200 font-semibold">$ ${escapeHtml(trimmed)}</span>`;
        })
        .join("\n");
      html += cmdsFormatted;
    }

    if (outputs && outputs.length > 0) {
      if (html) html += "\n\n";
      const outText = outputs.join("\n");
      let statusClass = "text-emerald-400";
      if (status === "error" || status === "failed") {
        statusClass = "text-rose-400";
      } else if (status === "warning") {
        statusClass = "text-amber-400";
      }
      html += `<span class="${statusClass}">${escapeHtml(outText)}</span>`;
    }

    codeEl.innerHTML = html;
  }

  if (detailsEl) {
    detailsEl.open = true;
  }
}

// ============================================================================
// STATE SYNC & UI RENDER
// ============================================================================
async function syncM1State() {
  try {
    const res = await fetch("/api/m1/state");
    m1State = await res.json();
    renderUI();
  } catch (err) {
    console.error("Failed to sync Module 1 state:", err);
  }
}

function renderUI() {
  if (
    m1State.activeRole !== "node" &&
    (!m1State.wallets || !m1State.wallets.some((w) => w.id === m1State.activeRole))
  ) {
    m1State.activeRole = "node";
  }

  renderRoleSelector();

  if (m1State.activeRole === "node") {
    const adminEl = document.getElementById("view-admin");
    adminEl.style.display = "flex";
    adminEl.style.flexDirection = "column";
    const clientEl = document.getElementById("view-client");
    if (clientEl) clientEl.style.display = "none";
    document.querySelectorAll(".subtab-panel").forEach((p) => (p.style.display = "none"));
    renderNodeView();
    switchAdminSubtab(currentAdminSubtab);
  } else {
    const adminEl = document.getElementById("view-admin");
    if (adminEl) adminEl.style.display = "none";
    document.querySelectorAll(".admin-subtab-panel").forEach((p) => (p.style.display = "none"));
    const clientEl = document.getElementById("view-client");
    clientEl.style.display = "flex";
    clientEl.style.flexDirection = "column";
    renderWalletClientView();
    switchClientSubtab(currentSubtab);
  }

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// ============================================================================
// ROLE SELECTOR DROPDOWN
// ============================================================================
function renderRoleSelector() {
  const activeLabel = document.getElementById("role-active-label");
  const itemsContainer = document.getElementById("role-dropdown-items");
  const activeDot = document.getElementById("role-active-dot");
  if (!itemsContainer) return;

  const isNode = m1State.activeRole === "node";
  let activeText = "Validator Node (Network)";

  if (activeDot) {
    if (isNode) {
      activeDot.className =
        (m1State.wallets || []).length > 0
          ? "w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0"
          : "w-2 h-2 rounded-full bg-zinc-600 shrink-0";
    } else {
      const curW = (m1State.wallets || []).find((w) => w.id === m1State.activeRole);
      if (curW && curW.addrExists && curW.pubExists && curW.keyExists) {
        activeDot.className = "w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0";
      } else if (curW && (curW.keyExists || curW.pubExists)) {
        activeDot.className = "w-2 h-2 rounded-full bg-amber-500 shrink-0";
      } else {
        activeDot.className = "w-2 h-2 rounded-full bg-zinc-500 shrink-0";
      }
    }
  }

  let itemsHtml = `
    <button type="button" class="role-option-item w-full flex items-center justify-between px-3 py-2.5 sm:px-2.5 sm:py-1.5 rounded-md transition-colors text-left cursor-pointer ${
      isNode
        ? "bg-zinc-800/70 text-zinc-100 font-medium"
        : "text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
    }" data-role="node">
      <div class="flex items-center gap-2.5 min-w-0">
        <div class="w-6 h-6 rounded-md bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-300 shrink-0">
          <i data-lucide="cpu" class="w-3.5 h-3.5"></i>
        </div>
        <div class="min-w-0">
          <div class="text-xs font-medium text-zinc-100 truncate">Validator Node (Network)</div>
          <div class="text-[10px] text-zinc-500 font-mono truncate">Zero-CA Network Overview</div>
        </div>
      </div>
      ${isNode ? `<i data-lucide="check" class="w-3.5 h-3.5 text-emerald-400 shrink-0"></i>` : ""}
    </button>
  `;

  if (m1State.wallets && m1State.wallets.length > 0) {
    itemsHtml += `
      <div class="my-1 border-t border-zinc-800/60"></div>
      <div class="px-2.5 py-1 text-[10px] font-mono uppercase font-bold text-zinc-500">Wallet Clients</div>
    `;

    m1State.wallets.forEach((w) => {
      const isWalletActive = m1State.activeRole === w.id;
      const initial = (w.name || "W").charAt(0).toUpperCase();
      let statusBadge = "";
      let stepTag = "step 0/3";

      if (w.addrExists && w.pubExists && w.keyExists) {
        statusBadge = `<span class="text-[10px] font-mono text-emerald-400">✓ Ready (${w.balance} Coins)</span>`;
        stepTag = "✓ 3/3";
      } else if (w.pubExists && w.keyExists) {
        statusBadge = `<span class="text-[10px] font-mono text-amber-400">Step 2/3 (.pub)</span>`;
        stepTag = "2/3";
      } else if (w.keyExists) {
        statusBadge = `<span class="text-[10px] font-mono text-zinc-400">Step 1/3 (.key)</span>`;
        stepTag = "1/3";
      } else {
        statusBadge = `<span class="text-[10px] font-mono text-zinc-500">Step 0/3 (Empty)</span>`;
        stepTag = "0/3";
      }

      if (isWalletActive) {
        activeText = `${w.name} (${stepTag})`;
      }

      itemsHtml += `
        <button type="button" class="role-option-item w-full flex items-center justify-between px-3 py-2.5 sm:px-2.5 sm:py-1.5 rounded-md transition-colors text-left cursor-pointer ${
          isWalletActive
            ? "bg-zinc-800/70 text-zinc-100 font-medium"
            : "text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
        }" data-role="${escapeHtml(w.id)}">
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="w-6 h-6 rounded-md bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xs font-semibold text-zinc-200 shrink-0">
              ${escapeHtml(initial)}
            </div>
            <div class="min-w-0">
              <div class="text-xs font-medium text-zinc-100 truncate">${escapeHtml(w.name)}</div>
              <div class="text-[10px] font-mono text-zinc-500 truncate">id: ${escapeHtml(w.id)} · ${statusBadge}</div>
            </div>
          </div>
          ${isWalletActive ? `<i data-lucide="check" class="w-3.5 h-3.5 text-emerald-400 shrink-0"></i>` : ""}
        </button>
      `;
    });
  }

  if (activeLabel) activeLabel.textContent = activeText;
  itemsContainer.innerHTML = itemsHtml;
  if (window.lucide) window.lucide.createIcons();
}

const roleTrigger = document.getElementById("role-dropdown-trigger");
const roleMenu = document.getElementById("role-dropdown-menu");
const roleChevron = document.getElementById("role-dropdown-chevron");

function toggleRoleDropdown(show) {
  if (!roleMenu) return;
  const isHidden = roleMenu.classList.contains("hidden");
  const willShow = show !== undefined ? show : isHidden;
  if (willShow) {
    roleMenu.classList.remove("hidden");
    if (roleTrigger) roleTrigger.setAttribute("aria-expanded", "true");
    if (roleChevron) roleChevron.classList.add("rotate-180");
  } else {
    roleMenu.classList.add("hidden");
    if (roleTrigger) roleTrigger.setAttribute("aria-expanded", "false");
    if (roleChevron) roleChevron.classList.remove("rotate-180");
  }
}

roleTrigger?.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleRoleDropdown();
});

document.addEventListener("click", (e) => {
  const container = document.getElementById("role-dropdown-container");
  if (container && !container.contains(e.target)) {
    toggleRoleDropdown(false);
  }
});

document.getElementById("role-dropdown-items")?.addEventListener("click", async (e) => {
  const btn = e.target.closest(".role-option-item");
  if (!btn) return;
  const selectedRole = btn.getAttribute("data-role");
  toggleRoleDropdown(false);

  await fetch("/api/m1/select-role", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: selectedRole }),
  });
  await syncM1State();
});

document.getElementById("role-dropdown-add-wallet")?.addEventListener("click", () => {
  toggleRoleDropdown(false);
  openAddWalletModal();
});

// ============================================================================
// MODAL MANAGERS: CONFIRM DIALOG & ADD WALLET MODAL
// ============================================================================
function showConfirmModal({
  title = "Confirm Action",
  message = "Are you sure you want to proceed?",
  confirmText = "Confirm",
  icon = "trash-2",
  alertOnly = false,
} = {}) {
  return new Promise((resolve) => {
    const modal = document.getElementById("modal-confirm");
    const titleEl = document.getElementById("confirm-title");
    const msgEl = document.getElementById("confirm-message");
    const proceedBtn = document.getElementById("btn-confirm-proceed");
    const proceedText = document.getElementById("confirm-proceed-text");
    const closeBtn = document.getElementById("btn-close-modal-confirm");
    const iconBox = document.getElementById("confirm-icon-box");
    const proceedIconBox = document.getElementById("confirm-proceed-icon-box");

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    if (proceedText) proceedText.textContent = confirmText;

    const iconName = icon === "rotate-ccw" ? "rotate-ccw" : icon === "info" ? "info" : "trash-2";
    if (iconBox) iconBox.innerHTML = `<i data-lucide="${iconName}" class="w-4 h-4 text-zinc-400"></i>`;
    if (proceedIconBox) {
      proceedIconBox.innerHTML = `<i data-lucide="${alertOnly ? "check" : iconName}" class="w-3.5 h-3.5"></i>`;
    }

    if (window.lucide) window.lucide.createIcons();
    modal.style.display = "flex";

    function cleanup(result) {
      modal.style.display = "none";
      proceedBtn.removeEventListener("click", onProceed);
      closeBtn.removeEventListener("click", onCancel);
      resolve(result);
    }
    function onProceed() {
      cleanup(true);
    }
    function onCancel() {
      cleanup(false);
    }

    proceedBtn.addEventListener("click", onProceed);
    closeBtn.addEventListener("click", onCancel);
  });
}

function openAddWalletModal() {
  const modal = document.getElementById("modal-add-wallet");
  const input = document.getElementById("input-wallet-name");
  const errEl = document.getElementById("add-wallet-error");
  if (errEl) errEl.style.display = "none";
  if (input) input.value = "";
  modal.style.display = "flex";
  setTimeout(() => input?.focus(), 50);
}

function closeAddWalletModal() {
  document.getElementById("modal-add-wallet").style.display = "none";
}

document.getElementById("btn-open-add-wallet")?.addEventListener("click", openAddWalletModal);
document.getElementById("btn-close-modal-add-wallet")?.addEventListener("click", closeAddWalletModal);

document.getElementById("btn-submit-add-wallet")?.addEventListener("click", async () => {
  const input = document.getElementById("input-wallet-name");
  const errEl = document.getElementById("add-wallet-error");
  const name = (input?.value || "").trim();
  if (!name) {
    if (errEl) {
      errEl.textContent = "Please enter a wallet name (e.g. Alice, Bob).";
      errEl.style.display = "block";
    }
    return;
  }

  const btn = document.getElementById("btn-submit-add-wallet");
  btn.disabled = true;
  try {
    const res = await fetch("/api/m1/wallets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    closeAddWalletModal();
    if (data.id) {
      // Automatically switch to the newly created wallet so user can start Step 1 immediately!
      await fetch("/api/m1/select-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: data.id }),
      });
      currentSubtab = "identity";
    }
    await syncM1State();
  } catch (err) {
    console.error("Failed to create wallet:", err);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("input-wallet-name")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    document.getElementById("btn-submit-add-wallet")?.click();
  }
});

// ============================================================================
// RESET ALL STATE
// ============================================================================
document.getElementById("btn-m1-reset")?.addEventListener("click", async () => {
  const ok = await showConfirmModal({
    title: "Reset Cryptography Lab",
    message: "Delete all generated wallet keys (.key, .pub, .addr) and clear all transactions back to zero?",
    confirmText: "Reset Everything",
    icon: "rotate-ccw",
  });
  if (!ok) return;
  await fetch("/api/m1/reset", { method: "POST" });
  await syncM1State();
});

// ============================================================================
// VIEW 1: VALIDATOR NODE (NETWORK OVERVIEW)
// ============================================================================
function renderNodeView() {
  const wallets = m1State.wallets || [];
  const txs = m1State.allTransactions || [];

  document.getElementById("admin-wallets-count").textContent = String(wallets.length);
  document.getElementById("admin-ledger-count").textContent = String(txs.length);

  const fbWallets = document.getElementById("fb-node-wallets");
  const fsWallets = document.getElementById("fs-node-wallets");
  const fbTxs = document.getElementById("fb-node-txs");
  const fsTxs = document.getElementById("fs-node-txs");

  if (wallets.length > 0) {
    fbWallets.classList.add("created");
    fsWallets.textContent = `${wallets.length} registered`;
  } else {
    fbWallets.classList.remove("created");
    fsWallets.textContent = "0 registered";
  }

  if (txs.length > 0) {
    fbTxs.classList.add("created");
    fsTxs.textContent = `${txs.length} broadcasted`;
  } else {
    fbTxs.classList.remove("created");
    fsTxs.textContent = "0 broadcasted";
  }

  // Render Wallet Directory Cards
  const wContainer = document.getElementById("admin-wallets-list");
  if (wContainer) {
    if (wallets.length === 0) {
      wContainer.innerHTML = `
        <div class="p-8 text-center space-y-2">
          <div class="w-10 h-10 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-500">
            <i data-lucide="wallet" class="w-5 h-5"></i>
          </div>
          <div class="text-xs text-zinc-300 font-medium">No Wallets Created Yet</div>
          <p class="text-[11px] text-zinc-500 max-w-xs mx-auto">
            Click <strong>'Add Wallet'</strong> above to register your first wallet (e.g. Alice) and build her keys step-by-step.
          </p>
        </div>
      `;
    } else {
      wContainer.innerHTML = wallets
        .map((w) => {
          const initial = (w.name || "W").charAt(0).toUpperCase();

          const step1Badge = w.keyExists
            ? `<span class="vault-badge success"><i data-lucide="key" class="w-3 h-3"></i>1. .key</span>`
            : `<span class="vault-badge muted">1. No .key</span>`;

          const step2Badge = w.pubExists
            ? `<span class="vault-badge success"><i data-lucide="unlock" class="w-3 h-3"></i>2. .pub</span>`
            : `<span class="vault-badge muted">2. No .pub</span>`;

          const step3Badge = w.addrExists
            ? `<span class="vault-badge success"><i data-lucide="hash" class="w-3 h-3"></i>3. .addr</span>`
            : `<span class="vault-badge muted">3. No .addr</span>`;

          let statusDesc = "Step 0/3 · Switch to this wallet role to generate Step 1 (.key)";
          if (w.addrExists && w.pubExists && w.keyExists) {
            statusDesc = `Address: ${w.address} · Balance: ${w.balance} Coins · Nonce: ${w.nonce}`;
          } else if (w.pubExists && w.keyExists) {
            statusDesc = "Step 2/3 complete (.key & .pub ready) · Awaiting Step 3 (SHA3-256 Address derivation)";
          } else if (w.keyExists) {
            statusDesc = "Step 1/3 complete (.key ready) · Awaiting Step 2 (Public Key derivation)";
          }

          return `
            <div class="inbox-item-card" id="wallet-card-${escapeHtml(w.id)}">
              <div class="inbox-item-head">
                <div class="inbox-item-meta">
                  <div class="flex items-center gap-2.5 mr-2">
                    <div class="w-7 h-7 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xs font-semibold text-zinc-200 shrink-0">
                      ${escapeHtml(initial)}
                    </div>
                    <div class="min-w-0">
                      <div class="text-xs font-semibold text-zinc-100 truncate">${escapeHtml(w.name)}</div>
                      <div class="text-[11px] text-zinc-500 font-mono truncate">id: ${escapeHtml(w.id)} · ${w.balance} Coins</div>
                    </div>
                  </div>
                  <div class="flex items-center gap-1.5 flex-wrap">
                    ${step1Badge}
                    ${step2Badge}
                    ${step3Badge}
                    <button class="btn-del-wallet btn-del-client" data-id="${escapeHtml(w.id)}" title="Delete wallet ${escapeHtml(w.name)}">
                      <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                    </button>
                  </div>
                </div>
              </div>

              <div class="text-xs text-zinc-400 font-mono flex items-center gap-1.5 py-0.5 break-all">
                <i data-lucide="info" class="w-3.5 h-3.5 text-zinc-500 shrink-0"></i>
                <span>${escapeHtml(statusDesc)}</span>
              </div>

              <div class="flex items-center gap-2 pt-0.5">
                <button class="btn-solid btn-sm btn-open-wallet-role inline-flex items-center justify-center gap-1.5 w-full sm:w-auto px-4 cursor-pointer" data-id="${escapeHtml(w.id)}">
                  <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i>
                  <span>Open ${escapeHtml(w.name)} (Step-by-Step)</span>
                </button>
              </div>
            </div>
          `;
        })
        .join("");
    }

    wContainer.querySelectorAll(".btn-open-wallet-role").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        await fetch("/api/m1/select-role", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: id }),
        });
        await syncM1State();
      });
    });

    wContainer.querySelectorAll(".btn-del-wallet").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.getAttribute("data-id");
        const ok = await showConfirmModal({
          title: "Delete Wallet",
          message: `Delete wallet "${id}" and remove its .key, .pub, and .addr files?`,
          confirmText: "Delete Wallet",
          icon: "trash-2",
        });
        if (!ok) return;
        await fetch(`/api/m1/wallet/${id}`, { method: "DELETE" });
        await syncM1State();
      });
    });
  }

  // Render Network Ledger Cards
  const lContainer = document.getElementById("admin-ledger-list");
  if (lContainer) {
    renderTxCardsList(lContainer, txs, "ledger");
  }
}

// ============================================================================
// VIEW 2: WALLET CLIENT PERSPECTIVE (STEP 1 -> STEP 2 -> STEP 3 -> SEND -> INBOX)
// ============================================================================
function renderWalletClientView() {
  const activeWallet = (m1State.wallets || []).find((w) => w.id === m1State.activeRole);
  const details = m1State.activeDetails;
  if (!activeWallet || !details) {
    m1State.activeRole = "node";
    renderUI();
    return;
  }

  document.getElementById("client-view-name").textContent = activeWallet.name;
  document.getElementById("client-view-store").textContent = `module1-cryptography/generated/wallets/${activeWallet.id}/`;
  document.getElementById("client-view-balance").textContent = `${activeWallet.balance} Coins`;
  document.getElementById("sent-owner-name").textContent = activeWallet.name;
  document.getElementById("inbox-owner-name").textContent = activeWallet.name;

  document.getElementById("sent-tab-count").textContent = String((details.sentMessages || []).length);
  document.getElementById("inbox-tab-count").textContent = String((details.inboxMessages || []).length);

  // 3 File Pills at Top
  const fbKey = document.getElementById("fb-client-key");
  const fnKey = document.getElementById("fn-client-key");
  const fsKey = document.getElementById("fs-client-key");

  const fbPub = document.getElementById("fb-client-pub");
  const fnPub = document.getElementById("fn-client-pub");
  const fsPub = document.getElementById("fs-client-pub");

  const fbAddr = document.getElementById("fb-client-addr");
  const fnAddr = document.getElementById("fn-client-addr");
  const fsAddr = document.getElementById("fs-client-addr");

  fnKey.textContent = `${activeWallet.id}.key`;
  fnPub.textContent = `${activeWallet.id}.pub`;
  fnAddr.textContent = `${activeWallet.id}.addr`;

  if (activeWallet.keyExists) {
    fbKey.classList.add("created");
    fsKey.textContent = `${activeWallet.keySize}B`;
  } else {
    fbKey.classList.remove("created");
    fsKey.textContent = "not created";
  }

  if (activeWallet.pubExists) {
    fbPub.classList.add("created");
    fsPub.textContent = `${activeWallet.pubSize}B`;
  } else {
    fbPub.classList.remove("created");
    fsPub.textContent = "not created";
  }

  if (activeWallet.addrExists) {
    fbAddr.classList.add("created");
    fsAddr.textContent = activeWallet.address ? `${activeWallet.address.slice(0, 10)}...` : "ready";
  } else {
    fbAddr.classList.remove("created");
    fsAddr.textContent = "not created";
  }

  // Step 1 UI State
  const badgeStep1 = document.getElementById("badge-step1-status");
  const labelStep1 = document.getElementById("label-step1-btn");
  const btnRemoveKey = document.getElementById("btn-step1-remove-key");
  const codeStep1 = document.getElementById("cmd-code-step1");
  if (codeStep1 && !codeStep1.getAttribute("data-has-output")) {
    codeStep1.textContent = `$ openssl ecparam -name secp256k1 -genkey -noout -out wallets/${activeWallet.id}/${activeWallet.id}.key`;
  }
  if (activeWallet.keyExists) {
    badgeStep1.className = "vault-badge success";
    badgeStep1.innerHTML = `<i data-lucide="check" class="w-3 h-3"></i>Created`;
    labelStep1.textContent = "1. Re-generate Private Key (.key)";
    btnRemoveKey.style.display = "inline-flex";
  } else {
    badgeStep1.className = "vault-badge muted";
    badgeStep1.textContent = "Pending";
    labelStep1.textContent = "1. Generate Private Key (.key)";
    btnRemoveKey.style.display = "none";
  }

  // Step 2 UI State
  const badgeStep2 = document.getElementById("badge-step2-status");
  const btnStep2 = document.getElementById("btn-step2-gen-pub");
  const labelStep2 = document.getElementById("label-step2-btn");
  const btnRemovePub = document.getElementById("btn-step2-remove-pub");
  const codeStep2 = document.getElementById("cmd-code-step2");
  if (codeStep2 && !codeStep2.getAttribute("data-has-output")) {
    codeStep2.textContent = `$ openssl ec -in wallets/${activeWallet.id}/${activeWallet.id}.key -pubout -out wallets/${activeWallet.id}/${activeWallet.id}.pub`;
  }
  btnStep2.disabled = !activeWallet.keyExists;
  if (activeWallet.pubExists) {
    badgeStep2.className = activeWallet.pubMatchesKey ? "vault-badge success" : "vault-badge warning";
    badgeStep2.innerHTML = activeWallet.pubMatchesKey
      ? `<i data-lucide="check" class="w-3 h-3"></i>Derived`
      : `<i data-lucide="alert-triangle" class="w-3 h-3"></i>Key Mismatch`;
    labelStep2.textContent = "2. Re-derive Public Key (.pub)";
    btnRemovePub.style.display = "inline-flex";
  } else {
    badgeStep2.className = "vault-badge muted";
    badgeStep2.textContent = activeWallet.keyExists ? "Ready for Step 2" : "Requires Step 1";
    labelStep2.textContent = "2. Derive Public Key (.pub)";
    btnRemovePub.style.display = "none";
  }

  // Step 3 UI State
  const badgeStep3 = document.getElementById("badge-step3-status");
  const btnStep3 = document.getElementById("btn-step3-gen-addr");
  const labelStep3 = document.getElementById("label-step3-btn");
  const btnFaucet = document.getElementById("btn-step3-faucet");
  const btnRemoveAddr = document.getElementById("btn-step3-remove-addr");
  const codeStep3 = document.getElementById("cmd-code-step3");
  if (codeStep3 && !codeStep3.getAttribute("data-has-output")) {
    codeStep3.textContent = `$ sha3_256(X || Y)[12..32] -> wallets/${activeWallet.id}/${activeWallet.id}.addr`;
  }
  btnStep3.disabled = !activeWallet.pubExists;
  if (activeWallet.addrExists) {
    badgeStep3.className = activeWallet.addrMatchesPub ? "vault-badge success" : "vault-badge warning";
    badgeStep3.innerHTML = activeWallet.addrMatchesPub
      ? `<i data-lucide="check" class="w-3 h-3"></i>${escapeHtml(activeWallet.address.slice(0, 10))}...`
      : `<i data-lucide="alert-triangle" class="w-3 h-3"></i>Pub Mismatch`;
    labelStep3.textContent = "3. Re-derive Blockchain Address (.addr)";
    if (btnFaucet) btnFaucet.style.display = "inline-flex";
    btnRemoveAddr.style.display = "inline-flex";
  } else {
    badgeStep3.className = "vault-badge muted";
    badgeStep3.textContent = activeWallet.pubExists ? "Ready for Step 3" : "Requires Step 2";
    labelStep3.textContent = "3. Derive Blockchain Address (0x...)";
    if (btnFaucet) btnFaucet.style.display = "none";
    btnRemoveAddr.style.display = "none";
  }

  // Details Inspector Card
  const bodyIdentity = document.getElementById("body-client-identity");
  const detKey = document.getElementById("client-details-key");
  const detPub = document.getElementById("client-details-pub");
  const detAddr = document.getElementById("client-details-addr");

  if (activeWallet.keyExists || activeWallet.pubExists || activeWallet.addrExists) {
    bodyIdentity.style.display = "flex";
  } else {
    bodyIdentity.style.display = "none";
  }

  if (activeWallet.keyExists) {
    detKey.style.display = "block";
    document.getElementById("client-priv-hex").textContent = details.privateKeyHex || "-";
    document.getElementById("client-key-pem").textContent = details.keyPem || "-";
  } else {
    detKey.style.display = "none";
  }

  if (activeWallet.pubExists) {
    detPub.style.display = "block";
    document.getElementById("client-pub-x").textContent = details.xCoordHex || "-";
    document.getElementById("client-pub-y").textContent = details.yCoordHex || "-";
    document.getElementById("client-pub-pem").textContent = details.pubPem || "-";
  } else {
    detPub.style.display = "none";
  }

  if (activeWallet.addrExists) {
    detAddr.style.display = "block";
    document.getElementById("client-sha3-discarded").textContent = details.discardedBytesHex || "";
    document.getElementById("client-sha3-kept").textContent = details.addressBytesHex || "";
    document.getElementById("client-addr-val").textContent = details.address || "-";
  } else {
    detAddr.style.display = "none";
  }

  // Render Sent & Inbox lists
  const sentContainer = document.getElementById("sent-list");
  if (sentContainer) {
    renderTxCardsList(sentContainer, details.sentMessages || [], "sent");
  }
  const inboxContainer = document.getElementById("inbox-list");
  if (inboxContainer) {
    renderTxCardsList(inboxContainer, details.inboxMessages || [], "inbox");
  }
}

// ============================================================================
// STEP 1, STEP 2, STEP 3 BUTTON HANDLERS
// ============================================================================
document.getElementById("btn-step1-gen-key")?.addEventListener("click", async () => {
  const btn = document.getElementById("btn-step1-gen-key");
  const id = m1State.activeRole;
  btn.disabled = true;
  try {
    const res = await fetch("/api/m1/wallet/step1-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();
    await syncM1State();

    if (res.ok && data.success) {
      renderCmdOutput("cmd-details-step1", "cmd-code-step1", {
        commands: [`openssl ecparam -name secp256k1 -genkey -noout -out wallets/${id}/${id}.key`],
        outputs: [
          `[✓ Step 1 Complete] Generated 256-bit secp256k1 Private Key: wallets/${id}/${id}.key`,
          `Secret Scalar (Hex): ${data.privateKeyHex}`,
          `Next: Proceed to Step 2 below to derive your Public Key (X, Y).`,
        ],
        status: "success",
      });
      const detKey = document.getElementById("client-details-key");
      if (detKey) detKey.open = true;
    }
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("btn-step2-gen-pub")?.addEventListener("click", async () => {
  const btn = document.getElementById("btn-step2-gen-pub");
  const id = m1State.activeRole;
  btn.disabled = true;
  try {
    const res = await fetch("/api/m1/wallet/step2-pub", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();
    await syncM1State();

    if (res.ok && data.success) {
      renderCmdOutput("cmd-details-step2", "cmd-code-step2", {
        commands: [`openssl ec -in wallets/${id}/${id}.key -pubout -out wallets/${id}/${id}.pub`],
        outputs: [
          `[✓ Step 2 Complete] Derived Public Key Point on secp256k1: wallets/${id}/${id}.pub`,
          `X Coord (32B): ${data.xCoordHex}`,
          `Y Coord (32B): ${data.yCoordHex}`,
          `Next: Proceed to Step 3 below to hash (X || Y) into your 0x... Blockchain Address.`,
        ],
        status: "success",
      });
      const detPub = document.getElementById("client-details-pub");
      if (detPub) detPub.open = true;
    }
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("btn-step3-gen-addr")?.addEventListener("click", async () => {
  const btn = document.getElementById("btn-step3-gen-addr");
  const id = m1State.activeRole;
  btn.disabled = true;
  try {
    const res = await fetch("/api/m1/wallet/step3-addr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();
    await syncM1State();

    if (res.ok && data.success) {
      renderCmdOutput("cmd-details-step3", "cmd-code-step3", {
        commands: [`sha3_256(X || Y)[12..32] -> wallets/${id}/${id}.addr`],
        outputs: [
          `[✓ Step 3 Complete] Self-Certifying Web3 Address Derived!`,
          `Full SHA3-256 : ${data.sha3HashHex}`,
          `Last 20 Bytes : ${data.addressBytesHex}`,
          `Final Address : ${data.address} (Balance: ${data.balance} Coins)`,
          `Next: Click "Request Testnet Faucet (+100 Coins)" below if you want to fund this address for transactions.`,
        ],
        status: "success",
      });
      const detAddr = document.getElementById("client-details-addr");
      if (detAddr) detAddr.open = true;
    }
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("btn-step3-faucet")?.addEventListener("click", async () => {
  const btn = document.getElementById("btn-step3-faucet");
  const id = m1State.activeRole;
  btn.disabled = true;
  try {
    const res = await fetch("/api/m1/wallet/faucet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();
    await syncM1State();

    if (res.ok && data.success) {
      renderCmdOutput("cmd-details-step3", "cmd-code-step3", {
        commands: [`faucet --credit +100 --to ${data.address}`],
        outputs: [
          `[✓ Testnet Faucet] Credited +${data.amountAdded} Coins to ${data.address}`,
          `Updated Wallet Balance: ${data.balance} Coins`,
        ],
        status: "success",
      });
    }
  } finally {
    btn.disabled = false;
  }
});

// Remove individual step files (.key, .pub, .addr)
async function removeWalletStepFile(fileType) {
  const walletId = m1State.activeRole;
  await fetch("/api/m1/wallet/remove-file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletId, fileType }),
  });
  await syncM1State();
}

document.getElementById("btn-step1-remove-key")?.addEventListener("click", () => removeWalletStepFile("key"));
document.getElementById("btn-step2-remove-pub")?.addEventListener("click", () => removeWalletStepFile("pub"));
document.getElementById("btn-step3-remove-addr")?.addEventListener("click", () => removeWalletStepFile("addr"));

// ============================================================================
// STEP 4 & 5: TRANSACTION CARDS RENDERER (SENT / INBOX / LEDGER)
// ============================================================================
function renderTxCardsList(container, txs, mode) {
  if (!txs || txs.length === 0) {
    const emptyMsg =
      mode === "sent"
        ? "No transactions sent yet. Click <strong>'Send Transaction'</strong> above to sign and broadcast your first transfer."
        : mode === "inbox"
        ? "No incoming transactions for this wallet yet."
        : "No transactions broadcasted on the network yet.";
    container.innerHTML = `
      <div class="p-8 text-center space-y-2">
        <div class="w-10 h-10 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-500">
          <i data-lucide="inbox" class="w-5 h-5"></i>
        </div>
        <div class="text-xs text-zinc-300 font-medium">No Transactions Found</div>
        <p class="text-[11px] text-zinc-500 max-w-xs mx-auto">${emptyMsg}</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  container.innerHTML = txs
    .map((tx) => {
      const timeStr = new Date(tx.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

      let sigBadge = tx.signed
        ? `<span class="vault-badge success"><i data-lucide="pen-tool" class="w-3 h-3"></i>ECDSA Signed</span>`
        : `<span class="vault-badge warning"><i data-lucide="alert-triangle" class="w-3 h-3"></i>Unsigned</span>`;

      let tamperBadge = tx.tampered
        ? `<span class="vault-badge danger"><i data-lucide="flame" class="w-3 h-3"></i>Tampered (+1000 Coins)</span>`
        : "";

      let verifyBadge = "";
      if (tx.verifiedState === "valid") {
        verifyBadge = `<span class="vault-badge success"><i data-lucide="shield-check" class="w-3 h-3"></i>Zero-Trust Valid</span>`;
      } else if (tx.verifiedState === "invalid") {
        verifyBadge = `<span class="vault-badge danger"><i data-lucide="shield-alert" class="w-3 h-3"></i>Rejected / Invalid</span>`;
      } else {
        verifyBadge = `<span class="vault-badge muted">Unverified</span>`;
      }

      const verifyBannerHtml = tx.verifyReason
        ? `
          <div class="result-banner ${tx.verifiedState === "valid" ? "valid" : "invalid"}">
            <i data-lucide="${tx.verifiedState === "valid" ? "check-circle-2" : "x-circle"}" class="w-4 h-4 shrink-0"></i>
            <div class="space-y-0.5 text-xs font-mono">
              <div class="font-semibold">${escapeHtml(tx.verifyReason)}</div>
              ${
                tx.derivedAddress
                  ? `<div class="text-[11px] opacity-85">Proof 1 (SHA3-256 PubKey &rarr; Address): ${escapeHtml(tx.derivedAddress)} ${
                      tx.addressMatch ? "== Claimed Sender (MATCH)" : "!= Claimed Sender (MISMATCH)"
                    } | Proof 2 (ECDSA Verify): ${tx.signatureMatch ? "VALID" : "FAILED"}</div>`
                  : ""
              }
            </div>
          </div>
        `
        : "";

      const opensslVerifyCmd = `$ openssl dgst -sha256 -verify wallets/${escapeHtml(tx.fromId)}/${escapeHtml(
        tx.fromId
      )}.pub -signature ${escapeHtml(tx.sigFile || "transactions/tx.sig")} ${escapeHtml(tx.txFile)}`;

      return `
        <div class="inbox-item-card" id="tx-card-${escapeHtml(tx.id)}-${mode}">
          <div class="inbox-item-head">
            <div class="inbox-item-meta">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-xs font-semibold text-zinc-100">${escapeHtml(tx.fromName)} &rarr; ${escapeHtml(tx.toName)}</span>
                <span class="vault-badge success font-mono">${tx.amount} Coins</span>
                <span class="text-[11px] text-zinc-500 font-mono">Nonce #${tx.nonce} &middot; ${escapeHtml(timeStr)}</span>
              </div>
              <div class="flex items-center gap-1.5 flex-wrap">
                ${sigBadge}
                ${tamperBadge}
                ${verifyBadge}
              </div>
            </div>
          </div>

          <div class="text-xs text-zinc-400 font-mono space-y-0.5 break-all">
            <div><span class="text-zinc-500">From:</span> ${escapeHtml(tx.fromAddress)}</div>
            <div><span class="text-zinc-500">To  :</span> ${escapeHtml(tx.toAddress)}</div>
            <div><span class="text-zinc-500">Memo:</span> ${escapeHtml(tx.memo)}</div>
          </div>

          ${verifyBannerHtml}

          <!-- Collapsible Cryptographic Payload & Signature -->
          <details class="group rounded-lg border border-zinc-800 bg-zinc-950 text-xs overflow-hidden" id="cmd-details-tx-${escapeHtml(tx.id)}-${mode}">
            <summary class="px-3 py-1.5 cursor-pointer select-none flex items-center justify-between">
              <span class="text-[10px] uppercase font-bold text-zinc-500 font-mono tracking-wider group-hover:text-zinc-300 transition-colors flex items-center gap-1.5">
                <i data-lucide="terminal" class="w-3.5 h-3.5"></i>
                <span>Inspect Payload JSON, SHA-256 Digest &amp; ECDSA Signature</span>
              </span>
              <span class="text-zinc-500 text-[10px] font-mono group-hover:text-zinc-400 transition-colors group-open:hidden">Show</span>
              <span class="text-zinc-500 text-[10px] font-mono group-hover:text-zinc-400 transition-colors hidden group-open:inline">Hide</span>
            </summary>
            <div class="p-3 border-t border-zinc-800 bg-zinc-950/60 space-y-2.5 text-[11px] font-mono text-zinc-400">
              <div>
                <div class="text-[10px] uppercase font-bold text-zinc-500">1. Canonical Transaction JSON (${escapeHtml(tx.txFile)}):</div>
                <pre class="text-zinc-200 whitespace-pre-wrap break-all mt-0.5">${escapeHtml(tx.canonicalJson)}</pre>
              </div>
              <div>
                <div class="text-[10px] uppercase font-bold text-zinc-500">2. SHA-256 Transaction Digest (32 Bytes):</div>
                <div class="text-emerald-400 break-all mt-0.5">${escapeHtml(tx.txHashHex)}</div>
              </div>
              <div>
                <div class="text-[10px] uppercase font-bold text-zinc-500">3. ECDSA Signature Hex (secp256k1):</div>
                <div class="text-zinc-300 break-all mt-0.5">${escapeHtml(tx.signatureHex || "(No signature attached)")}</div>
              </div>
              <div>
                <div class="text-[10px] uppercase font-bold text-zinc-500">4. OpenSSL Verification Command:</div>
                <code id="cmd-code-tx-${escapeHtml(tx.id)}-${mode}" class="whitespace-pre-wrap text-zinc-400 block mt-0.5">${opensslVerifyCmd}</code>
              </div>
            </div>
          </details>

          <div class="inbox-actions flex items-center gap-2 pt-0.5">
            <button class="btn-solid btn-sm btn-verify-tx inline-flex items-center justify-center gap-1.5 px-3 cursor-pointer" data-id="${escapeHtml(tx.id)}" data-mode="${mode}">
              <i data-lucide="shield-check" class="w-3.5 h-3.5"></i>
              <span>5. Verify Zero-Trust (No CA)</span>
            </button>
            <button class="btn-solid btn-sm btn-tamper-tx inline-flex items-center justify-center gap-1.5 px-3 cursor-pointer" data-id="${escapeHtml(tx.id)}" data-mode="${mode}">
              <i data-lucide="flame" class="w-3.5 h-3.5"></i>
              <span>${tx.tampered ? "Restore Original Amount" : "Attack: Tamper Amount (+1000)"}</span>
            </button>
          </div>
        </div>
      `;
    })
    .join("");

  if (window.lucide) window.lucide.createIcons();

  container.querySelectorAll(".btn-verify-tx").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const txId = btn.getAttribute("data-id");
      btn.disabled = true;
      try {
        await fetch("/api/m1/tx/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ txId }),
        });
        await syncM1State();
      } finally {
        btn.disabled = false;
      }
    });
  });

  container.querySelectorAll(".btn-tamper-tx").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const txId = btn.getAttribute("data-id");
      btn.disabled = true;
      try {
        await fetch("/api/m1/tx/tamper", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ txId }),
        });
        await syncM1State();
      } finally {
        btn.disabled = false;
      }
    });
  });
}

// ============================================================================
// SEND TRANSACTION MODAL (STEP 4)
// ============================================================================
const recTrigger = document.getElementById("recipient-dropdown-trigger");
const recMenu = document.getElementById("recipient-dropdown-menu");
const recChevron = document.getElementById("recipient-dropdown-chevron");

function toggleRecipientDropdown(show) {
  if (!recMenu) return;
  const isHidden = recMenu.classList.contains("hidden");
  const willShow = show !== undefined ? show : isHidden;
  if (willShow) {
    recMenu.classList.remove("hidden");
    recChevron?.classList.add("rotate-180");
  } else {
    recMenu.classList.add("hidden");
    recChevron?.classList.remove("rotate-180");
  }
}

recTrigger?.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleRecipientDropdown();
});

document.addEventListener("click", (e) => {
  const container = document.getElementById("recipient-dropdown-container");
  if (container && !container.contains(e.target)) {
    toggleRecipientDropdown(false);
  }
});

function openSendTxModal() {
  const modal = document.getElementById("modal-send-tx");
  const errEl = document.getElementById("send-tx-error");
  if (errEl) errEl.style.display = "none";

  const senderId = m1State.activeRole;
  const eligibleRecipients = (m1State.wallets || []).filter((w) => w.id !== senderId && w.addrExists);

  const noRecWarning = document.getElementById("no-recipients-warning");
  const itemsEl = document.getElementById("recipient-dropdown-items");
  const hiddenInput = document.getElementById("send-recipient-select");
  const labelEl = document.getElementById("recipient-selected-label");
  const sendBtn = document.getElementById("btn-client-send-tx");

  if (eligibleRecipients.length === 0) {
    if (noRecWarning) noRecWarning.style.display = "flex";
    if (itemsEl) itemsEl.innerHTML = `<div class="px-3 py-2 text-zinc-500">No other wallets have derived an address yet</div>`;
    if (hiddenInput) hiddenInput.value = "";
    if (labelEl) labelEl.textContent = "No recipient with .addr available";
    if (sendBtn) sendBtn.disabled = true;
  } else {
    if (noRecWarning) noRecWarning.style.display = "none";
    if (sendBtn) sendBtn.disabled = false;
    const first = eligibleRecipients[0];
    if (hiddenInput) hiddenInput.value = first.id;
    if (labelEl) labelEl.textContent = `${first.name} (${first.address})`;

    itemsEl.innerHTML = eligibleRecipients
      .map(
        (r) => `
        <button type="button" class="rec-option-item w-full flex items-center justify-between px-3 py-2 rounded-md text-left hover:bg-zinc-900 text-zinc-200 cursor-pointer" data-id="${escapeHtml(
          r.id
        )}" data-label="${escapeHtml(r.name)} (${escapeHtml(r.address)})">
          <div class="min-w-0">
            <div class="text-xs font-medium text-zinc-100">${escapeHtml(r.name)}</div>
            <div class="text-[10px] font-mono text-zinc-400 truncate">${escapeHtml(r.address)}</div>
          </div>
        </button>
      `
      )
      .join("");

    itemsEl.querySelectorAll(".rec-option-item").forEach((item) => {
      item.addEventListener("click", () => {
        const id = item.getAttribute("data-id");
        const lbl = item.getAttribute("data-label");
        if (hiddenInput) hiddenInput.value = id;
        if (labelEl) labelEl.textContent = lbl;
        toggleRecipientDropdown(false);
      });
    });
  }

  const codeEl = document.getElementById("cmd-client-send");
  if (codeEl) {
    codeEl.textContent = `$ openssl dgst -sha256 -sign wallets/${senderId}/${senderId}.key -out transactions/tx.sig transactions/tx.json`;
  }

  modal.style.display = "flex";
  if (window.lucide) window.lucide.createIcons();
}

document.getElementById("btn-open-send-modal")?.addEventListener("click", openSendTxModal);
document.getElementById("btn-close-modal-send")?.addEventListener("click", () => {
  document.getElementById("modal-send-tx").style.display = "none";
});

document.getElementById("btn-client-send-tx")?.addEventListener("click", async () => {
  const fromId = m1State.activeRole;
  const toId = document.getElementById("send-recipient-select")?.value || "";
  const amount = Number(document.getElementById("send-tx-amount")?.value || 0);
  const memo = document.getElementById("send-tx-memo")?.value || "";
  const sign = document.getElementById("send-sign-checkbox")?.checked !== false;
  const errEl = document.getElementById("send-tx-error");

  const btn = document.getElementById("btn-client-send-tx");
  btn.disabled = true;
  try {
    const res = await fetch("/api/m1/tx/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromId, toId, amount, memo, sign }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      if (errEl) {
        errEl.textContent = data.error || "Failed to send transaction";
        errEl.style.display = "block";
      }
      return;
    }
    document.getElementById("modal-send-tx").style.display = "none";
    await syncM1State();
  } catch (err) {
    if (errEl) {
      errEl.textContent = err.message;
      errEl.style.display = "block";
    }
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("btn-refresh-sent")?.addEventListener("click", syncM1State);
document.getElementById("btn-refresh-inbox")?.addEventListener("click", syncM1State);

// ============================================================================
// SUBTABS & COLLAPSIBLE SECTIONS
// ============================================================================
function switchClientSubtab(subtab) {
  currentSubtab = subtab;
  document.querySelectorAll("#client-subtabs-nav .subtab-btn").forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-subtab") === subtab);
  });
  const panels = ["identity", "send", "inbox"];
  panels.forEach((p) => {
    const el = document.getElementById(`subtab-${p}`);
    if (el) el.style.display = p === subtab ? "flex" : "none";
  });
}

function switchAdminSubtab(subtab) {
  currentAdminSubtab = subtab;
  document.querySelectorAll("#admin-subtabs-nav .admin-subtab-btn").forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-admin-subtab") === subtab);
  });
  const panels = ["vault", "ledger"];
  panels.forEach((p) => {
    const el = document.getElementById(`admin-subtab-${p}`);
    if (el) el.style.display = p === subtab ? "flex" : "none";
  });
}

document.getElementById("client-subtabs-nav")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".subtab-btn");
  if (!btn) return;
  switchClientSubtab(btn.getAttribute("data-subtab"));
});

document.getElementById("admin-subtabs-nav")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".admin-subtab-btn");
  if (!btn) return;
  switchAdminSubtab(btn.getAttribute("data-admin-subtab"));
});

// Collapsible section cards
document.addEventListener("click", (e) => {
  const header = e.target.closest(".section-header");
  if (header) {
    const card = header.closest(".section-card");
    if (card) card.classList.toggle("collapsed");
  }

  const copyBtn = e.target.closest(".btn-copy-code");
  if (copyBtn) {
    const targetId = copyBtn.getAttribute("data-target");
    const targetEl = document.getElementById(targetId);
    if (targetEl) {
      navigator.clipboard.writeText(targetEl.textContent || "");
      const orig = copyBtn.textContent;
      copyBtn.textContent = "Copied!";
      setTimeout(() => (copyBtn.textContent = orig), 1200);
    }
  }
});

// Initialize on load
syncM1State();
