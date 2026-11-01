// Module 1: Blockchain Cryptography & Wallets Client Controller

(function () {
  "use strict";

  // State
  let state = {
    wallets: [],
    transactions: [],
    latestSignedTx: null,
  };

  // DOM Elements
  const tabButtons = document.querySelectorAll(".tab-btn");
  const tabContents = document.querySelectorAll(".tab-content");
  const badgeWalletCount = document.getElementById("badgeWalletCount");
  const badgeTxCount = document.getElementById("badgeTxCount");
  const walletsContainer = document.getElementById("walletsContainer");
  const ledgerContainer = document.getElementById("ledgerContainer");

  // Signer elements
  const signSenderSelect = document.getElementById("signSenderSelect");
  const signRecipientSelect = document.getElementById("signRecipientSelect");
  const signRecipientInput = document.getElementById("signRecipientInput");
  const signAmountInput = document.getElementById("signAmountInput");
  const signNonceInput = document.getElementById("signNonceInput");
  const btnSignTx = document.getElementById("btnSignTx");
  const signCanonicalJson = document.getElementById("signCanonicalJson");
  const signTxHash = document.getElementById("signTxHash");
  const signSignatureHex = document.getElementById("signSignatureHex");
  const signerStatusBadge = document.getElementById("signerStatusBadge");
  const btnBroadcastTx = document.getElementById("btnBroadcastTx");
  const btnSendToValidator = document.getElementById("btnSendToValidator");

  // Validator elements
  const valPayloadInput = document.getElementById("valPayloadInput");
  const btnLoadSampleTx = document.getElementById("btnLoadSampleTx");
  const btnVerifyPayload = document.getElementById("btnVerifyPayload");
  const valOverallBadge = document.getElementById("valOverallBadge");
  const iconCheck1Container = document.getElementById("iconCheck1Container");
  const badgeCheck1 = document.getElementById("badgeCheck1");
  const iconCheck2Container = document.getElementById("iconCheck2Container");
  const badgeCheck2 = document.getElementById("badgeCheck2");
  const proof2Details = document.getElementById("proof2Details");
  const iconCheck3Container = document.getElementById("iconCheck3Container");
  const badgeCheck3 = document.getElementById("badgeCheck3");
  const valResultBanner = document.getElementById("valResultBanner");

  // Modal elements
  const modalCreateWallet = document.getElementById("modalCreateWallet");
  const btnOpenCreateWalletModal = document.getElementById("btnOpenCreateWalletModal");
  const btnCloseCreateWalletModal = document.getElementById("btnCloseCreateWalletModal");
  const btnCancelCreateWallet = document.getElementById("btnCancelCreateWallet");
  const btnSubmitCreateWallet = document.getElementById("btnSubmitCreateWallet");
  const inputNewWalletName = document.getElementById("inputNewWalletName");
  const inputNewWalletBalance = document.getElementById("inputNewWalletBalance");

  // Crypto details modal
  const modalCryptoDetails = document.getElementById("modalCryptoDetails");
  const btnCloseCryptoDetails = document.getElementById("btnCloseCryptoDetails");
  const modalCryptoTitle = document.getElementById("modalCryptoTitle");
  const modalCryptoSubtitle = document.getElementById("modalCryptoSubtitle");
  const modalCryptoAddress = document.getElementById("modalCryptoAddress");
  const modalCryptoPubKey = document.getElementById("modalCryptoPubKey");
  const modalCryptoPrivKey = document.getElementById("modalCryptoPrivKey");

  // Attack simulator elements
  const attackResultCard = document.getElementById("attackResultCard");
  const btnResetState = document.getElementById("btnResetState");

  // Toast container
  const toastContainer = document.getElementById("toastContainer");

  // ---------------------------------------------------------------------------
  // TOAST NOTIFICATIONS
  // ---------------------------------------------------------------------------
  function showToast(message, type = "info") {
    const toast = document.createElement("div");
    const colors = {
      success: "border-emerald-500/40 bg-zinc-900 text-emerald-400",
      error: "border-rose-500/40 bg-zinc-900 text-rose-400",
      info: "border-zinc-800 bg-zinc-900 text-zinc-200",
    };
    toast.className = `px-4 py-2.5 rounded-lg border text-xs shadow-xl flex items-center gap-2 pointer-events-auto transition-all duration-300 transform translate-y-2 opacity-0 ${
      colors[type] || colors.info
    }`;

    const iconName = type === "success" ? "check-circle" : type === "error" ? "alert-circle" : "info";
    toast.innerHTML = `<i data-lucide="${iconName}" class="w-4 h-4 shrink-0"></i><span>${message}</span>`;
    toastContainer.appendChild(toast);
    lucide.createIcons({ root: toast });

    setTimeout(() => {
      toast.classList.remove("translate-y-2", "opacity-0");
    }, 10);

    setTimeout(() => {
      toast.classList.add("translate-y-2", "opacity-0");
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // ---------------------------------------------------------------------------
  // TAB NAVIGATION
  // ---------------------------------------------------------------------------
  function switchTab(tabId) {
    tabButtons.forEach((btn) => {
      if (btn.dataset.tab === tabId) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    tabContents.forEach((content) => {
      if (content.id === tabId) {
        content.classList.remove("hidden");
      } else {
        content.classList.add("hidden");
      }
    });

    lucide.createIcons();
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  // ---------------------------------------------------------------------------
  // API FETCH & STATE UPDATE
  // ---------------------------------------------------------------------------
  async function fetchState() {
    try {
      const res = await fetch("/api/m1/state");
      const data = await res.json();
      state.wallets = data.wallets || [];
      state.transactions = data.transactions || [];

      renderWallets();
      updateSignerDropdowns();
      renderLedger();

      badgeWalletCount.textContent = state.wallets.length;
      badgeTxCount.textContent = state.transactions.length;
      lucide.createIcons();
    } catch (err) {
      console.error("Failed to fetch state:", err);
      showToast("Failed to connect to local node server (Port 3001)", "error");
    }
  }

  // ---------------------------------------------------------------------------
  // RENDER WALLETS
  // ---------------------------------------------------------------------------
  function renderWallets() {
    walletsContainer.innerHTML = "";

    if (state.wallets.length === 0) {
      walletsContainer.innerHTML = `
        <div class="col-span-full card-panel p-8 text-center space-y-3">
          <div class="w-10 h-10 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 mx-auto">
            <i data-lucide="key-round" class="w-5 h-5"></i>
          </div>
          <div class="space-y-1">
            <h3 class="text-sm font-semibold text-zinc-200">No Wallets in Keystore</h3>
            <p class="text-xs text-zinc-400 max-w-md mx-auto">
              You are starting from scratch. Generate your first secp256k1 keypair to create an autonomous public address without any Certificate Authority.
            </p>
          </div>
          <div class="pt-2 flex items-center justify-center gap-2.5">
            <button id="btnCreateFirstWallet" class="btn-primary text-xs !py-1.5 font-medium">
              <i data-lucide="plus" class="w-3.5 h-3.5"></i>
              <span>Create First Wallet</span>
            </button>
            <button id="btnSeedDemoWallets" class="btn-secondary text-xs !py-1.5 font-medium">
              <i data-lucide="sparkles" class="w-3.5 h-3.5 text-zinc-400"></i>
              <span>Seed Demo Trio (Alice, Bob &amp; Mallory)</span>
            </button>
          </div>
        </div>
      `;

      document.getElementById("btnCreateFirstWallet")?.addEventListener("click", () => {
        btnOpenCreateWalletModal.click();
      });

      document.getElementById("btnSeedDemoWallets")?.addEventListener("click", async () => {
        try {
          const res = await fetch("/api/m1/wallets/seed", { method: "POST" });
          const data = await res.json();
          if (data.success) {
            showToast("Seeded Alice, Bob & Mallory demo wallets", "info");
            await fetchState();
          }
        } catch {
          showToast("Failed to seed wallets", "error");
        }
      });

      lucide.createIcons();
      return;
    }

    state.wallets.forEach((w) => {
      const card = document.createElement("div");
      card.className = "card-panel p-4 space-y-3.5 flex flex-col justify-between";

      const initial = w.name.charAt(0).toUpperCase();
      const avatarBg = "bg-zinc-800 border-zinc-700/80 text-zinc-300";

      card.innerHTML = `
        <div class="space-y-3">
          <!-- Top info -->
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2.5 min-w-0">
              <div class="w-8 h-8 rounded-lg border flex items-center justify-center font-bold text-xs shrink-0 ${avatarBg}">
                ${initial}
              </div>
              <div class="min-w-0">
                <h3 class="text-xs font-semibold text-zinc-100 truncate">${escapeHtml(w.name)}</h3>
                <span class="text-[10px] text-zinc-400 font-mono">Nonce: ${w.nonce}</span>
              </div>
            </div>
            <span class="badge-zinc text-xs font-mono font-medium text-zinc-200">${w.balance} Coins</span>
          </div>

          <!-- Address -->
          <div class="space-y-1">
            <div class="flex items-center justify-between text-[11px] text-zinc-400">
              <span>Public Address:</span>
              <button class="btn-copy-address hover:text-zinc-200 transition-colors flex items-center gap-1" data-address="${w.address}">
                <i data-lucide="copy" class="w-3 h-3"></i>
                <span class="text-[10px]">Copy</span>
              </button>
            </div>
            <div class="bg-zinc-950 p-2 rounded border border-zinc-800 text-[11px] font-mono text-zinc-300 break-all select-all">
              ${w.address}
            </div>
          </div>
        </div>

        <!-- Action buttons -->
        <div class="pt-2 flex items-center gap-2 border-t border-zinc-800/80">
          <button class="btn-secondary !py-1 !px-2.5 text-[11px] flex-1 btn-inspect-wallet" data-address="${w.address}">
            <i data-lucide="key" class="w-3 h-3 text-zinc-400"></i>
            <span>Keys &amp; Proofs</span>
          </button>
          <button class="btn-primary !py-1 !px-2.5 text-[11px] flex-1 btn-send-from-wallet" data-address="${w.address}">
            <i data-lucide="send" class="w-3 h-3"></i>
            <span>Send Coins</span>
          </button>
        </div>
      `;

      walletsContainer.appendChild(card);
    });

    // Attach event handlers
    walletsContainer.querySelectorAll(".btn-copy-address").forEach((btn) => {
      btn.addEventListener("click", () => {
        navigator.clipboard.writeText(btn.dataset.address);
        showToast("Address copied to clipboard", "success");
      });
    });

    walletsContainer.querySelectorAll(".btn-inspect-wallet").forEach((btn) => {
      btn.addEventListener("click", () => {
        const wallet = state.wallets.find((w) => w.address.toLowerCase() === btn.dataset.address.toLowerCase());
        if (wallet) openCryptoDetailsModal(wallet);
      });
    });

    walletsContainer.querySelectorAll(".btn-send-from-wallet").forEach((btn) => {
      btn.addEventListener("click", () => {
        switchTab("tab-signer");
        signSenderSelect.value = btn.dataset.address;
        updateSignerSenderNonce();
      });
    });
  }

  // ---------------------------------------------------------------------------
  // CRYPTO DETAILS MODAL
  // ---------------------------------------------------------------------------
  function openCryptoDetailsModal(wallet) {
    modalCryptoTitle.textContent = `${wallet.name}'s Cryptographic Identity`;
    modalCryptoSubtitle.textContent = `secp256k1 Curve · Node.js crypto module`;
    modalCryptoAddress.textContent = wallet.address;
    modalCryptoPubKey.textContent = wallet.publicKeyHex;
    modalCryptoPrivKey.textContent = wallet.privateKeyPem || "(Private key held securely in local wallet keystore)";

    modalCryptoDetails.classList.remove("hidden");
    lucide.createIcons();
  }

  btnCloseCryptoDetails.addEventListener("click", () => modalCryptoDetails.classList.add("hidden"));

  // ---------------------------------------------------------------------------
  // CREATE NEW WALLET MODAL
  // ---------------------------------------------------------------------------
  btnOpenCreateWalletModal.addEventListener("click", () => {
    inputNewWalletName.value = "";
    inputNewWalletBalance.value = "25";
    modalCreateWallet.classList.remove("hidden");
    inputNewWalletName.focus();
  });

  const closeCreateWallet = () => modalCreateWallet.classList.add("hidden");
  btnCloseCreateWalletModal.addEventListener("click", closeCreateWallet);
  btnCancelCreateWallet.addEventListener("click", closeCreateWallet);

  btnSubmitCreateWallet.addEventListener("click", async () => {
    const name = inputNewWalletName.value.trim();
    const balance = Number(inputNewWalletBalance.value);

    if (!name) {
      showToast("Please enter a wallet name", "error");
      return;
    }

    try {
      const res = await fetch("/api/m1/wallets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, initialBalance: balance }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Wallet '${name}' generated with secp256k1 keypair!`, "success");
        closeCreateWallet();
        await fetchState();
      } else {
        showToast(data.error || "Failed to create wallet", "error");
      }
    } catch (err) {
      showToast("Error generating wallet", "error");
    }
  });

  // ---------------------------------------------------------------------------
  // TRANSACTION SIGNER PIPELINE
  // ---------------------------------------------------------------------------
  function updateSignerDropdowns() {
    const currentSender = signSenderSelect.value;
    const currentRecipient = signRecipientSelect.value;

    if (state.wallets.length === 0) {
      signSenderSelect.innerHTML = '<option value="">-- No wallets created yet --</option>';
      signRecipientSelect.innerHTML = '<option value="">-- No wallets created yet --</option>';
      signRecipientInput.value = "";
      signNonceInput.value = "0";
      return;
    }

    signSenderSelect.innerHTML = "";
    signRecipientSelect.innerHTML = '<option value="">-- Select Recipient --</option>';

    state.wallets.forEach((w) => {
      const optSender = document.createElement("option");
      optSender.value = w.address;
      optSender.textContent = `${w.name} (${w.balance} coins, nonce: ${w.nonce})`;
      signSenderSelect.appendChild(optSender);

      const optRecipient = document.createElement("option");
      optRecipient.value = w.address;
      optRecipient.textContent = `${w.name} (${w.address.slice(0, 10)}...)`;
      signRecipientSelect.appendChild(optRecipient);
    });

    if (currentSender && Array.from(signSenderSelect.options).some((o) => o.value === currentSender)) {
      signSenderSelect.value = currentSender;
    }
    if (currentRecipient && Array.from(signRecipientSelect.options).some((o) => o.value === currentRecipient)) {
      signRecipientSelect.value = currentRecipient;
    } else if (!signRecipientInput.value && state.wallets.length > 1) {
      // Default recipient to second wallet (e.g. Bob)
      signRecipientSelect.value = state.wallets[1].address;
      signRecipientInput.value = state.wallets[1].address;
    }

    updateSignerSenderNonce();
  }

  function updateSignerSenderNonce() {
    const sender = state.wallets.find((w) => w.address.toLowerCase() === signSenderSelect.value.toLowerCase());
    signNonceInput.value = sender ? sender.nonce : 0;
  }

  signSenderSelect.addEventListener("change", updateSignerSenderNonce);

  signRecipientSelect.addEventListener("change", () => {
    if (signRecipientSelect.value) {
      signRecipientInput.value = signRecipientSelect.value;
    }
  });

  // Sign Transaction Button
  btnSignTx.addEventListener("click", async () => {
    const senderAddress = signSenderSelect.value;
    const to = signRecipientInput.value.trim();
    const amount = Number(signAmountInput.value);

    if (!senderAddress) {
      showToast("Please select a sender wallet", "error");
      return;
    }
    if (!to || !to.startsWith("0x") || to.length < 20) {
      showToast("Please enter a valid recipient address (0x...)", "error");
      return;
    }
    if (!amount || amount <= 0) {
      showToast("Please enter an amount greater than 0", "error");
      return;
    }

    try {
      const res = await fetch("/api/m1/transactions/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senderAddress, to, amount }),
      });
      const data = await res.json();

      if (data.success) {
        state.latestSignedTx = data.signedTx;

        signCanonicalJson.textContent = JSON.stringify(data.signedTx.data, null, 2);
        signTxHash.textContent = data.txHash;
        signSignatureHex.textContent = data.signedTx.signatureHex;

        signerStatusBadge.className = "badge-emerald text-[10px]";
        signerStatusBadge.textContent = "Signed & Ready";

        btnBroadcastTx.disabled = false;
        btnSendToValidator.disabled = false;

        showToast("Transaction signed using ECDSA SHA-256!", "success");
      } else {
        showToast(data.error || "Signing failed", "error");
      }
    } catch (err) {
      showToast("Error signing transaction", "error");
    }
  });

  // Broadcast to Node Button
  btnBroadcastTx.addEventListener("click", async () => {
    if (!state.latestSignedTx) return;

    try {
      const res = await fetch("/api/m1/transactions/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signedTx: state.latestSignedTx }),
      });
      const data = await res.json();

      if (data.success) {
        showToast("Transaction confirmed and recorded on local node ledger!", "success");
        await fetchState();
        switchTab("tab-ledger");
      } else {
        showToast(data.error || "Transaction rejected by node", "error");
      }
    } catch (err) {
      showToast("Error broadcasting transaction", "error");
    }
  });

  // Test in Validator Button
  btnSendToValidator.addEventListener("click", () => {
    if (!state.latestSignedTx) return;
    switchTab("tab-validator");
    valPayloadInput.value = JSON.stringify(state.latestSignedTx, null, 2);
    btnVerifyPayload.click();
  });

  // ---------------------------------------------------------------------------
  // ZERO-TRUST VALIDATOR
  // ---------------------------------------------------------------------------
  btnLoadSampleTx.addEventListener("click", () => {
    if (state.latestSignedTx) {
      valPayloadInput.value = JSON.stringify(state.latestSignedTx, null, 2);
      showToast("Loaded latest signed transaction", "info");
    } else {
      showToast("No transaction signed yet. Please sign one first in 'Transaction Signer'.", "info");
    }
  });

  btnVerifyPayload.addEventListener("click", async () => {
    const rawJson = valPayloadInput.value.trim();
    if (!rawJson) {
      showToast("Please enter a transaction JSON payload", "error");
      return;
    }

    let parsedPayload;
    try {
      parsedPayload = JSON.parse(rawJson);
    } catch {
      showToast("Invalid JSON syntax", "error");
      return;
    }

    try {
      const res = await fetch("/api/m1/transactions/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signedTx: parsedPayload }),
      });
      const data = await res.json();

      renderVerificationProofs(data);
    } catch (err) {
      showToast("Failed to verify transaction", "error");
    }
  });

  function renderVerificationProofs(res) {
    const proofs = res.proofs || {};

    // Proof 1: Curve Point
    if (!proofs.malformedKey) {
      iconCheck1Container.innerHTML = '<i data-lucide="check" class="w-3.5 h-3.5 text-zinc-300"></i>';
      badgeCheck1.className = "badge-zinc text-[10px] text-zinc-300";
      badgeCheck1.textContent = "Valid secp256k1 Point";
    } else {
      iconCheck1Container.innerHTML = '<i data-lucide="x" class="w-3.5 h-3.5 text-rose-400"></i>';
      badgeCheck1.className = "badge-zinc text-[10px] text-rose-400";
      badgeCheck1.textContent = "Malformed Key";
    }

    // Proof 2: Address Derivation
    if (proofs.addressMatches) {
      iconCheck2Container.innerHTML = '<i data-lucide="check" class="w-3.5 h-3.5 text-zinc-300"></i>';
      badgeCheck2.className = "badge-zinc text-[10px] text-zinc-300";
      badgeCheck2.textContent = "Identity Match (Zero CA)";
    } else {
      iconCheck2Container.innerHTML = '<i data-lucide="x" class="w-3.5 h-3.5 text-rose-400"></i>';
      badgeCheck2.className = "badge-zinc text-[10px] text-rose-400";
      badgeCheck2.textContent = "Address Mismatch";
    }

    proof2Details.classList.remove("hidden");
    proof2Details.innerHTML = `
      <div>Claimed Sender: <span class="text-zinc-200">${escapeHtml(proofs.claimedSender || "none")}</span></div>
      <div>Derived Address: <span class="${proofs.addressMatches ? "text-zinc-200 font-mono" : "text-rose-400 font-bold"}">${escapeHtml(proofs.derivedAddressFromPubKey || "invalid")}</span></div>
    `;

    // Proof 3: ECDSA Signature
    if (proofs.signatureValid) {
      iconCheck3Container.innerHTML = '<i data-lucide="check" class="w-3.5 h-3.5 text-zinc-300"></i>';
      badgeCheck3.className = "badge-zinc text-[10px] text-zinc-300";
      badgeCheck3.textContent = "Signature Authentic";
    } else {
      iconCheck3Container.innerHTML = '<i data-lucide="x" class="w-3.5 h-3.5 text-rose-400"></i>';
      badgeCheck3.className = "badge-zinc text-[10px] text-rose-400";
      badgeCheck3.textContent = "Invalid Signature";
    }

    // Overall Banner
    valResultBanner.classList.remove("hidden");
    if (res.isValid) {
      valOverallBadge.className = "badge-zinc text-[11px] text-zinc-200";
      valOverallBadge.textContent = "100% Valid & Authentic";

      valResultBanner.className = "p-3.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-200 space-y-1";
      valResultBanner.innerHTML = `
        <div class="flex items-center gap-2 font-semibold text-xs">
          <i data-lucide="shield-check" class="w-4 h-4 text-zinc-300"></i>
          <span>Transaction Mathematically Validated</span>
        </div>
        <p class="text-[11px] text-zinc-400">
          The transaction satisfies all cryptographic constraints. The sender's address was proven without contacting any Certificate Authority or third-party server.
        </p>
      `;
    } else {
      valOverallBadge.className = "badge-zinc text-[11px] text-rose-400";
      valOverallBadge.textContent = "Validation Failed";

      valResultBanner.className = "p-3.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-200 space-y-1";
      valResultBanner.innerHTML = `
        <div class="flex items-center gap-2 font-semibold text-xs text-rose-400">
          <i data-lucide="shield-alert" class="w-4 h-4 text-rose-400"></i>
          <span>Transaction Rejected by Cryptographic Node</span>
        </div>
        <p class="text-[11px] text-zinc-400 font-mono">
          Reason: ${escapeHtml(res.reason || "Verification failure")}
        </p>
      `;
    }

    lucide.createIcons();
  }

  // ---------------------------------------------------------------------------
  // ATTACK SIMULATOR
  // ---------------------------------------------------------------------------
  document.querySelectorAll(".btn-run-attack").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const attackType = btn.dataset.attack;

      try {
        const res = await fetch("/api/m1/attack-simulation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attackType }),
        });
        const data = await res.json();

        renderAttackResult(data);
      } catch (err) {
        showToast("Error running attack simulation", "error");
      }
    });
  });

  function renderAttackResult(data) {
    attackResultCard.classList.remove("hidden");
    const isSuccess = data.verificationResult && data.verificationResult.isValid;

    attackResultCard.innerHTML = `
      <div class="flex items-center justify-between border-b border-zinc-800 pb-3">
        <div class="space-y-0.5">
          <h3 class="text-sm font-bold text-zinc-100 flex items-center gap-2">
            <i data-lucide="zap" class="w-4 h-4 text-zinc-400"></i>
            <span>${escapeHtml(data.title)}</span>
          </h3>
          <p class="text-xs text-zinc-400">${escapeHtml(data.description)}</p>
        </div>
        <span class="badge-zinc text-xs text-zinc-300">
          ${isSuccess ? "Attack Succeeded" : "Attack Defeated"}
        </span>
      </div>

      <!-- Side-by-side comparison -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <span class="text-xs font-semibold text-zinc-400 block mb-1">Authentic Payload (Signed by Alice):</span>
          <pre class="code-box text-[11px] text-zinc-300 border-zinc-800">${JSON.stringify(data.originalTx.data, null, 2)}</pre>
        </div>
        <div>
          <span class="text-xs font-semibold text-zinc-400 block mb-1">Tampered / Attacker Payload:</span>
          <pre class="code-box text-[11px] text-zinc-300 border-zinc-800">${JSON.stringify(data.tamperedTx.data, null, 2)}</pre>
        </div>
      </div>

      <!-- Technical breakdown -->
      <div class="p-3.5 rounded-lg bg-zinc-950 border border-zinc-800 space-y-2">
        <div class="flex items-center gap-2 text-xs font-semibold text-zinc-200">
          <i data-lucide="info" class="w-4 h-4 text-zinc-400"></i>
          <span>How the Network Node Detected &amp; Blocked This:</span>
        </div>
        <div class="text-xs text-zinc-300 font-mono space-y-1">
          <div>Intercept Point: <strong class="text-zinc-100">${escapeHtml(data.failureStep)}</strong></div>
          <div class="text-zinc-400 leading-relaxed font-sans pt-1">${escapeHtml(data.explanation)}</div>
        </div>
      </div>
    `;

    lucide.createIcons();
    attackResultCard.scrollIntoView({ behavior: "smooth" });
  }

  // ---------------------------------------------------------------------------
  // NODE LEDGER
  // ---------------------------------------------------------------------------
  function renderLedger() {
    ledgerContainer.innerHTML = "";

    if (state.transactions.length === 0) {
      ledgerContainer.innerHTML = `
        <div class="card-panel p-8 text-center space-y-2">
          <i data-lucide="inbox" class="w-8 h-8 text-zinc-600 mx-auto"></i>
          <p class="text-xs text-zinc-400">No transactions recorded yet.</p>
          <p class="text-[11px] text-zinc-500">Go to 'Transaction Signer' to compose and broadcast your first transaction.</p>
        </div>
      `;
      return;
    }

    state.transactions.forEach((tx) => {
      const item = document.createElement("div");
      item.className = "card-panel p-4 space-y-2.5";

      const timeStr = new Date(tx.recordedAt).toLocaleTimeString();
      const isConfirmed = tx.status === "broadcasted";

      item.innerHTML = `
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="${isConfirmed ? "badge-emerald" : "badge-rose"} text-[10px]">
              ${isConfirmed ? "Confirmed" : "Rejected"}
            </span>
            <span class="text-xs font-mono text-zinc-400">TxHash: ${tx.txHash.slice(0, 16)}...</span>
          </div>
          <span class="text-[11px] text-zinc-500">${timeStr}</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs text-zinc-300">
          <div><span class="text-zinc-500">From:</span> <span class="font-mono text-zinc-200">${tx.signedTx.data.from.slice(0, 14)}...</span></div>
          <div><span class="text-zinc-500">To:</span> <span class="font-mono text-zinc-200">${tx.signedTx.data.to.slice(0, 14)}...</span></div>
          <div><span class="text-zinc-500">Amount:</span> <strong class="text-emerald-400">${tx.signedTx.data.amount} Coins</strong> (Nonce: ${tx.signedTx.data.nonce})</div>
        </div>

        <div class="pt-1 text-[11px] font-mono text-zinc-500 truncate">
          Signature: ${tx.signedTx.signatureHex}
        </div>
      `;

      ledgerContainer.appendChild(item);
    });
  }

  // ---------------------------------------------------------------------------
  // RESET STATE
  // ---------------------------------------------------------------------------
  btnResetState.addEventListener("click", async () => {
    if (!confirm("Reset all accounts, balances, and ledger to default?")) return;

    try {
      const res = await fetch("/api/m1/wallets/reset", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        showToast("Lab state reset to default", "info");
        state.latestSignedTx = null;
        attackResultCard.classList.add("hidden");
        valResultBanner.classList.add("hidden");
        await fetchState();
      }
    } catch {
      showToast("Error resetting state", "error");
    }
  });

  // Utility to escape HTML
  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Initial load
  fetchState();
})();
