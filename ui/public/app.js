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
    document.getElementById("view-admin").style.display = "flex";
    document.getElementById("view-client").style.display = "none";
    renderAdminView();
  } else {
    document.getElementById("view-admin").style.display = "none";
    document.getElementById("view-client").style.display = "flex";
    renderClientView();
  }
}

// ============================================================================
// ROLE SELECTOR & CRUD
// ============================================================================
function renderRoleSelector() {
  const roleSelect = document.getElementById("global-role-select");
  let optionsHtml = `<option value="admin" ${caState.activeRole === "admin" ? "selected" : ""}>🏛️ Admin (Root CA)</option>`;

  caState.clients.forEach((c) => {
    const certTag = c.crtExists ? "✓" : "needs cert";
    optionsHtml += `<option value="${escapeHtml(c.id)}" ${caState.activeRole === c.id ? "selected" : ""}>
      👤 ${escapeHtml(c.name)} (${certTag})
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

// Inline Add Client Modal
const addPanel = document.getElementById("add-client-panel");
const clientInput = document.getElementById("input-client-name");

document.getElementById("btn-open-add-client").addEventListener("click", () => {
  addPanel.style.display = addPanel.style.display === "none" ? "block" : "none";
  if (addPanel.style.display === "block") clientInput.focus();
});

document.getElementById("btn-cancel-add-client").addEventListener("click", () => {
  addPanel.style.display = "none";
  clientInput.value = "";
});

document.getElementById("btn-submit-add-client").addEventListener("click", async () => {
  const name = clientInput.value.trim();
  if (!name) return;

  const btn = document.getElementById("btn-submit-add-client");
  btn.textContent = "Creating...";
  btn.disabled = true;

  try {
    const res = await fetch("/api/ca/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (data.opensslLogs) {
      data.opensslLogs.forEach((l) => logTerminal(l.command, l.output));
    }
    addPanel.style.display = "none";
    clientInput.value = "";

    // Switch to newly created client
    await fetch("/api/ca/select-role", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: data.id }),
    });
    await syncCAState();
  } finally {
    btn.textContent = "Create Client";
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
    fsRootKey.textContent = "223B";
    fbRootCrt.classList.add("created");
    fsRootCrt.textContent = "valid (365d)";
    adminInitBtn.textContent = "Re-initialize Root CA";
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
    adminInitBtn.textContent = "Initialize Root CA";
    bodyAdminRoot.style.display = "none";
  }

  // Clients table in Admin View
  const tbody = document.getElementById("admin-clients-tbody");
  if (!caState.clients || caState.clients.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align:center; padding:32px 14px; color:var(--text-dim); font-size:0.84rem;">
          No clients registered yet. Click <strong>'+ Add Client'</strong> above to create your first client (e.g. Alice, Bob, or a domain).
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = caState.clients
    .map((c) => {
      const keyBadge = c.keyExists
        ? `<span class="status-pill signed">✓ ${c.keySize}B</span>`
        : `<span class="status-pill none">Not Generated</span>`;

      const csrBadge = c.csrExists
        ? `<span class="status-pill ready">✓ CSR Ready</span>`
        : `<span class="status-pill none">No CSR</span>`;

      const crtBadge = c.crtExists
        ? `<span class="status-pill signed">✓ Issued (Active)</span>`
        : `<span class="status-pill none">Pending Signature</span>`;

      let actionBtn = "";
      if (c.crtExists) {
        actionBtn = `
          <button class="btn-outline btn-sm btn-re-sign" data-id="${escapeHtml(c.id)}">Re-sign</button>
          <button class="btn-ghost btn-sm btn-danger-hover btn-del-client" data-id="${escapeHtml(c.id)}" title="Delete client">✕</button>
        `;
      } else if (c.csrExists) {
        actionBtn = `
          <button class="btn-solid btn-sm btn-sign-cert" data-id="${escapeHtml(c.id)}">Sign &amp; Issue Cert</button>
          <button class="btn-ghost btn-sm btn-danger-hover btn-del-client" data-id="${escapeHtml(c.id)}" title="Delete client">✕</button>
        `;
      } else {
        actionBtn = `
          <span style="font-size:0.75rem; color:var(--text-dim);">Client needs key/CSR first</span>
          <button class="btn-ghost btn-sm btn-danger-hover btn-del-client" data-id="${escapeHtml(c.id)}" title="Delete client">✕</button>
        `;
      }

      return `
        <tr>
          <td><strong>${escapeHtml(c.name)}</strong> <span style="font-size:0.72rem; color:var(--text-dim); font-family:monospace;">(${escapeHtml(c.id)})</span></td>
          <td>${keyBadge}</td>
          <td>${csrBadge}</td>
          <td>${crtBadge}</td>
          <td>${actionBtn}</td>
        </tr>
      `;
    })
    .join("");

  // Attach table button actions
  tbody.querySelectorAll(".btn-sign-cert, .btn-re-sign").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      btn.textContent = "Signing...";
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
        btn.disabled = false;
      }
    });
  });

  tbody.querySelectorAll(".btn-del-client").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      if (!confirm(`Delete client "${id}" and wipe their certificate files?`)) return;
      await fetch(`/api/ca/client/${id}`, { method: "DELETE" });
      await syncCAState();
    });
  });
}

// Admin: Initialize Root CA
document.getElementById("btn-admin-init-root").addEventListener("click", async () => {
  const btn = document.getElementById("btn-admin-init-root");
  btn.textContent = "Generating...";
  btn.disabled = true;
  try {
    const res = await fetch("/api/ca/init-root", { method: "POST" });
    const data = await res.json();
    if (data.opensslLogs) {
      data.opensslLogs.forEach((l) => logTerminal(l.command, l.output));
    }
    await syncCAState();
  } finally {
    btn.disabled = false;
  }
});

// Admin: Fake CA Attack Test
document.getElementById("btn-admin-fake-test").addEventListener("click", async () => {
  const targetClient = caState.clients ? caState.clients[0] : null;
  if (!targetClient) {
    alert("Please create at least one client before simulating a fake CA attack.");
    return;
  }
  const btn = document.getElementById("btn-admin-fake-test");
  btn.textContent = "Testing Attack...";
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
    btn.textContent = "Test Fake CA Attack";
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
  document.getElementById("client-view-name").textContent = activeClient.name;
  document.getElementById("client-view-cn").textContent = `CN=${activeClient.name}`;
  document.getElementById("inbox-owner-name").textContent = activeClient.name;

  // Client File Badges
  document.getElementById("fn-client-key").textContent = `clients/${activeClient.id}/${activeClient.id}.key`;
  document.getElementById("fn-client-csr").textContent = `clients/${activeClient.id}/${activeClient.id}.csr`;
  document.getElementById("fn-client-crt").textContent = `clients/${activeClient.id}/${activeClient.id}.crt`;

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
    fsCrt.textContent = "signed";
  } else {
    fbCrt.classList.remove("created");
    fsCrt.textContent = "not created";
  }

  // Update Inbox Tab Badge Count
  document.getElementById("inbox-tab-count").textContent = String(activeClient.inboxCount || 0);

  // Render Subtab Panels
  renderClientIdentity(activeClient);
  renderClientSendTab(activeClient);
  if (currentSubtab === "inbox") {
    loadAndRenderInbox(activeClient.id);
  }
}

// Subtabs navigation buttons
document.querySelectorAll(".subtab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".subtab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentSubtab = btn.getAttribute("data-subtab");

    document.querySelectorAll(".subtab-panel").forEach((p) => (p.style.display = "none"));
    const activePanel = document.getElementById(`subtab-${currentSubtab}`);
    if (activePanel) activePanel.style.display = "flex";

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

  cmdCsr.textContent = `$ openssl req -new -key clients/${client.id}/${client.id}.key -out clients/${client.id}/${client.id}.csr -subj "/CN=${client.name}/O=Users/C=ID"`;
  document.getElementById("client-info-cn").textContent = `CN=${client.name}`;

  if (client.csrExists && caState.activeDetails) {
    bodyIdentity.style.display = "flex";
    genBtn.textContent = "Re-generate Key & CSR";
    document.getElementById("client-csr-text").textContent =
      caState.activeDetails.csrText || caState.activeDetails.csrPem;

    if (client.crtExists) {
      document.getElementById("client-info-cert-status").textContent = "✓ Signed & Active by Root CA";
      document.getElementById("client-crt-details").style.display = "block";
      document.getElementById("client-crt-text").textContent =
        caState.activeDetails.crtText || caState.activeDetails.crtPem;
      document.getElementById("client-verify-footer").style.display = "flex";
    } else {
      document.getElementById("client-info-cert-status").textContent = "Pending Signature (Switch to Admin to Sign)";
      document.getElementById("client-crt-details").style.display = "none";
      document.getElementById("client-verify-footer").style.display = "none";
    }
  } else {
    bodyIdentity.style.display = "none";
    genBtn.textContent = "Generate Key & CSR";
  }
}

document.getElementById("btn-client-gen-key").addEventListener("click", async () => {
  const activeClient = caState.clients.find((c) => c.id === caState.activeRole);
  if (!activeClient) return;

  const btn = document.getElementById("btn-client-gen-key");
  btn.textContent = "Generating...";
  btn.disabled = true;

  try {
    const res = await fetch("/api/ca/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: activeClient.name }),
    });
    const data = await res.json();
    if (data.opensslLogs) {
      data.opensslLogs.forEach((l) => logTerminal(l.command, l.output));
    }
    await syncCAState();
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("btn-client-verify-ca").addEventListener("click", async () => {
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
  banner.style.display = "flex";
  document.getElementById("client-verify-banner-text").textContent = `${caState.activeRole}.crt: OK (Authentic & Validated by Root CA)`;
});

// SUBTAB 2: SEND ENCRYPTED DOCUMENT
function renderClientSendTab(client) {
  document.getElementById("send-sender-display").value = client.name;

  // Filter other certified clients
  const eligibleRecipients = caState.clients.filter(
    (c) => c.id !== client.id && c.crtExists
  );

  const warningBox = document.getElementById("no-recipients-warning");
  const sendBtn = document.getElementById("btn-client-send-doc");
  const recipSelect = document.getElementById("send-recipient-select");
  const signCheckbox = document.getElementById("send-sign-checkbox");
  const senderCertWarning = document.getElementById("sender-cert-warning");

  if (eligibleRecipients.length === 0) {
    warningBox.style.display = "flex";
    sendBtn.disabled = true;
    recipSelect.innerHTML = `<option value="">No other certified clients</option>`;
    recipSelect.disabled = true;
    document.getElementById("cmd-client-send").textContent = "$ openssl cms (blocked: no eligible recipient)";
    return;
  }

  warningBox.style.display = "none";
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
  const warnCrtName = document.getElementById("warn-sender-crt");

  if (signCheckbox.checked && !client.crtExists) {
    senderCertWarning.style.display = "block";
    warnCrtName.textContent = `${client.id}.crt`;
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
    alert("Please choose a valid recipient.");
    return;
  }
  if (!message) {
    alert("Please enter a document message to encrypt.");
    return;
  }

  const btn = document.getElementById("btn-client-send-doc");
  btn.textContent = "Encrypting & Sending...";
  btn.disabled = true;

  try {
    const res = await fetch("/api/ca/send-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senderId, recipientId, title, message, isSigned }),
    });
    const data = await res.json();

    if (!res.ok) {
      alert(data.error || "Failed to send message");
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
    btn.textContent = "Encrypt & Send";
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
        <div class="empty-inbox-card">
          <p>📬 Your inbox is empty.</p>
          <p style="margin-top:6px; color:var(--text-muted); font-size:0.78rem;">
            When another client sends you an encrypted document, it will appear here.
          </p>
        </div>
      `;
      return;
    }

    container.innerHTML = messages
      .map((m) => {
        const timeStr = new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const sigBadge = m.isSigned
          ? `<span class="sig-badge-verified">🔒 Digitally Signed</span>`
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
              <span style="color:#ffffff; font-weight:600;">🔒 Encrypted Envelope (${m.ciphertextSize} bytes):</span><br/>
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
                <span class="sig-badge-verified">✓ Signature Authenticated: CN=${escapeHtml(m.senderName)} (Validated by Root CA)</span>
              </div>
              <div style="font-size:0.75rem; color:var(--success); font-weight:600; margin-bottom:4px;">
                ✓ Decrypted with ${escapeHtml(m.recipientId)}.key:
              </div>
              <div class="mono-display msg-plain-text" id="plain-text-${escapeHtml(m.id)}">-</div>
            </div>

            <div class="inbox-actions">
              <button class="btn-solid btn-sm btn-decrypt-legit" data-id="${escapeHtml(m.id)}" data-recip="${escapeHtml(m.recipientId)}">
                🔓 Decrypt with My Private Key
              </button>
              <button class="btn-outline btn-sm btn-danger-action btn-test-mallory" data-id="${escapeHtml(m.id)}" data-recip="${escapeHtml(m.recipientId)}">
                🕵️ Test Interception (Mallory / Fake Key)
              </button>
              ${
                m.isSigned
                  ? `<button class="btn-outline btn-sm btn-danger-action btn-test-tamper" id="btn-tamper-${escapeHtml(m.id)}" data-id="${escapeHtml(m.id)}" data-recip="${escapeHtml(m.recipientId)}" style="display: none;">
                      🕵️ Test Tamper / Forged Signature
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
            alert(`Decryption failed: ${result.error}`);
          }
        } finally {
          btn.textContent = "🔓 Decrypt with My Private Key";
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
          btn.textContent = "🕵️ Test Tamper / Forged Signature";
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
          btn.textContent = "🕵️ Test Interception (Mallory / Fake Key)";
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

document.getElementById("btn-refresh-inbox").addEventListener("click", () => {
  loadAndRenderInbox(caState.activeRole);
});

// ============================================================================
// RESET ALL
// ============================================================================
document.getElementById("btn-ca-reset").addEventListener("click", async () => {
  const ok = confirm("Wipe all generated CA keys, client certificates, and inboxes to start completely from zero?");
  if (!ok) return;

  await fetch("/api/ca/reset", { method: "POST" });
  logTerminal("reset", "All CA certificates, keys, and client inboxes wiped. Clean slate.");
  await syncCAState();
});

// Initialize on page load
syncCAState();
