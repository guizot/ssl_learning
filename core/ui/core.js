// ============================================================================
// CORE SHARED UI UTILITIES, UNIFIED THEME & CUSTOM DROPDOWN SELECTS
// Shared across Hub (/), Module 0 (/m0/), Module 1 (/m1/), and Module 2 (/m2/)
// ============================================================================

(function () {
  const THEME_KEY = "ca_lab_theme";
  const SCHEME_KEY = "color-scheme";

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

  function getActiveModuleKey() {
    const p = window.location.pathname;
    if (p.startsWith("/m0")) return "m0";
    if (p.startsWith("/m1")) return "m1";
    if (p.startsWith("/m2")) return "m2";
    return "hub";
  }

  function normalizeTheme(raw) {
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
    if (raw === "light dark") return "system";
    return "system";
  }

  function getSavedTheme() {
    try {
      const fromThemeKey = localStorage.getItem(THEME_KEY);
      if (fromThemeKey === "light" || fromThemeKey === "dark" || fromThemeKey === "system") {
        return fromThemeKey;
      }
      const fromSchemeKey = localStorage.getItem(SCHEME_KEY);
      if (fromSchemeKey === "light" || fromSchemeKey === "dark") {
        return fromSchemeKey;
      }
    } catch {}
    return "system";
  }

  function applyTheme(rawTheme, persist = true) {
    const theme = normalizeTheme(rawTheme);
    const root = document.documentElement;
    let iconName = "monitor";

    if (theme === "dark") {
      root.classList.add("dark");
      root.classList.remove("light");
      iconName = "moon";
    } else if (theme === "light") {
      root.classList.add("light");
      root.classList.remove("dark");
      iconName = "sun";
    } else {
      root.classList.remove("dark", "light");
      iconName = "monitor";
    }

    let meta = document.querySelector('meta[name="color-scheme"]');
    if (!meta && document.head) {
      meta = document.createElement("meta");
      meta.name = "color-scheme";
      document.head.appendChild(meta);
    }
    const schemeValue = theme === "system" ? "light dark" : theme;
    if (meta) {
      meta.setAttribute("content", schemeValue);
    }

    if (persist) {
      try {
        localStorage.setItem(THEME_KEY, theme);
        localStorage.setItem(SCHEME_KEY, schemeValue);
      } catch {}
    }

    const themeBtn = document.getElementById("btn-theme-toggle");
    if (themeBtn) {
      themeBtn.innerHTML = `<i id="theme-icon" data-lucide="${iconName}" class="w-4 h-4 sm:w-3.5 sm:h-3.5"></i>`;
      const label = theme === "system" ? "System (Auto)" : theme === "light" ? "Light" : "Dark";
      themeBtn.title = `Theme: ${label} (Click to toggle)`;
    }

    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  function cycleTheme() {
    const current = getSavedTheme();
    const next = current === "system" ? "light" : current === "light" ? "dark" : "system";
    applyTheme(next, true);
  }

  // ==========================================================================
  // SHARED CUSTOM DROPDOWN COMPONENT FOR <select> ELEMENTS
  // Replaces native OS select popups with our Zinc custom dropdown menu
  // ==========================================================================
  const selectRegistry = [];
  const nativeValueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  const nativeDisabledDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "disabled");
  const nativeInnerHTMLDesc = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");

  function closeAllCustomSelects(exceptContainer = null) {
    for (const entry of selectRegistry) {
      if (entry.container !== exceptContainer) {
        entry.toggle(false);
      }
    }
  }

  function enhanceSelectElement(selectEl) {
    if (!selectEl || selectEl.dataset.coreSelectEnhanced === "true") return;
    selectEl.dataset.coreSelectEnhanced = "true";

    const container = document.createElement("div");
    container.className = "relative core-select-container w-full";
    if (selectEl.classList.contains("sm:w-44")) {
      container.classList.add("sm:w-48");
    }

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className =
      "core-select-trigger flex items-center justify-between gap-2.5 px-3 h-9 sm:h-8 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-zinc-200 text-xs font-mono transition-colors w-full focus:outline-none focus:border-zinc-600 cursor-pointer select-none";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");

    const labelSpan = document.createElement("span");
    labelSpan.className = "core-select-label truncate font-mono text-left";
    labelSpan.textContent = "-";

    const chevronWrap = document.createElement("span");
    chevronWrap.className = "core-select-chevron inline-flex items-center justify-center text-zinc-400 shrink-0 transition-transform duration-200";
    chevronWrap.innerHTML = `<i data-lucide="chevron-down" class="w-3.5 h-3.5"></i>`;

    trigger.appendChild(labelSpan);
    trigger.appendChild(chevronWrap);

    const menu = document.createElement("div");
    menu.className =
      "core-select-menu hidden absolute top-full left-0 right-0 mt-1.5 min-w-[180px] z-50 rounded-lg border border-zinc-800 bg-zinc-950/95 backdrop-blur-md shadow-2xl p-1.5 space-y-0.5 text-xs max-h-60 overflow-y-auto";

    const itemsWrap = document.createElement("div");
    itemsWrap.className = "space-y-0.5";
    menu.appendChild(itemsWrap);

    selectEl.parentNode.insertBefore(container, selectEl);
    container.appendChild(selectEl);
    container.appendChild(trigger);
    container.appendChild(menu);

    selectEl.removeAttribute("required");
    selectEl.style.display = "none";

    function toggle(show) {
      const isHidden = menu.classList.contains("hidden");
      const willShow = show !== undefined ? show : isHidden;
      if (willShow && !trigger.disabled) {
        closeAllCustomSelects(container);
        menu.classList.remove("hidden");
        trigger.setAttribute("aria-expanded", "true");
        chevronWrap.classList.add("rotate-180");
      } else {
        menu.classList.add("hidden");
        trigger.setAttribute("aria-expanded", "false");
        chevronWrap.classList.remove("rotate-180");
      }
    }

    function syncUI() {
      const options = Array.from(selectEl.options || []);
      const currentVal = nativeValueDesc ? nativeValueDesc.get.call(selectEl) : selectEl.value;
      const selectedOpt = options.find((o) => o.value === currentVal) || options[0] || null;
      const isDisabled = nativeDisabledDesc ? nativeDisabledDesc.get.call(selectEl) : selectEl.disabled;

      labelSpan.textContent = selectedOpt ? selectedOpt.textContent : "-";
      trigger.disabled = Boolean(isDisabled);
      trigger.classList.toggle("opacity-50", Boolean(isDisabled));
      trigger.classList.toggle("cursor-not-allowed", Boolean(isDisabled));
      if (isDisabled) toggle(false);

      itemsWrap.innerHTML = options
        .map((opt) => {
          const isSelected = selectedOpt && opt.value === selectedOpt.value;
          return `
            <button
              type="button"
              class="core-select-option w-full flex items-center justify-between gap-2 px-3 py-2 sm:px-2.5 sm:py-1.5 rounded-md transition-colors text-left font-mono text-xs cursor-pointer ${
                isSelected
                  ? "bg-zinc-800/70 text-zinc-100 font-medium"
                  : "text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
              }"
              data-value="${escapeHtml(opt.value)}"
            >
              <span class="truncate">${escapeHtml(opt.textContent)}</span>
              ${isSelected ? `<i data-lucide="check" class="w-3.5 h-3.5 text-emerald-400 shrink-0"></i>` : ""}
            </button>
          `;
        })
        .join("");

      if (window.lucide) {
        window.lucide.createIcons();
      }
    }

    // Intercept programmatic .value, .disabled, and .innerHTML updates
    if (nativeValueDesc) {
      Object.defineProperty(selectEl, "value", {
        configurable: true,
        get() {
          return nativeValueDesc.get.call(this);
        },
        set(val) {
          nativeValueDesc.set.call(this, val);
          syncUI();
        },
      });
    }

    if (nativeDisabledDesc) {
      Object.defineProperty(selectEl, "disabled", {
        configurable: true,
        get() {
          return nativeDisabledDesc.get.call(this);
        },
        set(val) {
          nativeDisabledDesc.set.call(this, val);
          syncUI();
        },
      });
    }

    if (nativeInnerHTMLDesc) {
      Object.defineProperty(selectEl, "innerHTML", {
        configurable: true,
        get() {
          return nativeInnerHTMLDesc.get.call(this);
        },
        set(html) {
          nativeInnerHTMLDesc.set.call(this, html);
          syncUI();
        },
      });
    }

    const observer = new MutationObserver(() => syncUI());
    observer.observe(selectEl, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled"],
    });

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      toggle();
    });

    itemsWrap.addEventListener("click", (e) => {
      const btn = e.target.closest(".core-select-option");
      if (!btn) return;
      const newVal = btn.getAttribute("data-value") ?? "";
      if (nativeValueDesc) {
        nativeValueDesc.set.call(selectEl, newVal);
      } else {
        selectEl.value = newVal;
      }
      toggle(false);
      syncUI();
      selectEl.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Also allow clicking <label for="..."> to toggle this custom dropdown
    if (selectEl.id) {
      const labelEl = document.querySelector(`label[for="${CSS.escape(selectEl.id)}"]`);
      if (labelEl) {
        labelEl.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!trigger.disabled) toggle();
        });
      }
    }

    selectRegistry.push({ selectEl, container, toggle, syncUI });
    syncUI();
  }

  function enhanceAllSelects() {
    document.querySelectorAll("select").forEach((sel) => enhanceSelectElement(sel));
  }

  document.addEventListener("click", (e) => {
    for (const entry of selectRegistry) {
      if (entry.container.contains(e.target)) return;
    }
    closeAllCustomSelects();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeAllCustomSelects();
    }
  });

  function initCoreUI() {
    // 1. Remove any legacy module tab bar if present
    document.getElementById("core-module-nav")?.remove();

    // 2. Make header brand icon box clickable to return to the Index Hub (/) when inside a module
    const active = getActiveModuleKey();
    if (active !== "hub") {
      const brandIconBox = document.querySelector("header .w-10.h-10");
      if (brandIconBox && !brandIconBox.dataset.coreHomeBound) {
        brandIconBox.dataset.coreHomeBound = "true";
        brandIconBox.classList.add("cursor-pointer", "hover:border-zinc-700", "transition-colors");
        brandIconBox.title = "Back to All Modules (http://localhost:3000/)";
        brandIconBox.addEventListener("click", () => {
          window.location.href = "/";
        });
      }
    }

    // 3. Apply unified theme immediately
    applyTheme(getSavedTheme(), true);

    // 4. Bind #btn-theme-toggle once
    const themeBtn = document.getElementById("btn-theme-toggle");
    if (themeBtn && !themeBtn.dataset.coreThemeBound) {
      themeBtn.dataset.coreThemeBound = "true";
      themeBtn.addEventListener("click", () => {
        cycleTheme();
      });
    }

    // 5. Enhance all <select> elements into custom Zinc dropdowns
    enhanceAllSelects();

    // 6. Bind shared .status-collapsible-trigger toggle once
    if (!document.body.dataset.coreStatusCollapsibleBound) {
      document.body.dataset.coreStatusCollapsibleBound = "true";
      document.addEventListener("click", (e) => {
        const trigger = e.target.closest(".status-collapsible-trigger");
        if (!trigger) return;
        const root = trigger.closest(".status-collapsible");
        if (!root) return;
        const isOpen = root.classList.toggle("is-open");
        trigger.setAttribute("aria-expanded", String(isOpen));
      });
    }
  }

  function renderCmdOutput(detailsId, codeId, { commands = [], outputs = [], status = "success", customHtml = null } = {}) {
    const detailsEl = document.getElementById(detailsId);
    const codeEl = document.getElementById(codeId);
    if (!codeEl) return;

    codeEl.setAttribute("data-has-output", "true");

    if (customHtml) {
      codeEl.innerHTML = customHtml;
    } else {
      let html = "";
      if (commands && commands.length > 0) {
        html += commands
          .map((c) => {
            const trimmed = String(c || "").trim();
            if (trimmed.startsWith("$") || trimmed.startsWith("[") || trimmed.startsWith("#")) {
              return `<span class="text-zinc-200 font-semibold">${escapeHtml(trimmed)}</span>`;
            }
            return `<span class="text-zinc-200 font-semibold">$ ${escapeHtml(trimmed)}</span>`;
          })
          .join("\n");
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

  function showConfirmModal({
    title = "Confirm Action",
    message = "Are you sure you want to proceed?",
    confirmText = "Confirm",
    icon = "trash-2",
    alertOnly = false,
  } = {}) {
    return new Promise((resolve) => {
      const modal = document.getElementById("modal-confirm");
      if (!modal) return resolve(false);

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
      if (proceedBtn) {
        proceedBtn.className = "w-full btn-solid h-9 sm:h-8 text-xs font-medium rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer";
      }

      if (window.lucide) window.lucide.createIcons();
      modal.style.display = "flex";

      function cleanup(result) {
        modal.style.display = "none";
        if (proceedBtn) proceedBtn.onclick = null;
        if (closeBtn) closeBtn.onclick = null;
        modal.onclick = null;
        window.removeEventListener("keydown", onKeydown);
        resolve(result);
      }

      function onKeydown(e) {
        if (e.key === "Escape") cleanup(false);
        else if (e.key === "Enter") cleanup(true);
      }

      if (proceedBtn) {
        proceedBtn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          cleanup(true);
        };
      }
      if (closeBtn) {
        closeBtn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          cleanup(false);
        };
      }
      modal.onclick = (e) => {
        if (e.target === modal) cleanup(false);
      };
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

  function renderStatusCollapsible({ id = "", valid = true, headlineHtml = "", bodyHtml = "" } = {}) {
    const stateClass = valid ? "valid" : "invalid";
    const iconName = valid ? "check-circle-2" : "x-circle";
    if (!bodyHtml) {
      return `
        <div class="result-banner ${stateClass}">
          <i data-lucide="${iconName}" class="w-4 h-4 shrink-0 mt-0.5 self-start"></i>
          <div class="text-xs font-mono font-medium leading-snug break-words w-full min-w-0">${headlineHtml}</div>
        </div>
      `;
    }
    return `
      <div class="status-collapsible ${stateClass}"${id ? ` id="${escapeHtml(id)}"` : ""}>
        <button type="button" class="status-collapsible-trigger" aria-expanded="false">
          <div class="flex items-start gap-2 min-w-0 flex-1">
            <i data-lucide="${iconName}" class="w-4 h-4 shrink-0 mt-0.5"></i>
            <div class="text-xs font-mono font-medium leading-snug break-words min-w-0">${headlineHtml}</div>
          </div>
          <span class="status-label-show self-center text-[10px] font-mono opacity-75 hover:opacity-100 transition-opacity shrink-0">Show</span>
          <span class="status-label-hide self-center text-[10px] font-mono opacity-75 hover:opacity-100 transition-opacity shrink-0">Hide</span>
        </button>
        <div class="status-collapsible-body">${bodyHtml}</div>
      </div>
    `;
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

  function initRoleDropdown({ onSelectRole, addButtonId, onAddClick } = {}) {
    const trigger = document.getElementById("role-dropdown-trigger");
    if (trigger && !trigger.dataset.coreRoleBound) {
      trigger.dataset.coreRoleBound = "true";
      trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleRoleDropdown();
      });
    }

    if (!document.body.dataset.coreRoleDocBound) {
      document.body.dataset.coreRoleDocBound = "true";
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
    }

    const items = document.getElementById("role-dropdown-items");
    if (items && !items.dataset.coreRoleItemsBound) {
      items.dataset.coreRoleItemsBound = "true";
      items.addEventListener("click", (e) => {
        const btn = e.target.closest(".role-option-item");
        if (!btn) return;
        const selectedRole = btn.getAttribute("data-role");
        toggleRoleDropdown(false);
        if (selectedRole && typeof onSelectRole === "function") {
          onSelectRole(selectedRole);
        }
      });
    }

    if (addButtonId && typeof onAddClick === "function") {
      const addBtn = document.getElementById(addButtonId);
      if (addBtn && !addBtn.dataset.coreRoleAddBound) {
        addBtn.dataset.coreRoleAddBound = "true";
        addBtn.addEventListener("click", () => {
          toggleRoleDropdown(false);
          onAddClick();
        });
      }
    }
  }

  // Apply class & meta immediately on script load to avoid flash
  applyTheme(getSavedTheme(), false);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initCoreUI);
  } else {
    initCoreUI();
  }

  // Keep theme synced across tabs and browser back/forward cache
  window.addEventListener("storage", (e) => {
    if (e.key === THEME_KEY || e.key === SCHEME_KEY) {
      applyTheme(getSavedTheme(), false);
    }
  });

  window.addEventListener("pageshow", () => {
    applyTheme(getSavedTheme(), false);
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (getSavedTheme() === "system") {
      applyTheme("system", false);
    }
  });

  window.SSLCore = {
    escapeHtml,
    shortHex,
    getActiveModuleKey,
    getSavedTheme,
    applyTheme,
    cycleTheme,
    enhanceAllSelects,
    renderCmdOutput,
    showConfirmModal,
    showAlertModal,
    renderStatusCollapsible,
    toggleRoleDropdown,
    initRoleDropdown,
  };
})();
