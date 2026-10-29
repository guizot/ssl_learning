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

// OpenSSL Command & Execution Output Section Renderer
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
// CUSTOM ROLE SELECTOR DROPDOWN & CRUD
// ============================================================================
function renderRoleSelector() {
  const activeLabel = document.getElementById("role-active-label");
  const itemsContainer = document.getElementById("role-dropdown-items");
  const activeDot = document.getElementById("role-active-dot");
  if (!itemsContainer) return;

  const isAdmin = caState.activeRole === "admin";
  let activeText = "Admin (Root CA)";

  if (activeDot) {
    if (isAdmin) {
      activeDot.className = caState.rootCaExists
        ? "w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0"
        : "w-2 h-2 rounded-full bg-zinc-600 shrink-0";
    } else {
      const curClient = (caState.clients || []).find((c) => c.id === caState.activeRole);
      if (curClient && curClient.crtExists && curClient.crtValid && curClient.keyMatchesCrt) {
        activeDot.className = "w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0";
      } else if (curClient && curClient.crtExists && !curClient.keyExists) {
        activeDot.className = "w-2 h-2 rounded-full bg-rose-500 shrink-0";
      } else if (curClient && curClient.crtExists) {
        activeDot.className = "w-2 h-2 rounded-full bg-amber-500 shrink-0";
      } else {
        activeDot.className = "w-2 h-2 rounded-full bg-zinc-500 shrink-0";
      }
    }
  }

  let itemsHtml = `
    <button type="button" class="role-option-item w-full flex items-center justify-between px-3 py-2.5 sm:px-2.5 sm:py-1.5 rounded-md transition-colors text-left cursor-pointer ${
      isAdmin
        ? "bg-zinc-800/70 text-zinc-100 font-medium"
        : "text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
    }" data-role="admin">
      <div class="flex items-center gap-2.5 min-w-0">
        <div class="w-6 h-6 rounded-md bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-300 shrink-0">
          <i data-lucide="shield" class="w-3.5 h-3.5"></i>
        </div>
        <div class="min-w-0">
          <div class="text-xs font-medium text-zinc-100 truncate">Admin (Root CA)</div>
          <div class="text-[10px] text-zinc-500 font-mono truncate">Master Authority</div>
        </div>
      </div>
      ${isAdmin ? `<i data-lucide="check" class="w-3.5 h-3.5 text-emerald-400 shrink-0"></i>` : ""}
    </button>
  `;

  if (caState.clients && caState.clients.length > 0) {
    itemsHtml += `
      <div class="my-1 border-t border-zinc-800/60"></div>
      <div class="px-2.5 py-1 text-[10px] font-mono uppercase font-bold text-zinc-500">Registered Clients</div>
    `;

    caState.clients.forEach((c) => {
      const isClientActive = caState.activeRole === c.id;
      const initial = (c.name || "C").charAt(0).toUpperCase();
      let statusBadge = "";
      if (c.crtExists) {
        if (!c.crtValid) {
          statusBadge = `<span class="text-[10px] font-mono text-amber-400">CA Mismatch</span>`;
        } else if (!c.keyExists) {
          statusBadge = `<span class="text-[10px] font-mono text-rose-400">Orphaned</span>`;
        } else if (!c.keyMatchesCrt) {
          statusBadge = `<span class="text-[10px] font-mono text-amber-400">Key Mismatch</span>`;
        } else {
          statusBadge = `<span class="text-[10px] font-mono text-emerald-400">✓ Issued</span>`;
        }
      } else if (c.csrExists) {
        statusBadge = `<span class="text-[10px] font-mono text-zinc-400">CSR Ready</span>`;
      } else {
        statusBadge = `<span class="text-[10px] font-mono text-zinc-500">Pending</span>`;
      }

      if (isClientActive) {
        let certTag = "pending";
        if (c.crtExists) {
          if (!c.crtValid) certTag = "ca mismatch";
          else if (!c.keyExists) certTag = "orphaned";
          else if (!c.keyMatchesCrt) certTag = "key mismatch";
          else certTag = "✓";
        }
        activeText = `${c.name} (${certTag})`;
      }

      itemsHtml += `
        <button type="button" class="role-option-item w-full flex items-center justify-between px-3 py-2.5 sm:px-2.5 sm:py-1.5 rounded-md transition-colors text-left cursor-pointer ${
          isClientActive
            ? "bg-zinc-800/70 text-zinc-100 font-medium"
            : "text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
        }" data-role="${escapeHtml(c.id)}">
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="w-6 h-6 rounded-md bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xs font-semibold text-zinc-200 shrink-0">
              ${escapeHtml(initial)}
            </div>
            <div class="min-w-0">
              <div class="text-xs font-medium text-zinc-100 truncate">${escapeHtml(c.name)}</div>
              <div class="text-[10px] font-mono text-zinc-500 truncate">id: ${escapeHtml(c.id)} · ${statusBadge}</div>
            </div>
          </div>
          ${isClientActive ? `<i data-lucide="check" class="w-3.5 h-3.5 text-emerald-400 shrink-0"></i>` : ""}
        </button>
      `;
    });
  }

  if (activeLabel) {
    activeLabel.textContent = activeText;
  }
  itemsContainer.innerHTML = itemsHtml;
  if (window.lucide) window.lucide.createIcons();
}

// Custom Role Dropdown Toggle & Listeners
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

if (roleTrigger) {
  roleTrigger.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleRoleDropdown();
  });
}

document.addEventListener("click", (e) => {
  const container = document.getElementById("role-dropdown-container");
  if (container && !container.contains(e.target)) {
    toggleRoleDropdown(false);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    toggleRoleDropdown(false);
  }
});

document.getElementById("role-dropdown-items")?.addEventListener("click", async (e) => {
  const btn = e.target.closest(".role-option-item");
  if (!btn) return;
  const selectedRole = btn.getAttribute("data-role");
  toggleRoleDropdown(false);

  await fetch("/api/ca/select-role", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: selectedRole }),
  });
  await syncCAState();
});

