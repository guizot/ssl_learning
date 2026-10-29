// ============================================================================
// CERTIFICATE AUTHORITY (CA) LAB - ROLE-BASED & INBOX CONTROLLER
// ============================================================================

let caState = {
  rootCaExists: false,
  rootCa: null,
  clients: [],
  activeRole: "admin",
  activeId: "",
  activeDetails: null,
};

let currentSubtab = "identity";

// Helper: Escape HTML to prevent injection
function escapeHtml(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Terminal Logger
function logTerminal(command, output) {
  const termBox = document.getElementById("term-box");
  if (!termBox) return;
  const line = document.createElement("div");
  line.className = "term-line";

  const cmdEl = document.createElement("div");
  cmdEl.className = "term-cmd";
  cmdEl.textContent = command.startsWith("$") ? command : `$ ${command}`;

  const outEl = document.createElement("div");
  outEl.className = "term-out";
  outEl.textContent = output;

  line.appendChild(cmdEl);
  line.appendChild(outEl);
  termBox.appendChild(line);
  termBox.scrollTop = termBox.scrollHeight;
}

// ============================================================================
// STATE SYNC & UI RENDER
// ============================================================================
async function syncCAState() {
  try {
    const res = await fetch("/api/ca/state");
    caState = await res.json();
    renderUI();
  } catch (err) {
    console.error("Failed to sync CA state:", err);
  }
}

function renderUI() {
  if (caState.activeRole !== "admin" && (!caState.clients || !caState.clients.some((c) => c.id === caState.activeRole))) {
    caState.activeRole = "admin";
  }
  renderRoleSelector();
  if (caState.activeRole === "admin") {
    const adminEl = document.getElementById("view-admin");
    adminEl.style.display = "flex";
    adminEl.style.flexDirection = "column";
    document.getElementById("view-client").style.display = "none";
    renderAdminView();
  } else {
    document.getElementById("view-admin").style.display = "none";
    const clientEl = document.getElementById("view-client");
    clientEl.style.display = "flex";
    clientEl.style.flexDirection = "column";
    renderClientView();
  }
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// ============================================================================
// ROLE SELECTOR & CRUD
// ============================================================================
function renderRoleSelector() {
  const roleSelect = document.getElementById("global-role-select");
  let optionsHtml = `<option value="admin" ${caState.activeRole === "admin" ? "selected" : ""}>Admin (Root CA)</option>`;

  caState.clients.forEach((c) => {
    const certTag = c.crtExists ? "✓" : "needs cert";
    optionsHtml += `<option value="${escapeHtml(c.id)}" ${caState.activeRole === c.id ? "selected" : ""}>
      ${escapeHtml(c.name)} (${certTag})
    </option>`;
  });

  roleSelect.innerHTML = optionsHtml;
}

document.getElementById("global-role-select").addEventListener("change", async (e) => {
  const selectedRole = e.target.value;
  await fetch("/api/ca/select-role", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: selectedRole }),
  });
  await syncCAState();
});

// =====================================================================
// MODAL MANAGERS: CONFIRM DIALOG & ADD CLIENT MODAL
// =====================================================================

function showConfirmModal({
  title = "Confirm Action",
  message = "Are you sure you want to proceed?",
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "danger", // "danger" or "primary"
  icon = "alert-triangle",
  alertOnly = false,
} = {}) {
  return new Promise((resolve) => {
    const modal = document.getElementById("modal-confirm");
    const titleEl = document.getElementById("confirm-title");
    const msgEl = document.getElementById("confirm-message");
    const proceedBtn = document.getElementById("btn-confirm-proceed");
    const proceedText = document.getElementById("confirm-proceed-text");
    const cancelBtn = document.getElementById("btn-confirm-cancel");
    const cancelTextEl = document.getElementById("confirm-cancel-text");
    const iconBox = document.getElementById("confirm-icon-box");
    const iconEl = document.getElementById("confirm-icon");
    const proceedIcon = document.getElementById("confirm-proceed-icon");

    titleEl.textContent = title;
    msgEl.textContent = message;
    proceedText.textContent = confirmText;
    cancelTextEl.textContent = cancelText;

    if (alertOnly) {
      cancelBtn.style.display = "none";
      proceedBtn.className = "flex-1 btn-solid h-9 sm:h-8 text-xs font-medium rounded-lg";
      iconBox.className = "w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 flex items-center justify-center shrink-0";
      iconEl.setAttribute("data-lucide", icon || "info");
      proceedIcon.setAttribute("data-lucide", "check");
    } else if (variant === "danger") {
      cancelBtn.style.display = "inline-flex";
      iconBox.className = "w-9 h-9 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center shrink-0";
      iconEl.setAttribute("data-lucide", icon || "alert-triangle");
      proceedBtn.className = "flex-1 inline-flex items-center justify-center gap-1.5 h-9 sm:h-8 text-xs font-medium rounded-lg bg-rose-600 hover:bg-rose-500 text-white transition-colors";
      proceedIcon.setAttribute("data-lucide", icon === "rotate-ccw" ? "rotate-ccw" : "trash-2");
    } else {
      cancelBtn.style.display = "inline-flex";
      iconBox.className = "w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 flex items-center justify-center shrink-0";
      iconEl.setAttribute("data-lucide", icon || "check-circle");
      proceedBtn.className = "flex-1 btn-solid h-9 sm:h-8 text-xs font-medium rounded-lg";
      proceedIcon.setAttribute("data-lucide", "check");
    }

    if (window.lucide) window.lucide.createIcons();
    modal.style.display = "flex";

    function cleanup(result) {
      modal.style.display = "none";
      proceedBtn.removeEventListener("click", onProceed);
      cancelBtn.removeEventListener("click", onCancel);
      modal.removeEventListener("click", onBackdrop);
      window.removeEventListener("keydown", onKeydown);
      resolve(result);
    }

    function onProceed() { cleanup(true); }
    function onCancel() { cleanup(false); }
    function onBackdrop(e) { if (e.target === modal) cleanup(false); }
    function onKeydown(e) {
      if (e.key === "Escape") cleanup(false);
      if (e.key === "Enter") cleanup(true);
    }

    proceedBtn.addEventListener("click", onProceed);
    cancelBtn.addEventListener("click", onCancel);
    modal.addEventListener("click", onBackdrop);
    window.addEventListener("keydown", onKeydown);
  });
}

