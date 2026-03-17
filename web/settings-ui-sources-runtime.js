/* SignalBrief — settings UI source preferences helpers */
(function bootstrapSettingsUiSourcesRuntime(globalScope) {

  function normalizeDomain(raw) {
    return String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split(/[/\s]/)[0];
  }

  function isValidDomain(d) {
    return d.length > 0 && d.length <= 120 && /^[a-z0-9][a-z0-9.\-]*\.[a-z]{2,}$/.test(d);
  }

  function renderSourceChips(containerId, domains, onRemove) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";
    if (!domains.length) return;
    for (const domain of domains) {
      const chip = document.createElement("span");
      chip.className = "source-chip";
      chip.textContent = domain;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "source-chip-remove";
      btn.setAttribute("aria-label", `Remove ${domain}`);
      btn.textContent = "×";
      btn.addEventListener("click", () => onRemove(domain));
      chip.appendChild(btn);
      container.appendChild(chip);
    }
  }

  function createSourceState(initial) {
    const prefs = initial && typeof initial === "object" ? initial : {};
    const trusted = Array.isArray(prefs.trusted_sources) ? prefs.trusted_sources.slice() : [];
    const blocked = Array.isArray(prefs.blocked_sources) ? prefs.blocked_sources.slice() : [];

    return {
      getTrusted: () => trusted.slice(),
      getBlocked: () => blocked.slice(),
      addTrusted(domain) {
        if (!trusted.includes(domain)) {
          trusted.push(domain);
          const bi = blocked.indexOf(domain);
          if (bi !== -1) blocked.splice(bi, 1);
        }
      },
      addBlocked(domain) {
        if (!blocked.includes(domain)) {
          blocked.push(domain);
          const ti = trusted.indexOf(domain);
          if (ti !== -1) trusted.splice(ti, 1);
        }
      },
      remove(domain) {
        const ti = trusted.indexOf(domain);
        if (ti !== -1) trusted.splice(ti, 1);
        const bi = blocked.indexOf(domain);
        if (bi !== -1) blocked.splice(bi, 1);
      },
      snapshot() {
        return { trusted_sources: trusted.slice(), blocked_sources: blocked.slice() };
      },
    };
  }

  function initSourcesUi(sourceState) {
    if (!sourceState) return;

    function renderAll() {
      renderSourceChips("trustedChips", sourceState.getTrusted(), (d) => {
        sourceState.remove(d);
        renderAll();
      });
      renderSourceChips("blockedChips", sourceState.getBlocked(), (d) => {
        sourceState.remove(d);
        renderAll();
      });
    }

    renderAll();

    const addTrustedBtn = document.getElementById("addTrustedBtn");
    const trustedInput = document.getElementById("trustedSourceInput");
    const trustedError = document.getElementById("trustedSourceError");

    const addBlockedBtn = document.getElementById("addBlockedBtn");
    const blockedInput = document.getElementById("blockedSourceInput");
    const blockedError = document.getElementById("blockedSourceError");

    function tryAdd(input, errorEl, action) {
      if (!input) return;
      const domain = normalizeDomain(input.value);
      if (!domain) return;
      if (!isValidDomain(domain)) {
        if (errorEl) { errorEl.textContent = "Enter a valid domain like reuters.com"; errorEl.style.display = "block"; }
        return;
      }
      if (errorEl) errorEl.style.display = "none";
      action(domain);
      input.value = "";
      renderAll();
    }

    if (addTrustedBtn) {
      addTrustedBtn.addEventListener("click", () => tryAdd(trustedInput, trustedError, (d) => sourceState.addTrusted(d)));
    }
    if (trustedInput) {
      trustedInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); tryAdd(trustedInput, trustedError, (d) => sourceState.addTrusted(d)); }
      });
    }

    if (addBlockedBtn) {
      addBlockedBtn.addEventListener("click", () => tryAdd(blockedInput, blockedError, (d) => sourceState.addBlocked(d)));
    }
    if (blockedInput) {
      blockedInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); tryAdd(blockedInput, blockedError, (d) => sourceState.addBlocked(d)); }
      });
    }
  }

  globalScope.SignalBriefSettingsUiSourcesRuntime = {
    createSourceState,
    initSourcesUi,
  };
})(window);