document.getElementById("role-dropdown-add-client")?.addEventListener("click", (e) => {
  toggleRoleDropdown(false);
  openAddClientModal();
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
    document.getElementById("admin-ca-key-pem").textContent = caState.rootCa.keyPem || "No private key";
    document.getElementById("admin-ca-pub-pem").textContent = caState.rootCa.pubKeyPem || "No public key";
    document.getElementById("admin-ca-pem").textContent = caState.rootCa.certPem || "No certificate";
    document.getElementById("admin-ca-text").textContent = caState.rootCa.fullText || "No decoded certificate";
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
          Click <strong>'Add new client...'</strong> below to register your first client (e.g. Alice, Bob, or a domain).
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
        : `<span class="status-pill none">None</span>`;

      const csrBadge = c.csrExists
        ? `<span class="status-pill signed">✓ Ready</span>`
        : `<span class="status-pill none">None</span>`;

      const crtBadge = c.crtExists
        ? !c.crtValid
          ? `<span class="status-pill border border-amber-500/40 bg-amber-500/10 text-amber-300">⚠ CA Mismatch</span>`
          : !c.keyExists
          ? `<span class="status-pill border border-rose-500/40 bg-rose-500/10 text-rose-400">⚠ Orphaned</span>`
          : !c.keyMatchesCrt
          ? `<span class="status-pill border border-amber-500/40 bg-amber-500/10 text-amber-300">⚠ Key Mismatch</span>`
          : `<span class="status-pill signed">✓ Issued</span>`
        : `<span class="status-pill none">Pending</span>`;

      let actionBtn = "";
      if (c.crtExists) {
        if (!c.csrExists) {
          actionBtn = `
            <div class="flex-1 sm:flex-initial sm:w-36 h-9 sm:h-8 flex items-center justify-center px-3 rounded-lg border border-dashed border-rose-900/50 bg-rose-950/20 text-[11px] font-mono text-rose-400 text-center">Orphaned (No CSR)</div>
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
          <div class="flex-1 sm:flex-initial sm:w-36 h-9 sm:h-8 flex items-center justify-center px-3 rounded-lg border border-dashed border-zinc-800 text-[11px] font-mono text-zinc-500 text-center">Awaiting CSR</div>
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

        if (res.ok && data.success) {
          renderCmdOutput("cmd-details-admin-sign", "cmd-code-admin-sign", {
            commands: [
              `openssl x509 -req -in clients/${id}/${id}.csr -CA ca/root_ca.crt -CAkey ca/root_ca.key -CAcreateserial -out clients/${id}/${id}.crt -days 365 -sha256`
            ],
            outputs: [
              `[✓ Success] Certificate successfully issued for ${id}!`,
              `Signed by: CN=MyRootCA (Master Root CA)`,
              `Output Certificate: clients/${id}/${id}.crt (Valid 365 days)`
            ],
            status: "success",
          });
        } else {
          renderCmdOutput("cmd-details-admin-sign", "cmd-code-admin-sign", {
            commands: [`openssl x509 -req -in clients/${id}/${id}.csr -CA ca/root_ca.crt -CAkey ca/root_ca.key -CAcreateserial -out clients/${id}/${id}.crt -days 365 -sha256`],
            outputs: [`[✕ Signing Failed] ${data.error || "Unable to issue certificate"}`],
            status: "error",
          });
        }
      } catch (err) {
        renderCmdOutput("cmd-details-admin-sign", "cmd-code-admin-sign", {
          commands: [`openssl x509 -req -in clients/${id}/${id}.csr ...`],
          outputs: [`[✕ Error] ${err.message}`],
          status: "error",
        });
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

    if (res.ok && data.success) {
      renderCmdOutput("cmd-details-admin-root", "cmd-code-admin-root", {
        commands: [
          "openssl ecparam -name secp256k1 -genkey -noout -out ca/root_ca.key",
          'openssl req -new -x509 -key ca/root_ca.key -out ca/root_ca.crt -days 365 -subj "/CN=MyRootCA/O=GlobalTrustAuthority/C=ID"'
        ],
        outputs: [
          "[✓ Success] Root CA initialized successfully!",
          "Identity: CN=MyRootCA, O=GlobalTrustAuthority, C=ID",
          "Algorithm: secp256k1 (256-bit Elliptic Curve)",
          "Status: Master Trust Anchor is active and ready to sign client CSRs."
        ],
        status: "success",
      });
    } else {
      renderCmdOutput("cmd-details-admin-root", "cmd-code-admin-root", {
        commands: ['openssl req -new -x509 -key ca/root_ca.key -out ca/root_ca.crt -days 365 -subj "/CN=MyRootCA/O=GlobalTrustAuthority/C=ID"'],
        outputs: [`[✕ Failed] ${data.error || "Root CA initialization failed"}`],
        status: "error",
      });
    }
  } catch (err) {
    renderCmdOutput("cmd-details-admin-root", "cmd-code-admin-root", {
      commands: ['openssl req -new -x509 ...'],
      outputs: [`[✕ Error] ${err.message}`],
      status: "error",
    });
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
    renderCmdOutput("cmd-details-admin-fake", "cmd-code-admin-fake", {
      commands: [`openssl verify -CAfile ca/root_ca.crt clients/...`],
      outputs: [`[✕ Error] No clients registered yet. Please create at least one client before simulating a fake CA attack.`],
      status: "error",
    });
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

    renderCmdOutput("cmd-details-admin-fake", "cmd-code-admin-fake", {
      commands: [
        `openssl verify -CAfile ca/root_ca.crt clients/${targetClient.id}/fake_${targetClient.id}.crt`
      ],
      outputs: [
        `[✕ Verification Failed - Expected Security Attack Blocked]`,
        data.opensslLog ? data.opensslLog.output : "error 20 at 0 depth lookup: unable to get local issuer certificate",
        `OpenSSL successfully rejected untrusted CA! Rogue attacker certificates cannot breach the trusted Root chain.`
      ],
      status: "error",
    });
  } catch (err) {
    renderCmdOutput("cmd-details-admin-fake", "cmd-code-admin-fake", {
      commands: [`openssl verify -CAfile ca/root_ca.crt clients/...`],
      outputs: [`[✕ Error] ${err.message}`],
      status: "error",
    });
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
      fsCrt.textContent = "orphaned";
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
    fsCrt.textContent = "none";
    fsCrt.className = "f-state text-zinc-500 text-[11px]";
  }

  // Update Inbox and Sent Tab Badge Counts
  document.getElementById("inbox-tab-count").textContent = String(activeClient.inboxCount || 0);
  const sentTabCount = document.getElementById("sent-tab-count");
  if (sentTabCount) sentTabCount.textContent = String(activeClient.sentCount || 0);

  // Update active subtab highlighting and panel visibility
  updateSubtabs();

  // Render Subtab Panels
  renderClientIdentity(activeClient);
  renderClientSendTab(activeClient);
  if (currentSubtab === "inbox") {
    loadAndRenderInbox(activeClient.id);
  } else if (currentSubtab === "send") {
    loadAndRenderSent(activeClient.id);
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
    } else if (currentSubtab === "send") {
      loadAndRenderSent(caState.activeRole);
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
  const removeActions = document.getElementById("client-remove-actions");

  const showKeyCsr = Boolean(client.keyExists || client.csrExists);
  const showCrt = Boolean(client.crtExists);

  if (btnRemoveKeyCsr) btnRemoveKeyCsr.style.display = showKeyCsr ? "inline-flex" : "none";
  if (btnRemoveCrt) btnRemoveCrt.style.display = showCrt ? "inline-flex" : "none";
  if (removeActions) removeActions.style.display = (showKeyCsr || showCrt) ? "flex" : "none";

  if (cmdCsr && (!cmdCsr.getAttribute("data-has-output") || cmdCsr.getAttribute("data-client-id") !== client.id)) {
    cmdCsr.setAttribute("data-client-id", client.id);
    cmdCsr.removeAttribute("data-has-output");
    cmdCsr.textContent = `$ openssl ecparam -name secp256k1 -genkey -noout -out clients/${client.id}/${client.id}.key && openssl req -new -key clients/${client.id}/${client.id}.key -out clients/${client.id}/${client.id}.csr -subj "/CN=${client.name}/O=Users/C=ID"`;
  }
  document.getElementById("client-info-cn").textContent = `CN=${client.name}`;

  if ((client.keyExists || client.csrExists || client.crtExists) && caState.activeDetails) {
    bodyIdentity.style.display = "flex";
    bodyIdentity.style.flexDirection = "column";
    genBtn.innerHTML = `<i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i><span>${(client.keyExists || client.csrExists) ? "Re-generate Key &amp; CSR" : "Generate Key &amp; CSR"}</span>`;

    // 1. Private Key & Public Key
    const keyBox = document.getElementById("client-details-key");
    const pubBox = document.getElementById("client-details-pub");
    if (client.keyExists) {
      if (keyBox) keyBox.style.display = "block";
      if (pubBox) pubBox.style.display = "block";
      document.getElementById("client-key-pem").textContent = caState.activeDetails.keyPem || "No private key";
      document.getElementById("client-pub-pem").textContent = caState.activeDetails.pubKeyPem || "No public key";
    } else {
      if (keyBox) keyBox.style.display = "none";
      if (pubBox) pubBox.style.display = "none";
    }

    // 2. CSR PEM & CSR Text
    const csrPemBox = document.getElementById("client-details-csr-pem");
    const csrTextBox = document.getElementById("client-details-csr-text");
    if (client.csrExists) {
      if (csrPemBox) csrPemBox.style.display = "block";
      if (csrTextBox) csrTextBox.style.display = "block";
      document.getElementById("client-csr-pem").textContent = caState.activeDetails.csrPem || "No CSR PEM";
      document.getElementById("client-csr-text").textContent =
        caState.activeDetails.csrText || caState.activeDetails.csrPem;
    } else {
      if (csrPemBox) csrPemBox.style.display = "none";
      if (csrTextBox) csrTextBox.style.display = "none";
    }

    // 3. CRT PEM & CRT Text
    const crtPemBox = document.getElementById("client-details-crt-pem");
    const crtTextBox = document.getElementById("client-details-crt-text");
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

      if (crtPemBox) crtPemBox.style.display = "block";
      if (crtTextBox) crtTextBox.style.display = "block";
      document.getElementById("client-crt-pem").textContent = caState.activeDetails.crtPem || "No CRT PEM";
      document.getElementById("client-crt-text").textContent =
        caState.activeDetails.crtText || caState.activeDetails.crtPem;

      const cmdVerify = document.getElementById("cmd-client-verify");
      if (cmdVerify && (!cmdVerify.getAttribute("data-has-output") || cmdVerify.getAttribute("data-client-id") !== client.id)) {
        cmdVerify.setAttribute("data-client-id", client.id);
        cmdVerify.removeAttribute("data-has-output");
        cmdVerify.textContent = `$ openssl verify -CAfile ca/root_ca.crt clients/${client.id}/${client.id}.crt`;
      }
      const verifySec = document.getElementById("section-client-verify");
      if (verifySec) verifySec.style.display = "block";
    } else {
      document.getElementById("client-info-cert-status").innerHTML = `<span class="inline-flex items-center gap-1.5 text-zinc-400 font-mono text-xs">Pending Signature &middot; Switch role to Admin to Sign</span>`;
      if (crtPemBox) crtPemBox.style.display = "none";
      if (crtTextBox) crtTextBox.style.display = "none";
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

  if (res.ok && data.success) {
    renderCmdOutput("cmd-details-client-csr", "cmd-client-csr", {
      commands: [
        `openssl ecparam -name secp256k1 -genkey -noout -out clients/${activeClient.id}/${activeClient.id}.key`,
        `openssl req -new -key clients/${activeClient.id}/${activeClient.id}.key -out clients/${activeClient.id}/${activeClient.id}.csr -subj "/CN=${activeClient.name}/O=Users/C=ID"`
      ],
      outputs: [
        `[✓ Success] Keypair and CSR generated successfully for ${activeClient.name}!`,
        `Private Key: clients/${activeClient.id}/${activeClient.id}.key (secp256k1 EC 256-bit)`,
        `CSR: clients/${activeClient.id}/${activeClient.id}.csr (Subject: CN=${activeClient.name})`,
        `Next Step: Switch role to Admin to sign and issue certificate.`
      ],
      status: "success",
    });
  } else {
    renderCmdOutput("cmd-details-client-csr", "cmd-client-csr", {
      commands: [`openssl ecparam ... && openssl req ...`],
      outputs: [`[✕ Generation Failed] ${data.error || "Unable to generate key and CSR"}`],
      status: "error",
    });
  }
  } catch (err) {
    renderCmdOutput("cmd-details-client-csr", "cmd-client-csr", {
      commands: [`openssl ecparam ...`],
      outputs: [`[✕ Error] ${err.message}`],
      status: "error",
    });
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

      const verifyCmd = `openssl verify -CAfile ca/root_ca.crt clients/${caState.activeRole}/${caState.activeRole}.crt`;

      await syncCAState();

      if (!data.isValid) {
        renderCmdOutput("cmd-details-client-verify", "cmd-client-verify", {
          commands: [verifyCmd],
          outputs: [
            `[✕ Verification Failed]`,
            data.opensslLog ? data.opensslLog.output : "error 20 at 0 depth lookup: unable to get local issuer certificate",
            `Root CA was re-initialized; certificate needs re-signing in Admin view!`
          ],
          status: "error",
        });
      } else if (!data.keyMatchesCrt) {
        renderCmdOutput("cmd-details-client-verify", "cmd-client-verify", {
          commands: [
            verifyCmd,
            `openssl pkey -in clients/${caState.activeRole}/${caState.activeRole}.key -pubout`,
            `openssl x509 -in clients/${caState.activeRole}/${caState.activeRole}.crt -pubkey -noout`
          ],
          outputs: [
            `[⚠ Key Mismatched]`,
            `Certificate is verified by Root CA, but public key in certificate does NOT match your local private key!`,
            `Please ask Admin to re-sign certificate with your updated CSR.`
          ],
          status: "warning",
        });
      } else {
        renderCmdOutput("cmd-details-client-verify", "cmd-client-verify", {
          commands: [verifyCmd],
          outputs: [
            `[✓ Verified OK]`,
            `clients/${caState.activeRole}/${caState.activeRole}.crt: OK`,
            `Authentic & Validated by Root CA (secp256k1 key matches certificate)`
          ],
          status: "success",
        });
      }
      if (window.lucide) window.lucide.createIcons();
    } catch (err) {
      renderCmdOutput("cmd-details-client-verify", "cmd-client-verify", {
        commands: [`openssl verify -CAfile ca/root_ca.crt clients/${caState.activeRole}/${caState.activeRole}.crt`],
        outputs: [`[✕ Error] ${err.message}`],
        status: "error",
      });
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

  if (res.ok && data.success) {
    renderCmdOutput("cmd-details-client-csr", "cmd-client-csr", {
      commands: [`rm -f clients/${activeClient.id}/${activeClient.id}.${isKeyCsr ? "{key,csr}" : "crt"}`],
      outputs: [
        `[✓ Success] File(s) removed: ${data.removedFiles ? data.removedFiles.join(", ") : fileType}`
      ],
      status: "warning",
    });
  }
}

document.getElementById("btn-client-remove-key-csr")?.addEventListener("click", () => {
  removeClientFile("key_csr");
});

document.getElementById("btn-client-remove-crt")?.addEventListener("click", () => {
  removeClientFile("crt");
});

// SUBTAB 2: SEND ENCRYPTED DOCUMENT
function renderClientSendTab(client) {
  // Filter other certified clients (must be valid against current Root CA)
  const eligibleRecipients = caState.clients.filter(
    (c) => c.id !== client.id && c.crtExists && c.crtValid
  );

  const warningBox = document.getElementById("no-recipients-warning");
  const sendBtn = document.getElementById("btn-client-send-doc");
  const recipSelect = document.getElementById("send-recipient-select");
  const recipTrigger = document.getElementById("recipient-dropdown-trigger");
  const recipLabel = document.getElementById("recipient-selected-label");
  const recipItemsContainer = document.getElementById("recipient-dropdown-items");

  if (eligibleRecipients.length === 0) {
    warningBox.style.display = "flex";
    warningBox.removeAttribute("hidden");
    sendBtn.disabled = true;
    if (recipSelect) recipSelect.value = "";
    if (recipLabel) recipLabel.textContent = "No valid recipient certificates";
    if (recipTrigger) recipTrigger.disabled = true;
    if (recipItemsContainer) recipItemsContainer.innerHTML = "";
    document.getElementById("cmd-client-send").textContent = "$ openssl cms (blocked: no eligible recipient)";
    return;
  }

  warningBox.style.display = "none";
  warningBox.setAttribute("hidden", "");
  if (recipTrigger) recipTrigger.disabled = false;

  let currentVal = recipSelect ? recipSelect.value : "";
  if (!currentVal || !eligibleRecipients.some((r) => r.id === currentVal)) {
    currentVal = eligibleRecipients[0].id;
    if (recipSelect) recipSelect.value = currentVal;
  }

  const selectedRecip = eligibleRecipients.find((r) => r.id === currentVal) || eligibleRecipients[0];
  if (recipLabel) {
    recipLabel.textContent = `${selectedRecip.name} (${selectedRecip.id}.crt)`;
  }

  if (recipItemsContainer) {
    recipItemsContainer.innerHTML = eligibleRecipients
      .map((r) => {
        const isRecipientActive = currentVal === r.id;
        const initial = (r.name || "C").charAt(0).toUpperCase();
        return `
          <button type="button" class="recipient-option-item w-full flex items-center justify-between px-3 py-2 sm:px-2.5 sm:py-1.5 rounded-md transition-colors text-left cursor-pointer ${
            isRecipientActive
              ? "bg-zinc-800/70 text-zinc-100 font-medium"
              : "text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
          }" data-recip-id="${escapeHtml(r.id)}" data-recip-label="${escapeHtml(r.name)} (${escapeHtml(r.id)}.crt)">
            <div class="flex items-center gap-2.5 min-w-0">
              <div class="w-6 h-6 rounded-md bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xs font-semibold text-zinc-200 shrink-0">
                ${escapeHtml(initial)}
              </div>
              <div class="min-w-0">
                <div class="text-xs font-medium text-zinc-100 truncate">${escapeHtml(r.name)}</div>
                <div class="text-[10px] font-mono text-zinc-500 truncate">${escapeHtml(r.id)}.crt</div>
              </div>
            </div>
            ${isRecipientActive ? `<i data-lucide="check" class="w-3.5 h-3.5 text-emerald-400 shrink-0"></i>` : ""}
          </button>
        `;
      })
      .join("");
  }

  // Check sender certificate requirement for digital signature
  validateSenderCertForSigning(client);

  const cmdSendEl = document.getElementById("cmd-client-send");
  if (cmdSendEl && (!cmdSendEl.getAttribute("data-has-output") || cmdSendEl.getAttribute("data-client-id") !== client.id)) {
    cmdSendEl.setAttribute("data-client-id", client.id);
    cmdSendEl.removeAttribute("data-has-output");
    updateSendCmdPreview();
  }

  if (window.lucide) window.lucide.createIcons();
}

function validateSenderCertForSigning(client) {
  const signCheckbox = document.getElementById("send-sign-checkbox");
  const senderCertWarning = document.getElementById("sender-cert-warning");
  const sendContainer = document.getElementById("send-sign-container");
  const sendBtn = document.getElementById("btn-client-send-doc");

  const hasIssue = !client.crtExists || !client.crtValid || !client.keyMatchesCrt;

  if (signCheckbox && signCheckbox.checked && hasIssue) {
    if (sendContainer) {
      sendContainer.className = "rounded-lg bg-amber-500/10 border border-amber-500/40 p-3 space-y-1.5 transition-colors";
    }
    if (senderCertWarning) {
      senderCertWarning.style.display = "block";
      if (!client.crtExists) {
        senderCertWarning.innerHTML = `<strong>Sender Certificate Required:</strong> To attach a signature, your CSR must be signed by Root CA (${escapeHtml(client.id)}.crt).`;
      } else if (!client.crtValid) {
        senderCertWarning.innerHTML = `<strong>Sender Certificate Broken:</strong> Root CA was re-initialized. Your certificate signature is invalid and must be re-signed in Admin view before sending signed documents!`;
      } else {
        senderCertWarning.innerHTML = `<strong>Key Mismatched:</strong> Your private key was re-generated and no longer matches your certificate (${escapeHtml(client.id)}.crt). Please ask Admin to re-sign before attaching signatures!`;
      }
    }
    if (sendBtn) sendBtn.disabled = true;
  } else {
    if (sendContainer) {
      sendContainer.className = "rounded-lg bg-zinc-950 border border-zinc-800 p-3 space-y-1.5 transition-colors";
    }
    if (senderCertWarning) {
      senderCertWarning.style.display = "none";
      senderCertWarning.innerHTML = "";
    }
    if (sendBtn) sendBtn.disabled = false;
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

function onSendFormChange() {
  const cmdSendEl = document.getElementById("cmd-client-send");
  if (cmdSendEl) cmdSendEl.removeAttribute("data-has-output");
  const client = caState.clients.find((c) => c.id === caState.activeRole);
  if (client) validateSenderCertForSigning(client);
  updateSendCmdPreview();
}

// Custom Recipient Dropdown Controller
const recipTrigger = document.getElementById("recipient-dropdown-trigger");
const recipMenu = document.getElementById("recipient-dropdown-menu");
const recipChevron = document.getElementById("recipient-dropdown-chevron");

function toggleRecipientDropdown(show) {
  if (!recipMenu) return;
  const isHidden = recipMenu.classList.contains("hidden");
  const willShow = show !== undefined ? show : isHidden;
  if (willShow) {
    recipMenu.classList.remove("hidden");
    if (recipTrigger) recipTrigger.setAttribute("aria-expanded", "true");
    if (recipChevron) recipChevron.classList.add("rotate-180");
  } else {
    recipMenu.classList.add("hidden");
    if (recipTrigger) recipTrigger.setAttribute("aria-expanded", "false");
    if (recipChevron) recipChevron.classList.remove("rotate-180");
  }
}

if (recipTrigger) {
  recipTrigger.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleRecipientDropdown();
  });
}

document.addEventListener("click", (e) => {
  const container = document.getElementById("recipient-dropdown-container");
  if (container && !container.contains(e.target)) {
    toggleRecipientDropdown(false);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    toggleRecipientDropdown(false);
  }
});

document.getElementById("recipient-dropdown-items")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".recipient-option-item");
  if (!btn) return;
  const recipId = btn.getAttribute("data-recip-id");
  const recipLabel = btn.getAttribute("data-recip-label");
  toggleRecipientDropdown(false);

  const hiddenInput = document.getElementById("send-recipient-select");
  if (hiddenInput) {
    hiddenInput.value = recipId;
  }
  const labelEl = document.getElementById("recipient-selected-label");
  if (labelEl) {
    labelEl.textContent = recipLabel;
  }

  // Update checkmarks and active classes
  document.querySelectorAll(".recipient-option-item").forEach((item) => {
    const isThis = item.getAttribute("data-recip-id") === recipId;
    if (isThis) {
      item.className = "recipient-option-item w-full flex items-center justify-between px-3 py-2 sm:px-2.5 sm:py-1.5 rounded-md transition-colors text-left cursor-pointer bg-zinc-800/70 text-zinc-100 font-medium";
      if (!item.querySelector('[data-lucide="check"]')) {
        item.insertAdjacentHTML("beforeend", `<i data-lucide="check" class="w-3.5 h-3.5 text-emerald-400 shrink-0"></i>`);
        if (window.lucide) window.lucide.createIcons();
      }
    } else {
      item.className = "recipient-option-item w-full flex items-center justify-between px-3 py-2 sm:px-2.5 sm:py-1.5 rounded-md transition-colors text-left cursor-pointer text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100";
      const chk = item.querySelector('[data-lucide="check"]');
      if (chk) chk.remove();
    }
  });

  onSendFormChange();
});

document.getElementById("send-recipient-select")?.addEventListener("change", onSendFormChange);
document.getElementById("send-sign-checkbox").addEventListener("change", onSendFormChange);
document.getElementById("send-doc-message")?.addEventListener("input", onSendFormChange);

document.getElementById("btn-client-send-doc").addEventListener("click", async () => {
  const senderId = caState.activeRole;
  const recipientId = document.getElementById("send-recipient-select").value;
  const message = document.getElementById("send-doc-message").value.trim();
  const isSigned = document.getElementById("send-sign-checkbox").checked;

  if (!recipientId) {
    renderCmdOutput("cmd-details-client-send", "cmd-client-send", {
      commands: [`openssl cms -encrypt ...`],
      outputs: [`[✕ Recipient Required] Please choose a valid recipient to send the encrypted document.`],
      status: "error",
    });
    return;
  }
  if (!message) {
    renderCmdOutput("cmd-details-client-send", "cmd-client-send", {
      commands: [`openssl cms -encrypt ...`],
      outputs: [`[✕ Message Required] Please enter confidential text to encrypt before sending.`],
      status: "error",
    });
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
      body: JSON.stringify({ senderId, recipientId, message, isSigned }),
    });
    const data = await res.json();

    if (!res.ok) {
      renderCmdOutput("cmd-details-client-send", "cmd-client-send", {
        commands: [
          isSigned
            ? `openssl cms -sign -in messages/tmp.txt -signer clients/${senderId}/${senderId}.crt -inkey clients/${senderId}/${senderId}.key -nodetach | openssl cms -encrypt -out messages/msg.enc clients/${recipientId}/${recipientId}.crt`
            : `openssl cms -encrypt -in messages/tmp.txt -out messages/msg.enc clients/${recipientId}/${recipientId}.crt`
        ],
        outputs: [`[✕ Send Failed] ${data.error || "Failed to send message"}`],
        status: "error",
      });
      return;
    }

    if (data.opensslLog) {
      logTerminal(data.opensslLog.command, data.opensslLog.output);
    }

    const sendCmds = isSigned
      ? [
          `openssl cms -sign -in messages/tmp_raw_${data.message.id}.txt -signer clients/${senderId}/${senderId}.crt -inkey clients/${senderId}/${senderId}.key -out messages/tmp_signed_${data.message.id}.smime -nodetach`,
          `openssl cms -encrypt -in messages/tmp_signed_${data.message.id}.smime -out messages/${data.message.encFilename} clients/${recipientId}/${recipientId}.crt`
        ]
      : [
          `openssl cms -encrypt -in messages/tmp_raw_${data.message.id}.txt -out messages/${data.message.encFilename} clients/${recipientId}/${recipientId}.crt`
        ];

    await syncCAState();

    renderCmdOutput("cmd-details-client-send", "cmd-client-send", {
      commands: sendCmds,
      outputs: [
        isSigned
          ? `[✓ Success] Digitally signed with clients/${senderId}/${senderId}.crt & encrypted for clients/${recipientId}/${recipientId}.crt`
          : `[✓ Success] Encrypted document delivered to clients/${recipientId}/${recipientId}.crt`,
        `Delivered to: ${data.message.recipientName}'s Inbox (messages/${data.message.encFilename}, ${data.message.ciphertextSize} bytes)`
      ],
      status: "success",
    });

    await loadAndRenderSent(senderId);
  } finally {
    btn.innerHTML = `<i data-lucide="send" class="w-3.5 h-3.5"></i><span>Encrypt &amp; Send</span>`;
    if (window.lucide) window.lucide.createIcons();
    btn.disabled = false;
  }
});