function showAlertModal(title, message, icon = "info") {
  return showConfirmModal({
    title,
    message,
    confirmText: "OK",
    alertOnly: true,
    icon,
  });
}

// Add Client Modal handlers
const modalAddClient = document.getElementById("modal-add-client");
const clientInput = document.getElementById("input-client-name");
const clientErr = document.getElementById("add-client-error");

function openAddClientModal() {
  clientInput.value = "";
  if (clientErr) {
    clientErr.textContent = "";
    clientErr.style.display = "none";
  }
  modalAddClient.style.display = "flex";
  setTimeout(() => clientInput.focus(), 60);
}

function closeAddClientModal() {
  modalAddClient.style.display = "none";
  clientInput.value = "";
  if (clientErr) {
    clientErr.textContent = "";
    clientErr.style.display = "none";
  }
}

document.getElementById("btn-open-add-client").addEventListener("click", openAddClientModal);
document.getElementById("btn-cancel-add-client").addEventListener("click", closeAddClientModal);
document.getElementById("btn-close-modal-add-client").addEventListener("click", closeAddClientModal);
modalAddClient.addEventListener("click", (e) => {
  if (e.target === modalAddClient) closeAddClientModal();
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modalAddClient.style.display === "flex") {
    closeAddClientModal();
  }
});
clientInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    document.getElementById("btn-submit-add-client").click();
  }
});

document.getElementById("btn-submit-add-client").addEventListener("click", async () => {
  const name = clientInput.value.trim();
  if (!name) {
    if (clientErr) {
      clientErr.textContent = "Please enter a Common Name.";
      clientErr.style.display = "block";
    }
    clientInput.focus();
    return;
  }

  const btn = document.getElementById("btn-submit-add-client");
  btn.innerHTML = `<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i><span>Creating...</span>`;
  if (window.lucide) window.lucide.createIcons();
  btn.disabled = true;

  try {
    const res = await fetch("/api/ca/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, generateKey: false }),
    });
    const data = await res.json();
    if (data.opensslLogs) {
      data.opensslLogs.forEach((l) => logTerminal(l.command, l.output));
    }
    closeAddClientModal();

    // Switch to newly created client
    await fetch("/api/ca/select-role", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: data.id }),
    });
    await syncCAState();
  } finally {
    btn.innerHTML = `<i data-lucide="user-plus" class="w-3.5 h-3.5"></i><span>Create Client</span>`;
    if (window.lucide) window.lucide.createIcons();
    btn.disabled = false;
  }
});

// ============================================================================
// ADMIN VIEW RENDER & ACTIONS
// ============================================================================
function renderAdminView() {
  // Root CA status
  const fbRootKey = document.getElementById("fb-root-key");
  const fsRootKey = document.getElementById("fs-root-key");
  const fbRootCrt = document.getElementById("fb-root-crt");
  const fsRootCrt = document.getElementById("fs-root-crt");
  const adminInitBtn = document.getElementById("btn-admin-init-root");
  const bodyAdminRoot = document.getElementById("body-admin-root");

  document.getElementById("admin-clients-count").textContent = String(caState.clients.length);

  if (caState.rootCaExists && caState.rootCa) {
    fbRootKey.classList.add("created");
    fsRootKey.textContent = "secp256k1";
    fbRootCrt.classList.add("created");
    fsRootCrt.textContent = "valid (365d)";
    adminInitBtn.innerHTML = `<i data-lucide="plus-circle" class="w-3.5 h-3.5"></i><span>Re-initialize Root CA</span>`;
    document.getElementById("admin-ca-issuer").textContent = caState.rootCa.issuer;
    document.getElementById("admin-ca-subject").textContent = caState.rootCa.subject;
    document.getElementById("admin-ca-dates").textContent = `${caState.rootCa.validNotBefore} -> ${caState.rootCa.validNotAfter}`;
    document.getElementById("admin-ca-pem").textContent = caState.rootCa.certPem;
    bodyAdminRoot.style.display = "flex";
  } else {
    fbRootKey.classList.remove("created");
    fsRootKey.textContent = "not created";
    fbRootCrt.classList.remove("created");
    fsRootCrt.textContent = "not created";
    adminInitBtn.innerHTML = `<i data-lucide="plus-circle" class="w-3.5 h-3.5"></i><span>Initialize Root CA</span>`;
    bodyAdminRoot.style.display = "none";
  }
  if (window.lucide) window.lucide.createIcons();

  // Clients list in Admin View (Antigravity Manager Style)
  const tbody = document.getElementById("admin-clients-tbody");
  const tableHeader = document.getElementById("admin-table-header");

  if (!caState.clients || caState.clients.length === 0) {
    if (tableHeader) tableHeader.style.display = "none";
    tbody.innerHTML = `
      <div class="p-8 text-center space-y-2">
        <div class="w-10 h-10 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-500">
          <i data-lucide="users" class="w-5 h-5"></i>
        </div>
        <div class="text-xs text-zinc-300 font-medium">No Clients Registered Yet</div>
        <p class="text-[11px] text-zinc-500 max-w-xs mx-auto">
          Click <strong>'Add Client'</strong> below to register your first client (e.g. Alice, Bob, or a domain).
        </p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  if (tableHeader) tableHeader.style.display = "";

  tbody.innerHTML = caState.clients
    .map((c) => {
      const initial = (c.name || "C").charAt(0).toUpperCase();

      const keyBadge = c.keyExists
        ? `<span class="status-pill signed">✓ secp256k1</span>`
        : `<span class="status-pill none">Not Generated</span>`;

      const csrBadge = c.csrExists
        ? `<span class="status-pill signed">✓ Ready</span>`
        : `<span class="status-pill none">No CSR</span>`;

      const crtBadge = c.crtExists
        ? !c.crtValid
          ? `<span class="status-pill border border-amber-500/40 bg-amber-500/10 text-amber-300">⚠ CA Mismatch</span>`
          : !c.keyExists
          ? `<span class="status-pill border border-rose-500/40 bg-rose-500/10 text-rose-400">⚠ No Key</span>`
          : !c.keyMatchesCrt
          ? `<span class="status-pill border border-amber-500/40 bg-amber-500/10 text-amber-300">⚠ Key Mismatch</span>`
          : `<span class="status-pill signed">✓ Issued</span>`
        : `<span class="status-pill none">Pending</span>`;

      let actionBtn = "";
      if (c.crtExists) {
        if (!c.csrExists) {
          actionBtn = `
            <div class="flex-1 sm:flex-initial sm:w-36 h-9 sm:h-8 flex items-center justify-center px-3 rounded-lg border border-dashed border-rose-900/50 bg-rose-950/20 text-[11px] font-mono text-rose-400 text-center">No CSR to Sign</div>
            <button class="hidden sm:inline-flex items-center justify-center w-8 h-8 rounded-lg bg-zinc-900 hover:bg-rose-950/40 text-zinc-400 hover:text-rose-400 border border-zinc-800 hover:border-rose-900/50 transition-colors shrink-0 btn-del-client text-xs" data-id="${escapeHtml(c.id)}" title="Delete client">✕</button>
          `;
        } else {
          let btnLabel = "Re-sign";
          if (!c.crtValid) btnLabel = "Re-sign with CA";
          else if (!c.keyMatchesCrt) btnLabel = "Re-sign with Key";
          actionBtn = `
            <button class="btn-solid btn-sm btn-re-sign flex-1 sm:flex-initial sm:w-36 h-9 sm:h-8 text-center" data-id="${escapeHtml(c.id)}">
              <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>
              <span>${btnLabel}</span>
            </button>
            <button class="hidden sm:inline-flex items-center justify-center w-8 h-8 rounded-lg bg-zinc-900 hover:bg-rose-950/40 text-zinc-400 hover:text-rose-400 border border-zinc-800 hover:border-rose-900/50 transition-colors shrink-0 btn-del-client text-xs" data-id="${escapeHtml(c.id)}" title="Delete client">✕</button>
          `;
        }
      } else if (c.csrExists) {
        actionBtn = `
          <button class="btn-solid btn-sm btn-sign-cert flex-1 sm:flex-initial sm:w-36 h-9 sm:h-8 text-center" data-id="${escapeHtml(c.id)}">
            <i data-lucide="file-check" class="w-3.5 h-3.5"></i>
            <span>Sign &amp; Issue Cert</span>
          </button>
          <button class="hidden sm:inline-flex items-center justify-center w-8 h-8 rounded-lg bg-zinc-900 hover:bg-rose-950/40 text-zinc-400 hover:text-rose-400 border border-zinc-800 hover:border-rose-900/50 transition-colors shrink-0 btn-del-client text-xs" data-id="${escapeHtml(c.id)}" title="Delete client">✕</button>
        `;
      } else {
        actionBtn = `
          <div class="flex-1 sm:flex-initial sm:w-36 h-9 sm:h-8 flex items-center justify-center px-3 rounded-lg border border-dashed border-zinc-800 text-[11px] font-mono text-zinc-500 text-center">Awaiting Key &amp; CSR</div>
          <button class="hidden sm:inline-flex items-center justify-center w-8 h-8 rounded-lg bg-zinc-900 hover:bg-rose-950/40 text-zinc-400 hover:text-rose-400 border border-zinc-800 hover:border-rose-900/50 transition-colors shrink-0 btn-del-client text-xs" data-id="${escapeHtml(c.id)}" title="Delete client">✕</button>
        `;
      }

      return `
        <div class="p-3.5 sm:px-4 sm:py-3 hover:bg-zinc-800/30 transition flex flex-col sm:grid sm:grid-cols-12 sm:gap-3 sm:items-center gap-3">
          <!-- Col 1: Identity (span 3) -->
          <div class="flex items-center justify-between sm:justify-start gap-3 min-w-0 sm:col-span-3">
            <div class="flex items-center gap-2.5 min-w-0">
              <div class="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xs font-semibold text-zinc-200 shrink-0">
                ${escapeHtml(initial)}
              </div>
              <div class="min-w-0">
                <div class="text-xs font-semibold text-zinc-100 truncate">${escapeHtml(c.name)}</div>
                <div class="text-[11px] text-zinc-500 font-mono truncate">id: ${escapeHtml(c.id)}</div>
              </div>
            </div>
            <!-- Mobile Only Delete Button -->
            <button class="sm:hidden inline-flex items-center justify-center w-8 h-8 rounded-lg bg-zinc-900 hover:bg-rose-950/40 text-zinc-400 hover:text-rose-400 border border-zinc-800 transition-colors shrink-0 btn-del-client text-xs" data-id="${escapeHtml(c.id)}" title="Delete client">✕</button>
          </div>

          <!-- Col 2: Key Badge (span 2, Desktop only) -->
          <div class="hidden sm:flex sm:col-span-2 justify-center">
            ${keyBadge}
          </div>

          <!-- Col 3: CSR Badge (span 2, Desktop only) -->
          <div class="hidden sm:flex sm:col-span-2 justify-center">
            ${csrBadge}
          </div>

          <!-- Col 4: Cert Badge (span 2, Desktop only) -->
          <div class="hidden sm:flex sm:col-span-2 justify-center">
            ${crtBadge}
          </div>

          <!-- Mobile Only 3-pill grid -->
          <div class="grid grid-cols-3 gap-2 w-full sm:hidden text-xs">
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-zinc-500 text-[10px] uppercase font-bold font-mono text-center">Key</span>
              ${keyBadge}
            </div>
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-zinc-500 text-[10px] uppercase font-bold font-mono text-center">CSR</span>
              ${csrBadge}
            </div>
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-zinc-500 text-[10px] uppercase font-bold font-mono text-center">Cert</span>
              ${crtBadge}
            </div>
          </div>

          <!-- Col 5: Actions (span 3) -->
          <div class="flex items-center gap-2 sm:justify-end sm:col-span-3 w-full sm:w-auto">
            ${actionBtn}
          </div>
        </div>
      `;
    })
    .join("");

  if (window.lucide) window.lucide.createIcons();

  // Attach table button actions
  tbody.querySelectorAll(".btn-sign-cert, .btn-re-sign").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const isReSign = btn.classList.contains("btn-re-sign");
      btn.innerHTML = `<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i><span>Signing...</span>`;
      if (window.lucide) window.lucide.createIcons();
      btn.disabled = true;
      try {
        const res = await fetch("/api/ca/sign-cert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        const data = await res.json();
        if (data.opensslLogs) {
          data.opensslLogs.forEach((l) => logTerminal(l.command, l.output));
        }
        await syncCAState();
      } finally {
        btn.innerHTML = isReSign
          ? `<i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i><span>Re-sign</span>`
          : `<i data-lucide="file-check" class="w-3.5 h-3.5"></i><span>Sign &amp; Issue Cert</span>`;
        if (window.lucide) window.lucide.createIcons();
        btn.disabled = false;
      }
    });
  });

  tbody.querySelectorAll(".btn-del-client").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const ok = await showConfirmModal({
        title: "Delete Client",
        message: `Delete client "${id}" and wipe all their keys, CSR, and certificates? This action cannot be undone.`,
        confirmText: "Delete Client",
        cancelText: "Cancel",
        variant: "danger",
        icon: "trash-2",
      });
      if (!ok) return;
      await fetch(`/api/ca/client/${id}`, { method: "DELETE" });
      await syncCAState();
    });
  });
}

// Admin: Initialize Root CA
document.getElementById("btn-admin-init-root").addEventListener("click", async () => {
  const btn = document.getElementById("btn-admin-init-root");
  btn.innerHTML = `<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i><span>Generating...</span>`;
  if (window.lucide) window.lucide.createIcons();
  btn.disabled = true;
  try {
    const res = await fetch("/api/ca/init-root", { method: "POST" });
    const data = await res.json();
    if (data.opensslLogs) {
      data.opensslLogs.forEach((l) => logTerminal(l.command, l.output));
    }
    await syncCAState();
  } finally {
    btn.innerHTML = `<i data-lucide="plus-circle" class="w-3.5 h-3.5"></i><span>${caState.rootCaExists ? "Re-initialize Root CA" : "Initialize Root CA"}</span>`;
    if (window.lucide) window.lucide.createIcons();
    btn.disabled = false;
  }
});

// Admin: Fake CA Attack Test
document.getElementById("btn-admin-fake-test").addEventListener("click", async () => {
  const targetClient = caState.clients ? caState.clients[0] : null;
  if (!targetClient) {
    await showAlertModal("No Clients Found", "Please create at least one client before simulating a fake CA attack.", "alert-triangle");
    return;
  }
  const btn = document.getElementById("btn-admin-fake-test");
  btn.innerHTML = `<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i><span>Testing Attack...</span>`;
  if (window.lucide) window.lucide.createIcons();
  btn.disabled = true;
  try {
    const res = await fetch("/api/ca/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: targetClient.id, isFake: true }),
    });
    const data = await res.json();
    if (data.opensslLog) {
      logTerminal(data.opensslLog.command, data.opensslLog.output);
    }
    document.getElementById("body-admin-fake").style.display = "flex";
  } finally {
    btn.innerHTML = `<i data-lucide="alert-triangle" class="w-3.5 h-3.5"></i><span>Test Fake CA Attack</span>`;
    if (window.lucide) window.lucide.createIcons();
    btn.disabled = false;
  }
});

// ============================================================================
// CLIENT VIEW RENDER & SUBTABS
// ============================================================================
function renderClientView() {
  const activeClient = caState.clients ? caState.clients.find((c) => c.id === caState.activeRole) : null;
  if (!activeClient) {
    caState.activeRole = "admin";
    renderUI();
    return;
  }

  // Header info
  const nameEl = document.getElementById("client-view-name");
  if (nameEl) nameEl.textContent = activeClient.name;
  const cnEl = document.getElementById("client-view-cn");
  if (cnEl) cnEl.textContent = `CN=${activeClient.name}`;
  const storeEl = document.getElementById("client-view-store");
  if (storeEl) {
    storeEl.textContent = `module0-ca/generated/clients/${activeClient.id}/`;
  }
  document.getElementById("inbox-owner-name").textContent = activeClient.name;

  // Client File Badges
  document.getElementById("fn-client-key").textContent = `key: ${activeClient.keyExists ? "secp256k1" : "none"}`;
  document.getElementById("fn-client-csr").textContent = `csr: ${activeClient.csrExists ? "ready" : "none"}`;
  document.getElementById("fn-client-crt").textContent = `crt: ${activeClient.crtExists ? "signed" : "none"}`;

  const fbKey = document.getElementById("fb-client-key");
  const fsKey = document.getElementById("fs-client-key");
  const fbCsr = document.getElementById("fb-client-csr");
  const fsCsr = document.getElementById("fs-client-csr");
  const fbCrt = document.getElementById("fb-client-crt");
  const fsCrt = document.getElementById("fs-client-crt");
  if (activeClient.keyExists) {
    fbKey.classList.add("created");
    fsKey.textContent = `${activeClient.keySize}B`;
  } else {
    fbKey.classList.remove("created");
    fsKey.textContent = "not created";
  }

  if (activeClient.csrExists) {
    fbCsr.classList.add("created");
    fsCsr.textContent = `${activeClient.csrSize}B`;
  } else {
    fbCsr.classList.remove("created");
    fsCsr.textContent = "not created";
  }

  if (activeClient.crtExists) {
    fbCrt.classList.add("created");
    if (!activeClient.crtValid) {
      fsCrt.textContent = "CA mismatch";
      fsCrt.className = "f-state text-amber-400 text-[11px]";
    } else if (!activeClient.keyExists) {
      fsCrt.textContent = "no private key";
      fsCrt.className = "f-state text-rose-400 text-[11px]";
    } else if (!activeClient.keyMatchesCrt) {
      fsCrt.textContent = "key mismatch";
      fsCrt.className = "f-state text-amber-400 text-[11px]";
    } else {
      fsCrt.textContent = "valid (365d)";
      fsCrt.className = "f-state text-zinc-500 text-[11px]";
    }
  } else {
    fbCrt.classList.remove("created");
    fsCrt.textContent = "not created";
    fsCrt.className = "f-state text-zinc-500 text-[11px]";
  }

  // Update Inbox Tab Badge Count
  document.getElementById("inbox-tab-count").textContent = String(activeClient.inboxCount || 0);

  // Update active subtab highlighting and panel visibility
  updateSubtabs();

  // Render Subtab Panels
  renderClientIdentity(activeClient);
  renderClientSendTab(activeClient);
  if (currentSubtab === "inbox") {
    loadAndRenderInbox(activeClient.id);
  }
}

// Subtabs navigation controller
function updateSubtabs() {
  document.querySelectorAll(".subtab-btn").forEach((b) => {
    if (b.getAttribute("data-subtab") === currentSubtab) {
      b.classList.add("active");
    } else {
      b.classList.remove("active");
    }
  });

  document.querySelectorAll(".subtab-panel").forEach((p) => (p.style.display = "none"));
  const activePanel = document.getElementById(`subtab-${currentSubtab}`);
  if (activePanel) {
    activePanel.style.display = "flex";
    activePanel.style.flexDirection = "column";
  }
}

document.querySelectorAll(".subtab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentSubtab = btn.getAttribute("data-subtab");
    updateSubtabs();

    if (currentSubtab === "inbox") {
      loadAndRenderInbox(caState.activeRole);
    }
  });
});

// SUBTAB 1: IDENTITY
function renderClientIdentity(client) {
  const genBtn = document.getElementById("btn-client-gen-key");
  const bodyIdentity = document.getElementById("body-client-identity");
  const cmdCsr = document.getElementById("cmd-client-csr");

  const btnRemoveKeyCsr = document.getElementById("btn-client-remove-key-csr");
  const btnRemoveCrt = document.getElementById("btn-client-remove-crt");

  if (btnRemoveKeyCsr) btnRemoveKeyCsr.style.display = (client.keyExists || client.csrExists) ? "inline-flex" : "none";
  if (btnRemoveCrt) btnRemoveCrt.style.display = client.crtExists ? "inline-flex" : "none";

  cmdCsr.textContent = `$ openssl ecparam -name secp256k1 -genkey -noout -out clients/${client.id}/${client.id}.key && openssl req -new -key clients/${client.id}/${client.id}.key -out clients/${client.id}/${client.id}.csr -subj "/CN=${client.name}/O=Users/C=ID"`;
  document.getElementById("client-info-cn").textContent = `CN=${client.name}`;

  if ((client.csrExists || client.crtExists) && caState.activeDetails) {
    bodyIdentity.style.display = "flex";
    bodyIdentity.style.flexDirection = "column";
    genBtn.innerHTML = `<i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i><span>${(client.keyExists || client.csrExists) ? "Re-generate Key &amp; CSR" : "Generate Key &amp; CSR"}</span>`;

    const csrBox = document.getElementById("client-csr-text")?.closest("details");
    if (client.csrExists) {
      if (csrBox) csrBox.style.display = "block";
      document.getElementById("client-csr-text").textContent =
        caState.activeDetails.csrText || caState.activeDetails.csrPem;
    } else {
      if (csrBox) csrBox.style.display = "none";
    }

    if (client.crtExists) {
      if (!client.crtValid) {
        document.getElementById("client-info-cert-status").innerHTML = `<span class="inline-flex items-center gap-1.5 text-amber-300 font-mono text-xs">⚠ Broken Chain &middot; Signed by previous Root CA (Re-sign required)</span>`;
      } else if (!client.keyExists) {
        document.getElementById("client-info-cert-status").innerHTML = `<span class="inline-flex items-center gap-1.5 text-rose-400 font-mono text-xs">⚠ Orphaned Certificate &middot; Private key is missing! Encrypted documents cannot be opened.</span>`;
      } else if (!client.keyMatchesCrt) {
        document.getElementById("client-info-cert-status").innerHTML = `<span class="inline-flex items-center gap-1.5 text-amber-300 font-mono text-xs">⚠ Key Mismatched &middot; Private key was re-generated; certificate holds old public key (Re-sign required)</span>`;
      } else {
        document.getElementById("client-info-cert-status").innerHTML = `<span class="inline-flex items-center gap-1.5 text-emerald-400 font-mono text-xs">✓ Signed &amp; Active by Root CA</span>`;
      }
      document.getElementById("client-crt-details").style.display = "block";
      document.getElementById("client-crt-text").textContent =
        caState.activeDetails.crtText || caState.activeDetails.crtPem;
      const cmdVerify = document.getElementById("cmd-client-verify");
      if (cmdVerify) {
        cmdVerify.textContent = `$ openssl verify -CAfile ca/root_ca.crt clients/${client.id}/${client.id}.crt`;
      }
      const verifySec = document.getElementById("section-client-verify");
      if (verifySec) verifySec.style.display = "block";
    } else {
      document.getElementById("client-info-cert-status").innerHTML = `<span class="inline-flex items-center gap-1.5 text-zinc-400 font-mono text-xs">Pending Signature &middot; Switch role to Admin to Sign</span>`;
      document.getElementById("client-crt-details").style.display = "none";
      const verifySec = document.getElementById("section-client-verify");
      if (verifySec) verifySec.style.display = "none";
    }
  } else {
    bodyIdentity.style.display = "none";
    const verifySec = document.getElementById("section-client-verify");
    if (verifySec) verifySec.style.display = "none";
    genBtn.innerHTML = `<i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i><span>Generate Key &amp; CSR</span>`;
  }
  if (window.lucide) window.lucide.createIcons();
  }

  document.getElementById("btn-client-gen-key").addEventListener("click", async () => {
  const activeClient = caState.clients.find((c) => c.id === caState.activeRole);
  if (!activeClient) return;

  const btn = document.getElementById("btn-client-gen-key");
  btn.innerHTML = `<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i><span>Generating...</span>`;
  if (window.lucide) window.lucide.createIcons();
  btn.disabled = true;

  try {
  const res = await fetch("/api/ca/clients", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: activeClient.id, name: activeClient.name, generateKey: true }),
  });
  const data = await res.json();
  if (data.opensslLogs) {
    data.opensslLogs.forEach((l) => logTerminal(l.command, l.output));
  }
  await syncCAState();
  } finally {
  btn.innerHTML = `<i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i><span>${activeClient.csrExists ? "Re-generate Key & CSR" : "Generate Key & CSR"}</span>`;
  if (window.lucide) window.lucide.createIcons();
  btn.disabled = false;
  }
  });

  document.getElementById("btn-client-verify-ca").addEventListener("click", async () => {
    const btn = document.getElementById("btn-client-verify-ca");
    btn.innerHTML = `<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i><span>Verifying...</span>`;
    if (window.lucide) window.lucide.createIcons();
    btn.disabled = true;

    try {
      const res = await fetch("/api/ca/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: caState.activeRole, isFake: false }),
      });
      const data = await res.json();
      if (data.opensslLog) {
        logTerminal(data.opensslLog.command, data.opensslLog.output);
      }
      const banner = document.getElementById("client-verify-banner");
      const bannerText = document.getElementById("client-verify-banner-text");
      const bannerIcon = banner.querySelector("i, svg");
      banner.style.display = "flex";

      if (!data.isValid) {
        banner.className = "rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-400 flex items-center gap-2";
        if (bannerIcon) bannerIcon.setAttribute("data-lucide", "shield-x");
        bannerText.textContent = `Verification Failed: unable to get local issuer certificate. Root CA was re-initialized; certificate needs re-signing in Admin view!`;
      } else if (!data.keyMatchesCrt) {
        banner.className = "rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300 flex items-center gap-2";
        if (bannerIcon) bannerIcon.setAttribute("data-lucide", "alert-triangle");
        bannerText.textContent = `${caState.activeRole}.crt: Valid with Root CA, BUT Key Mismatched! Your private key was re-generated; certificate holds old public key. Please ask Admin to re-sign.`;
      } else {
        banner.className = "rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-400 flex items-center gap-2";
        if (bannerIcon) bannerIcon.setAttribute("data-lucide", "check");
        bannerText.textContent = `${caState.activeRole}.crt: OK (Authentic & Validated by Root CA, Matches Private Key)`;
      }
      if (window.lucide) window.lucide.createIcons();
      await syncCAState();
    } finally {
      btn.innerHTML = `<i data-lucide="check-circle" class="w-3.5 h-3.5"></i><span>Verify with Root CA</span>`;
      if (window.lucide) window.lucide.createIcons();
      btn.disabled = false;
    }
  });

// Remove artifact buttons (key_csr or crt)
async function removeClientFile(fileType) {
  const activeClient = caState.clients.find((c) => c.id === caState.activeRole);
  if (!activeClient) return;

  const isKeyCsr = fileType === "key_csr" || fileType === "key" || fileType === "csr";
  const ok = await showConfirmModal({
    title: isKeyCsr ? "Remove Key & CSR" : "Remove Certificate",
    message: isKeyCsr
      ? `Delete ${activeClient.name}'s private key and CSR? You can regenerate them at any time.`
      : `Delete ${activeClient.name}'s issued certificate (${activeClient.id}.crt)?`,
    confirmText: isKeyCsr ? "Delete Key & CSR" : "Delete Certificate",
    cancelText: "Cancel",
    variant: "danger",
    icon: "trash-2",
  });
  if (!ok) return;

  const res = await fetch("/api/ca/client-remove-file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: activeClient.id, fileType: isKeyCsr ? "key_csr" : "crt" }),
  });
  const data = await res.json();
  if (data.opensslLog) {
    logTerminal(data.opensslLog.command, data.opensslLog.output);
  }
  await syncCAState();
}