// ============================================================================
// SUBTAB 2 / SENT CONTROLLER
// ============================================================================
async function loadAndRenderSent(clientId) {
  const container = document.getElementById("sent-list");
  if (!container) return;

  const activeClient = caState.clients.find((c) => c.id === clientId);
  const ownerNameEl = document.getElementById("sent-owner-name");
  if (ownerNameEl && activeClient) {
    ownerNameEl.textContent = activeClient.name;
  }

  container.innerHTML = `<div class="hint-text text-xs text-zinc-500 py-3">Loading sent documents...</div>`;

  try {
    const res = await fetch(`/api/ca/sent?clientId=${clientId}`);
    const data = await res.json();
    const messages = data.messages || [];

    const countEl = document.getElementById("sent-section-count");
    if (countEl) countEl.textContent = String(messages.length);
    const tabCountEl = document.getElementById("sent-tab-count");
    if (tabCountEl) tabCountEl.textContent = String(messages.length);

    if (messages.length === 0) {
      container.innerHTML = `
        <div class="p-8 text-center space-y-2">
          <div class="w-10 h-10 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-500">
            <i data-lucide="send" class="w-5 h-5"></i>
          </div>
          <div class="text-xs text-zinc-300 font-medium">No sent documents yet</div>
          <p class="text-[11px] text-zinc-500 max-w-xs mx-auto">
            When you send encrypted documents to other clients, their record and OpenSSL envelope details will appear here.
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

        const cmdText = m.isSigned
          ? `$ openssl cms -sign -in messages/tmp.txt -signer clients/${m.senderId}/${m.senderId}.crt -inkey clients/${m.senderId}/${m.senderId}.key -nodetach | openssl cms -encrypt -out messages/${m.encFilename} clients/${m.recipientId}/${m.recipientId}.crt`
          : `$ openssl cms -encrypt -in messages/tmp.txt -out messages/${m.encFilename} clients/${m.recipientId}/${m.recipientId}.crt`;

        return `
          <div class="inbox-item-card" id="sent-card-${escapeHtml(m.id)}">
            <div class="inbox-item-head">
              <div class="inbox-item-meta">
                <span class="inbox-sender-tag">To: ${escapeHtml(m.recipientName)} (${escapeHtml(m.recipientId)}.crt)</span>
                ${sigBadge}
                <span class="inbox-time">${timeStr}</span>
              </div>
              <button class="btn-del-sent-msg" data-id="${escapeHtml(m.id)}" title="Delete message">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                <span class="hidden sm:inline">Delete</span>
              </button>
            </div>

            ${m.title ? `<div class="inbox-title">${escapeHtml(m.title)}</div>` : ""}

            <div class="inbox-cipher-preview">
              <span class="text-xs font-semibold text-zinc-200 flex items-center gap-1.5 mb-1"><i data-lucide="lock" class="w-3.5 h-3.5 text-zinc-400"></i>Encrypted Envelope (${m.ciphertextSize} bytes):</span>
              ${escapeHtml(m.ciphertextBase64Preview)}
            </div>

            <!-- Collapsible OpenSSL Command for this sent message -->
            <details class="group rounded-lg border border-zinc-800 bg-zinc-950 text-xs overflow-hidden" id="cmd-details-sent-${escapeHtml(m.id)}">
              <summary class="px-3 py-1.5 cursor-pointer select-none flex items-center justify-between">
                <span class="text-[10px] uppercase font-bold text-zinc-500 font-mono tracking-wider group-hover:text-zinc-300 transition-colors flex items-center gap-1.5">
                  <i data-lucide="terminal" class="w-3.5 h-3.5"></i>
                  <span>OpenSSL Command</span>
                </span>
                <span class="text-zinc-500 text-[10px] font-mono group-hover:text-zinc-400 transition-colors group-open:hidden">Show Command</span>
                <span class="text-zinc-500 text-[10px] font-mono group-hover:text-zinc-400 transition-colors hidden group-open:inline">Hide Command</span>
              </summary>
              <div class="p-3 border-t border-zinc-800 bg-zinc-950/60 overflow-x-auto text-[11px] font-mono text-zinc-400">
                <code id="cmd-code-sent-${escapeHtml(m.id)}" class="whitespace-pre-wrap">${escapeHtml(cmdText)}</code>
              </div>
            </details>
          </div>
        `;
      })
      .join("");

    if (window.lucide) window.lucide.createIcons();

    // Wire up delete buttons
    container.querySelectorAll(".btn-del-sent-msg").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const messageId = btn.getAttribute("data-id");
        if (!messageId) return;
        btn.innerHTML = `<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i>`;
        if (window.lucide) window.lucide.createIcons();
        try {
          await fetch(`/api/ca/inbox-message/${messageId}`, { method: "DELETE" });
          await syncCAState();
          await loadAndRenderSent(clientId);
        } catch (err) {
          console.error("Failed to delete sent message:", err);
        }
      });
    });
  } catch (err) {
    console.error("Failed to load sent messages:", err);
    container.innerHTML = `<div class="hint-text text-xs text-rose-400 py-3">Failed to load sent messages.</div>`;
  }
}

document.getElementById("btn-refresh-sent")?.addEventListener("click", () => {
  const btn = document.getElementById("btn-refresh-sent");
  if (btn) {
    btn.innerHTML = `<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i><span>Refreshing...</span>`;
    if (window.lucide) window.lucide.createIcons();
    setTimeout(async () => {
      await loadAndRenderSent(caState.activeRole);
      btn.innerHTML = `<i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i><span>Refresh</span>`;
      if (window.lucide) window.lucide.createIcons();
    }, 200);
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
              <div class="inbox-item-meta">
                <span class="inbox-sender-tag">From: ${escapeHtml(m.senderName)}</span>
                ${sigBadge}
                <span class="inbox-time">${timeStr}</span>
              </div>
              <button class="btn-del-msg" data-id="${escapeHtml(m.id)}" title="Delete message">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                <span class="hidden sm:inline">Delete</span>
              </button>
            </div>

            ${m.title ? `<div class="inbox-title">${escapeHtml(m.title)}</div>` : ""}

            <div class="inbox-cipher-preview">
              <span class="text-xs font-semibold text-zinc-200 flex items-center gap-1.5 mb-1"><i data-lucide="lock" class="w-3.5 h-3.5 text-zinc-400"></i>Encrypted Envelope (${m.ciphertextSize} bytes):</span>
              ${escapeHtml(m.ciphertextBase64Preview)}
            </div>

            <!-- Collapsible OpenSSL Command for this message -->
            <details class="group rounded-lg border border-zinc-800 bg-zinc-950 text-xs overflow-hidden" id="cmd-details-msg-${escapeHtml(m.id)}">
              <summary class="px-3 py-1.5 cursor-pointer select-none flex items-center justify-between">
                <span class="text-[10px] uppercase font-bold text-zinc-500 font-mono tracking-wider group-hover:text-zinc-300 transition-colors flex items-center gap-1.5">
                  <i data-lucide="terminal" class="w-3.5 h-3.5"></i>
                  <span>OpenSSL Command</span>
                </span>
                <span class="text-zinc-500 text-[10px] font-mono group-hover:text-zinc-400 transition-colors group-open:hidden">Show Command</span>
                <span class="text-zinc-500 text-[10px] font-mono group-hover:text-zinc-400 transition-colors hidden group-open:inline">Hide Command</span>
              </summary>
              <div class="p-3 border-t border-zinc-800 bg-zinc-950/60 overflow-x-auto text-[11px] font-mono text-zinc-400">
                <code id="cmd-code-msg-${escapeHtml(m.id)}" class="whitespace-pre-wrap">$ openssl cms -decrypt -in messages/${escapeHtml(m.encFilename)} -inkey clients/${escapeHtml(m.recipientId)}/${escapeHtml(m.recipientId)}.key -recip clients/${escapeHtml(m.recipientId)}/${escapeHtml(m.recipientId)}.crt${m.isSigned ? `\n$ openssl cms -verify -in messages/tmp_dec_${escapeHtml(m.id)}.tmp -CAfile ca/root_ca.crt` : ""}</code>
              </div>
            </details>

            <div class="inbox-actions">
              <button class="btn-solid btn-sm btn-decrypt-legit inline-flex items-center gap-1.5" data-id="${escapeHtml(m.id)}" data-recip="${escapeHtml(m.recipientId)}" data-enc="${escapeHtml(m.encFilename)}" data-signed="${m.isSigned ? "1" : "0"}">
                <i data-lucide="key" class="w-3.5 h-3.5"></i>
                <span>Decrypt with Private Key</span>
              </button>
              <button class="btn-outline btn-sm btn-danger-action btn-test-mallory inline-flex items-center gap-1.5" data-id="${escapeHtml(m.id)}" data-recip="${escapeHtml(m.recipientId)}" data-enc="${escapeHtml(m.encFilename)}">
                <i data-lucide="shield-alert" class="w-3.5 h-3.5"></i>
                <span>Test Interception (Mallory)</span>
              </button>
              ${
                m.isSigned
                  ? `<button class="btn-outline btn-sm btn-danger-action btn-test-tamper inline-flex items-center gap-1.5" id="btn-tamper-${escapeHtml(m.id)}" data-id="${escapeHtml(m.id)}" data-recip="${escapeHtml(m.recipientId)}" data-enc="${escapeHtml(m.encFilename)}" style="display: none;">
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

    // Initialize icons immediately for all inbox message cards
    if (window.lucide) window.lucide.createIcons();

    // Wire up buttons on each message card
    container.querySelectorAll(".btn-decrypt-legit").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const messageId = btn.getAttribute("data-id");
        const recipientId = btn.getAttribute("data-recip");
        const encFilename = btn.getAttribute("data-enc") || `msg_${messageId}.enc`;
        const isSigned = btn.getAttribute("data-signed") === "1";
        btn.innerHTML = `<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i><span>Decrypting...</span>`;
        if (window.lucide) window.lucide.createIcons();
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
            const tamperBtn = document.getElementById(`btn-tamper-${messageId}`);
            if (tamperBtn) {
              tamperBtn.style.display = "inline-flex";
            }

            const decCmd = `openssl cms -decrypt -in messages/${encFilename} -inkey clients/${recipientId}/${recipientId}.key -recip clients/${recipientId}/${recipientId}.crt -out messages/tmp_dec_${messageId}.tmp`;
            const verCmd = result.isSigned
              ? `openssl cms -verify -in messages/tmp_dec_${messageId}.tmp -CAfile ca/root_ca.crt`
              : "";

            renderCmdOutput(`cmd-details-msg-${messageId}`, `cmd-code-msg-${messageId}`, {
              commands: result.isSigned ? [decCmd, verCmd] : [decCmd],
              outputs: [
                `[1. Decrypt] Decryption successful with clients/${recipientId}/${recipientId}.key`,
                ...(result.isSigned
                  ? [
                      `[2. Verify Signature] CMS Verification successful: Signer authenticated by Root CA (CN=${result.signerName})`,
                      `[✓ Decrypted & Verified OK] Document content unlocked and signer identity verified!`
                    ]
                  : [`[✓ Decrypted OK] Document content unlocked successfully!`]),
                `\n[Decrypted Message Content]:\n${result.plaintext}`
              ],
              status: "success",
            });
          } else {
            renderCmdOutput(`cmd-details-msg-${messageId}`, `cmd-code-msg-${messageId}`, {
              commands: [`openssl cms -decrypt -in messages/${encFilename} -inkey clients/${recipientId}/${recipientId}.key -recip clients/${recipientId}/${recipientId}.crt`],
              outputs: [`[✕ Decryption Failed] ${result.error || "Unable to decrypt message"}`],
              status: "error",
            });
          }
        } catch (err) {
          renderCmdOutput(`cmd-details-msg-${messageId}`, `cmd-code-msg-${messageId}`, {
            commands: [`openssl cms -decrypt ...`],
            outputs: [`[✕ Error] ${err.message}`],
            status: "error",
          });
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
        const encFilename = btn.getAttribute("data-enc") || `msg_${messageId}.enc`;
        btn.innerHTML = `<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i><span>Testing Tamper...</span>`;
        if (window.lucide) window.lucide.createIcons();
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

          renderCmdOutput(`cmd-details-msg-${messageId}`, `cmd-code-msg-${messageId}`, {
            commands: [
              `openssl cms -decrypt -in messages/${encFilename} -inkey clients/${recipientId}/${recipientId}.key -recip clients/${recipientId}/${recipientId}.crt -out messages/tmp_dec_${messageId}.tmp`,
              `# Attacker altered document contents in transit!`,
              `openssl cms -verify -in messages/tmp_tampered_${messageId}.tmp -CAfile ca/root_ca.crt -out /dev/null`
            ],
            outputs: [
              `[✕ Tampering Detected by OpenSSL]`,
              `Verification failure: digest failure`,
              `Digital signature mathematically proves the document was modified in transit!`
            ],
            status: "error",
          });
        } catch (err) {
          renderCmdOutput(`cmd-details-msg-${messageId}`, `cmd-code-msg-${messageId}`, {
            commands: [`openssl cms -verify ...`],
            outputs: [`[✕ Error] ${err.message}`],
            status: "error",
          });
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
        const encFilename = btn.getAttribute("data-enc") || `msg_${messageId}.enc`;
        btn.innerHTML = `<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i><span>Testing Interception...</span>`;
        if (window.lucide) window.lucide.createIcons();
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

          renderCmdOutput(`cmd-details-msg-${messageId}`, `cmd-code-msg-${messageId}`, {
            commands: [`openssl cms -decrypt -in messages/${encFilename} -inkey clients/mallory/mallory.key`],
            outputs: [
              `[✕ Mallory Attack Blocked - Access Denied]`,
              result.error || "Decryption failed: key does not match recipient's certificate",
              `OpenSSL cipher operation rejected attacker: Mallory's key cannot unlock your mail!`
            ],
            status: "error",
          });
        } catch (err) {
          renderCmdOutput(`cmd-details-msg-${messageId}`, `cmd-code-msg-${messageId}`, {
            commands: [`openssl cms -decrypt -in messages/... -inkey clients/mallory/mallory.key`],
            outputs: [`[✕ Error] ${err.message}`],
            status: "error",
          });
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
        if (!messageId) return;
        btn.innerHTML = `<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i>`;
        if (window.lucide) window.lucide.createIcons();
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

// ============================================================================
// GLOBAL COPY TO CLIPBOARD HANDLER
// ============================================================================
async function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {}
  }
  // Fallback for HTTP / non-secure LAN connections
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch (err) {}
  document.body.removeChild(ta);
  return ok;
}

document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".btn-copy-code");
  if (!btn) return;
  const targetId = btn.getAttribute("data-target");
  const targetEl = document.getElementById(targetId);
  if (!targetEl) return;
  const text = targetEl.textContent;
  const success = await copyTextToClipboard(text);
  if (success) {
    const origText = btn.textContent;
    btn.textContent = "Copied!";
    btn.classList.add("text-emerald-400", "border-emerald-500/40");
    setTimeout(() => {
      btn.textContent = origText;
      btn.classList.remove("text-emerald-400", "border-emerald-500/40");
    }, 1500);
  }
});

// Initialize on page load
syncCAState();