document.getElementById("btn-client-remove-key-csr")?.addEventListener("click", () => {
  removeClientFile("key_csr");
});

document.getElementById("btn-client-remove-crt")?.addEventListener("click", () => {
  removeClientFile("crt");
});

// SUBTAB 2: SEND ENCRYPTED DOCUMENT
function renderClientSendTab(client) {
  document.getElementById("send-sender-display").value = client.name;

  // Filter other certified clients (must be valid against current Root CA)
  const eligibleRecipients = caState.clients.filter(
    (c) => c.id !== client.id && c.crtExists && c.crtValid
  );

  const warningBox = document.getElementById("no-recipients-warning");
  const sendBtn = document.getElementById("btn-client-send-doc");
  const recipSelect = document.getElementById("send-recipient-select");
  const signCheckbox = document.getElementById("send-sign-checkbox");
  const senderCertWarning = document.getElementById("sender-cert-warning");

  if (eligibleRecipients.length === 0) {
    warningBox.style.display = "flex";
    warningBox.removeAttribute("hidden");
    sendBtn.disabled = true;
    recipSelect.innerHTML = `<option value="">No valid recipient certificates</option>`;
    recipSelect.disabled = true;
    document.getElementById("cmd-client-send").textContent = "$ openssl cms (blocked: no eligible recipient)";
    return;
  }

  warningBox.style.display = "none";
  warningBox.setAttribute("hidden", "");
  recipSelect.disabled = false;
  recipSelect.innerHTML = eligibleRecipients
    .map((r) => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)} (${r.id}.crt)</option>`)
    .join("");

  // Check sender certificate requirement for digital signature
  validateSenderCertForSigning(client);
  updateSendCmdPreview();
}

function validateSenderCertForSigning(client) {
  const signCheckbox = document.getElementById("send-sign-checkbox");
  const senderCertWarning = document.getElementById("sender-cert-warning");
  const sendBtn = document.getElementById("btn-client-send-doc");

  if (signCheckbox.checked && (!client.crtExists || !client.crtValid || !client.keyMatchesCrt)) {
    senderCertWarning.style.display = "block";
    if (!client.crtExists) {
      senderCertWarning.innerHTML = `<strong>Sender Certificate Required:</strong> To attach a signature, your CSR must be signed by Root CA (${client.id}.crt).`;
    } else if (!client.crtValid) {
      senderCertWarning.innerHTML = `<strong>Sender Certificate Broken:</strong> Root CA was re-initialized. Your certificate signature is invalid and must be re-signed in Admin view before sending signed documents!`;
    } else {
      senderCertWarning.innerHTML = `<strong>Key Mismatched:</strong> Your private key was re-generated and no longer matches your certificate (${client.id}.crt). Please ask Admin to re-sign before attaching signatures!`;
    }
    sendBtn.disabled = true;
  } else {
    senderCertWarning.style.display = "none";
    sendBtn.disabled = false;
  }
}

function updateSendCmdPreview() {
  const recipId = document.getElementById("send-recipient-select").value;
  const isSigned = document.getElementById("send-sign-checkbox").checked;
  const client = caState.clients.find((c) => c.id === caState.activeRole);
  if (!recipId || !client) return;

  if (isSigned) {
    document.getElementById("cmd-client-send").textContent =
      `$ openssl cms -sign -in messages/tmp.txt -signer clients/${client.id}/${client.id}.crt -inkey clients/${client.id}/${client.id}.key -nodetach | openssl cms -encrypt -out messages/msg_${Date.now()}.enc clients/${recipId}/${recipId}.crt`;
  } else {
    document.getElementById("cmd-client-send").textContent =
      `$ openssl cms -encrypt -in messages/tmp.txt -out messages/msg_${Date.now()}.enc clients/${recipId}/${recipId}.crt`;
  }
}

document.getElementById("send-recipient-select").addEventListener("change", updateSendCmdPreview);
document.getElementById("send-sign-checkbox").addEventListener("change", () => {
  const client = caState.clients.find((c) => c.id === caState.activeRole);
  if (client) validateSenderCertForSigning(client);
  updateSendCmdPreview();
});

document.getElementById("btn-client-send-doc").addEventListener("click", async () => {
  const senderId = caState.activeRole;
  const recipientId = document.getElementById("send-recipient-select").value;
  const title = document.getElementById("send-doc-title").value.trim() || "Confidential Document";
  const message = document.getElementById("send-doc-message").value.trim();
  const isSigned = document.getElementById("send-sign-checkbox").checked;

  if (!recipientId) {
    await showAlertModal("Recipient Required", "Please choose a valid recipient to send the encrypted document.", "alert-triangle");
    return;
  }
  if (!message) {
    await showAlertModal("Message Required", "Please enter a document message to encrypt before sending.", "alert-triangle");
    return;
  }

  const btn = document.getElementById("btn-client-send-doc");
  btn.innerHTML = `<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i><span>Encrypting &amp; Sending...</span>`;
  if (window.lucide) window.lucide.createIcons();
  btn.disabled = true;

  try {
    const res = await fetch("/api/ca/send-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senderId, recipientId, title, message, isSigned }),
    });
    const data = await res.json();

    if (!res.ok) {
      await showAlertModal("Send Failed", data.error || "Failed to send message", "shield-alert");
      return;
    }

    if (data.opensslLog) {
      logTerminal(data.opensslLog.command, data.opensslLog.output);
    }

    const successBanner = document.getElementById("send-success-banner");
    const successText = document.getElementById("send-success-text");
    successBanner.style.display = "flex";
    successText.textContent = isSigned
      ? `✓ Document digitally signed and delivered to ${data.message.recipientName}'s Inbox! Switch role to ${data.message.recipientName} to open it.`
      : `✓ Document encrypted and delivered to ${data.message.recipientName}'s Inbox! Switch role to ${data.message.recipientName} to open it.`;

    await syncCAState();
  } finally {
    btn.innerHTML = `<i data-lucide="send" class="w-3.5 h-3.5"></i><span>Encrypt &amp; Send</span>`;
    if (window.lucide) window.lucide.createIcons();
    btn.disabled = false;
  }
});

// ============================================================================
// SUBTAB 3: INBOX CONTROLLER
// ============================================================================
async function loadAndRenderInbox(clientId) {
  const container = document.getElementById("inbox-list");
  container.innerHTML = `<div class="hint-text">Loading inbox...</div>`;

  try {
    const res = await fetch(`/api/ca/inbox?clientId=${clientId}`);
    const data = await res.json();
    const messages = data.messages || [];

    if (messages.length === 0) {
      container.innerHTML = `
        <div class="p-8 text-center space-y-2">
          <div class="w-10 h-10 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-500">
            <i data-lucide="inbox" class="w-5 h-5"></i>
          </div>
          <div class="text-xs text-zinc-300 font-medium">Your inbox is empty</div>
          <p class="text-[11px] text-zinc-500 max-w-xs mx-auto">
            When another client sends you an encrypted document, it will appear here.
          </p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    container.innerHTML = messages
      .map((m) => {
        const timeStr = new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const sigBadge = m.isSigned
          ? `<span class="sig-badge-verified"><i data-lucide="shield-check" class="w-3 h-3 inline-block mr-1"></i>Digitally Signed</span>`
          : `<span class="sig-badge-unsigned">Unsigned</span>`;

        return `
          <div class="inbox-item-card" id="msg-card-${escapeHtml(m.id)}">
            <div class="inbox-item-head">
              <div style="display:flex; align-items:center; gap:8px;">
                <span class="inbox-sender-tag">From: ${escapeHtml(m.senderName)}</span>
                ${sigBadge}
                <span class="inbox-time">${timeStr}</span>
              </div>
              <button class="btn-ghost btn-sm btn-danger-hover btn-del-msg" data-id="${escapeHtml(m.id)}">Delete</button>
            </div>

            <div class="inbox-title">${escapeHtml(m.title)}</div>

            <div class="inbox-cipher-preview">
              <span class="text-xs font-semibold text-zinc-200 flex items-center gap-1.5 mb-1"><i data-lucide="lock" class="w-3.5 h-3.5 text-zinc-400"></i>Encrypted Envelope (${m.ciphertextSize} bytes):</span>
              ${escapeHtml(m.ciphertextBase64Preview)}
            </div>

            <!-- Interception Attack Warning Banner -->
            <div class="result-banner invalid msg-attack-banner" id="attack-banner-${escapeHtml(m.id)}" style="display: none; margin-top: 4px;">
              <span class="res-icon">✕</span>
              <span class="res-text">Access Denied! OpenSSL cipher operation failed. Mallory's key cannot unlock your mail!</span>
            </div>

            <!-- Tampering Attack Warning Banner -->
            <div class="result-banner invalid msg-tamper-banner" id="tamper-banner-${escapeHtml(m.id)}" style="display: none; margin-top: 4px;">
              <span class="res-icon">✕</span>
              <span class="res-text" id="tamper-text-${escapeHtml(m.id)}">Tampering Detected! OpenSSL verification failure: digest failure.</span>
            </div>

            <!-- Legitimate Plaintext Box -->
            <div class="inbox-plaintext-result msg-plain-box" id="plain-box-${escapeHtml(m.id)}" style="display: none;">
              <div id="sig-ver-badge-${escapeHtml(m.id)}" class="sig-meta-box" style="display: none;">
                <span class="sig-badge-verified"><i data-lucide="check-circle" class="w-3 h-3 inline-block mr-1"></i>Signature Authenticated: CN=${escapeHtml(m.senderName)} (Validated by Root CA)</span>
              </div>
              <div class="text-xs text-emerald-400 font-semibold mb-1 flex items-center gap-1">
                <i data-lucide="check" class="w-3.5 h-3.5"></i>
                <span>Decrypted with ${escapeHtml(m.recipientId)}.key:</span>
              </div>
              <div class="mono-display msg-plain-text" id="plain-text-${escapeHtml(m.id)}">-</div>
            </div>

            <div class="inbox-actions">
              <button class="btn-solid btn-sm btn-decrypt-legit inline-flex items-center gap-1.5" data-id="${escapeHtml(m.id)}" data-recip="${escapeHtml(m.recipientId)}">
                <i data-lucide="key" class="w-3.5 h-3.5"></i>
                <span>Decrypt with Private Key</span>
              </button>
              <button class="btn-outline btn-sm btn-danger-action btn-test-mallory inline-flex items-center gap-1.5" data-id="${escapeHtml(m.id)}" data-recip="${escapeHtml(m.recipientId)}">
                <i data-lucide="shield-alert" class="w-3.5 h-3.5"></i>
                <span>Test Interception (Mallory)</span>
              </button>
              ${
                m.isSigned
                  ? `<button class="btn-outline btn-sm btn-danger-action btn-test-tamper inline-flex items-center gap-1.5" id="btn-tamper-${escapeHtml(m.id)}" data-id="${escapeHtml(m.id)}" data-recip="${escapeHtml(m.recipientId)}" style="display: none;">
                      <i data-lucide="alert-triangle" class="w-3.5 h-3.5"></i>
                      <span>Test Tamper / Forged Signature</span>
                    </button>`
                  : ""
              }
            </div>
          </div>
        `;
      })
      .join("");

    // Wire up buttons on each message card
    container.querySelectorAll(".btn-decrypt-legit").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const messageId = btn.getAttribute("data-id");
        const recipientId = btn.getAttribute("data-recip");
        btn.textContent = "Decrypting...";
        btn.disabled = true;

        try {
          const r = await fetch("/api/ca/decrypt-inbox-message", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messageId, keyId: recipientId, recipientId }),
          });
          const result = await r.json();

          if (result.opensslLog) {
            logTerminal(result.opensslLog.command, result.opensslLog.output);
          }

          if (result.success) {
            const plainBox = document.getElementById(`plain-box-${messageId}`);
            const plainText = document.getElementById(`plain-text-${messageId}`);
            const sigBadgeEl = document.getElementById(`sig-ver-badge-${messageId}`);
            const tamperBtn = document.getElementById(`btn-tamper-${messageId}`);

            plainText.textContent = result.plaintext;
            plainBox.style.display = "block";

            if (result.isSigned && result.signatureValid && sigBadgeEl) {
              sigBadgeEl.style.display = "flex";
            }
            if (tamperBtn) {
              tamperBtn.style.display = "inline-flex";
            }
          } else {
            await showAlertModal("Decryption Failed", result.error || "Unable to decrypt message", "shield-alert");
          }
        } finally {
          btn.innerHTML = `<i data-lucide="key" class="w-3.5 h-3.5"></i><span>Decrypt with Private Key</span>`;
          if (window.lucide) window.lucide.createIcons();
          btn.disabled = false;
        }
      });
    });

    container.querySelectorAll(".btn-test-tamper").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const messageId = btn.getAttribute("data-id");
        const recipientId = btn.getAttribute("data-recip");
        btn.textContent = "Testing Tamper...";
        btn.disabled = true;

        try {
          const r = await fetch("/api/ca/tamper-inbox-message", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messageId, recipientId }),
          });
          const result = await r.json();

          if (result.opensslLog) {
            logTerminal(result.opensslLog.command, result.opensslLog.output);
          }

          const tamperBanner = document.getElementById(`tamper-banner-${messageId}`);
          const tamperText = document.getElementById(`tamper-text-${messageId}`);
          tamperBanner.style.display = "flex";
          tamperText.textContent = `Tampering Detected! OpenSSL Error: digest failure. The digital signature does not match the altered content!`;
        } finally {
          btn.innerHTML = `<i data-lucide="alert-triangle" class="w-3.5 h-3.5"></i><span>Test Tamper / Forged Signature</span>`;
          if (window.lucide) window.lucide.createIcons();
          btn.disabled = false;
        }
      });
    });

    container.querySelectorAll(".btn-test-mallory").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const messageId = btn.getAttribute("data-id");
        const recipientId = btn.getAttribute("data-recip");
        btn.textContent = "Testing...";
        btn.disabled = true;

        try {
          const r = await fetch("/api/ca/decrypt-inbox-message", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messageId, keyId: "mallory", recipientId }),
          });
          const result = await r.json();

          if (result.opensslLog) {
            logTerminal(result.opensslLog.command, result.opensslLog.output);
          }

          const attackBanner = document.getElementById(`attack-banner-${messageId}`);
          attackBanner.style.display = "flex";
        } finally {
          btn.innerHTML = `<i data-lucide="shield-alert" class="w-3.5 h-3.5"></i><span>Test Interception (Mallory)</span>`;
          if (window.lucide) window.lucide.createIcons();
          btn.disabled = false;
        }
      });
    });

    container.querySelectorAll(".btn-del-msg").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const messageId = btn.getAttribute("data-id");
        await fetch(`/api/ca/inbox-message/${messageId}`, { method: "DELETE" });
        await syncCAState();
      });
    });
  } catch (err) {
    console.error("Failed to load inbox:", err);
    container.innerHTML = `<div class="hint-text" style="color:var(--danger)">Failed to load inbox messages.</div>`;
  }
}

document.getElementById("btn-refresh-inbox").addEventListener("click", async () => {
  const btn = document.getElementById("btn-refresh-inbox");
  btn.innerHTML = `<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i><span>Refreshing...</span>`;
  if (window.lucide) window.lucide.createIcons();
  btn.disabled = true;
  try {
    await loadAndRenderInbox(caState.activeRole);
  } finally {
    btn.innerHTML = `<i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i><span>Refresh</span>`;
    if (window.lucide) window.lucide.createIcons();
    btn.disabled = false;
  }
});

// ============================================================================
// RESET ALL
// ============================================================================
document.getElementById("btn-ca-reset").addEventListener("click", async () => {
  const ok = await showConfirmModal({
    title: "Reset CA Lab",
    message: "Wipe all generated CA keys, client certificates, and inboxes to start completely from zero? This action cannot be undone.",
    confirmText: "Wipe All Data",
    cancelText: "Cancel",
    variant: "danger",
    icon: "rotate-ccw",
  });
  if (!ok) return;

  await fetch("/api/ca/reset", { method: "POST" });
  logTerminal("reset", "All CA certificates, keys, and client inboxes wiped. Clean slate.");
  await syncCAState();
});

// Initialize on page load
syncCAState();
