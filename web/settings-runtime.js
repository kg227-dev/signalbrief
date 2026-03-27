/* SignalBrief — settings runtime orchestrator */

(function bootstrapSettingsRuntime(globalScope) {
const Prefs = globalScope.SignalBriefPrefs || {};
const SettingsUiRuntime = globalScope.SignalBriefSettingsUiRuntime || {};

const INDUSTRY_TOPICS = Array.isArray(Prefs.INDUSTRY_TOPICS)
  ? Prefs.INDUSTRY_TOPICS
  : [];
const CAPABILITY_TOPICS = Array.isArray(Prefs.CAPABILITY_TOPICS)
  ? Prefs.CAPABILITY_TOPICS
  : [];
const DEFAULT_TOPICS = Array.isArray(Prefs.DEFAULT_TOPICS)
  ? Prefs.DEFAULT_TOPICS
  : [];
const MAX_CUSTOM_KEYWORDS = Number(Prefs.MAX_CUSTOM_KEYWORDS || 0);

const prefState = typeof Prefs.createPreferenceState === "function"
  ? Prefs.createPreferenceState({
      depth: Prefs.DEFAULT_DEPTH || "headline_plus_why",
      daysOfWeek: [],
      deliveryTime: "07:00",
    })
  : null;

const byId = (id) => document.getElementById(id);
let settingsUi = null;

function sanitizeInternalPath(value, fallback) {
  const candidate = String(value || "").trim();
  if (!candidate) return fallback;
  if (!candidate.startsWith("/")) return fallback;
  if (candidate.startsWith("//")) return fallback;
  return candidate;
}

function showError(msg) {
  const el = byId("saveError");
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? "block" : "none";
}

function showBanner(msg, timeoutMs) {
  const el = byId("savedBanner");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("visible");
  const delay = Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : 3000;
  setTimeout(() => {
    el.classList.remove("visible");
  }, delay);
}

function getSettingsUi() {
  if (settingsUi) return settingsUi;
  if (typeof SettingsUiRuntime.createSettingsUiContext !== "function") return null;
  settingsUi = SettingsUiRuntime.createSettingsUiContext({
    Prefs,
    prefState,
    byId,
    INDUSTRY_TOPICS,
    CAPABILITY_TOPICS,
    DEFAULT_TOPICS,
    showError,
    showBanner,
  });
  return settingsUi;
}

async function ensureTopicCatalogLoaded() {
  if (typeof Prefs.loadTopicCatalog !== "function") return;
  try {
    await Prefs.loadTopicCatalog();
  } catch (err) {
    if (globalScope.location.search.includes("debug_settings=1")) {
      console.warn("[settings] topic catalog fallback:", err.message);
    }
  }
}

function buildRequestError(message, extra = {}) {
  const err = new Error(message);
  Object.assign(err, extra);
  return err;
}

async function fetchJsonStrict(url, options = {}) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    throw buildRequestError("network_error", { kind: "network", cause: err });
  }

  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    if (globalScope.location.search.includes("debug_settings=1")) {
      console.warn("[settings] non-JSON response:", err.message);
    }
    data = null;
  }

  if (!res.ok) {
    const apiMessage = data && typeof data.error === "string" ? data.error.trim() : "";
    throw buildRequestError(apiMessage || `request_failed_${res.status}`, {
      kind: "http",
      status: res.status,
      payload: data,
    });
  }

  if (!data || typeof data !== "object") {
    throw buildRequestError("invalid_json_response", { kind: "decode", status: res.status });
  }

  return data;
}

function mapRequestError(err, action) {
  const fallback = {
    load: "Could not load your preferences. Check your connection and try again.",
    save: "Could not save your preferences right now. Please try again.",
    unsubscribe: "Could not unsubscribe right now. Please try again.",
    request_link: "Something went wrong. Please try again.",
  }[action] || "Something went wrong. Please try again.";

  if (action === "load" && err && err.status === 404) return "not_found";
  if (err && err.kind === "network") return "Network error. Check your connection and try again.";

  const apiMessage = err && err.payload && typeof err.payload.error === "string"
    ? err.payload.error.trim()
    : "";
  if (apiMessage) return apiMessage;

  if (
    err
    && typeof err.message === "string"
    && err.message
    && !err.message.startsWith("request_failed_")
    && err.message !== "invalid_json_response"
  ) {
    return err.message;
  }

  return fallback;
}

function loadSettingsUser(token) {
  return fetchJsonStrict(`/api/user?token=${encodeURIComponent(token)}`);
}

function renderLoadError(loadingEl, notFoundEl, err) {
  loadingEl.style.display = "none";
  const loadMessage = mapRequestError(err, "load");
  if (loadMessage === "not_found") {
    notFoundEl.style.display = "block";
    return;
  }

  loadingEl.innerHTML = `
    <div style="text-align:center;padding:40px 24px;">
      <p style="color:#DC2626;font-size:14px;margin-bottom:16px;">${loadMessage}</p>
      <button onclick="location.reload()" style="background:#2563EB;color:#fff;border:none;padding:10px 24px;border-radius:100px;font-size:14px;font-weight:600;cursor:pointer;">Retry</button>
    </div>`;
  loadingEl.style.display = "block";
}

function configureAdminNav(params, token) {
  const archiveNavLink = byId("archiveNavLink");
  const adminBackLink = byId("adminBackLink");
  const isAdminView = params.get("admin") === "1";
  const adminReturn = sanitizeInternalPath(params.get("admin_return"), "/admin");

  if (archiveNavLink) {
    if (isAdminView) {
      archiveNavLink.href = token
        ? `/archive?token=${encodeURIComponent(token)}&admin=1&admin_return=${encodeURIComponent(adminReturn)}`
        : `/archive?admin=1&admin_return=${encodeURIComponent(adminReturn)}`;
    } else {
      archiveNavLink.href = token ? `/archive?token=${encodeURIComponent(token)}` : "/archive";
    }
  }

  if (adminBackLink) {
    if (isAdminView) {
      adminBackLink.href = adminReturn;
      adminBackLink.style.display = "inline-flex";
    } else {
      adminBackLink.style.display = "none";
    }
  }
}

function bindSaveHandler(effectiveToken, user) {
  const saveBtn = byId("saveBtn");
  if (!saveBtn || !prefState) return;

  saveBtn.addEventListener("click", async () => {
    const topicCount = prefState.getTopics().length;
    if (topicCount < 1) {
      showError("Please select at least 1 topic.");
      return;
    }
    if (topicCount > 3) {
      showError("Please select no more than 3 topics.");
      return;
    }
    const customCount = prefState.getTopics().filter((topic) => (
      typeof Prefs.isCustomTopic === "function"
        ? Prefs.isCustomTopic(topic)
        : !DEFAULT_TOPICS.includes(String(topic || ""))
    )).length;
    if (customCount > MAX_CUSTOM_KEYWORDS) {
      showError(`You can track up to ${MAX_CUSTOM_KEYWORDS} custom keywords.`);
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";

    try {
      prefState.setDeliveryTime(byId("deliveryTime").value || "07:00");

      const ui = getSettingsUi();
      const payload = typeof Prefs.buildSettingsPayload === "function"
        ? Prefs.buildSettingsPayload({
            state: prefState,
            token: effectiveToken,
            name: byId("name").value.trim(),
          })
        : {
            token: effectiveToken,
            name: byId("name").value.trim(),
            topics: prefState.getTopics(),
            preferences: {
              depth: prefState.getDepth(),
              delivery_time: byId("deliveryTime").value,
              frequency: ui ? ui.getSettingsFrequency() : "custom",
              days_of_week: ui ? ui.getSettingsDays() : [],
              email_enabled: true,
            },
          };

      const data = await fetchJsonStrict("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!data.success) throw buildRequestError(data.error || "Save failed.");
      showError("");
      showBanner("✅ Preferences saved");
    } catch (err) {
      showError(mapRequestError(err, "save"));
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save preferences";
    }
  });
}

function scrollToUnsubscribeAnchor() {
  if (globalScope.location.hash !== "#unsub") return;
  setTimeout(() => {
    const el = byId("unsub");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 400);
}

function bindUnsubscribeHandler(effectiveToken, formEl) {
  scrollToUnsubscribeAnchor();
  const unsubBtn = byId("unsubBtn");
  if (!unsubBtn) return;

  unsubBtn.addEventListener("click", async () => {
    if (!confirm("Unsubscribe from SignalBrief? You can re-subscribe anytime at getsignalbrief.com.")) return;

    const previousLabel = unsubBtn.textContent;
    unsubBtn.disabled = true;
    unsubBtn.textContent = "Unsubscribing…";

    try {
      const data = await fetchJsonStrict("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: effectiveToken, status: "unsubscribed" }),
      });

      if (!data.success) throw buildRequestError(data.error || "Unsubscribe failed.");
      showError("");
      const ui = getSettingsUi();
      if (ui) ui.renderUnsubscribedState(formEl);
    } catch (err) {
      showError(mapRequestError(err, "unsubscribe"));
    } finally {
      unsubBtn.disabled = false;
      unsubBtn.textContent = previousLabel;
    }
  });
}

async function initSettingsPage() {
  await ensureTopicCatalogLoaded();
  const ui = getSettingsUi();

  const params = new URLSearchParams(globalScope.location.search);
  const token = params.get("token");
  const invalidToken = params.get("invalid_token") === "1";
  const statusBanner = params.get("paused") === "1"
    ? "⏸️ Digest paused. We will stop sending until you reactivate."
    : (params.get("reactivated") === "1"
      ? "✅ SignalBrief reactivated. Your digest will resume."
      : (invalidToken ? "Enter your email and we'll send you a link to your preferences page." : ""));

  configureAdminNav(params, token);

  const loadingEl = byId("loadingState");
  const formEl = byId("settingsForm");
  const notFoundEl = byId("notFoundState");

  if (params.get("unsubscribed") === "1") {
    loadingEl.style.display = "none";
    if (ui) ui.renderUnsubscribedState(formEl);
    formEl.style.display = "block";
    return;
  }

  if (!token) {
    loadingEl.style.display = "none";
    notFoundEl.style.display = "block";
    if (statusBanner) {
      const errEl = byId("linkError");
      if (errEl) {
        errEl.textContent = statusBanner;
        errEl.style.display = "block";
      }
    }
    return;
  }

  try {
    const user = await loadSettingsUser(token);
    globalScope._signalBriefToken = token;
    if (ui) {
      ui.renderInitialState(user, statusBanner, loadingEl, formEl);
      ui.bindTopicHandlers();
    }
    bindSaveHandler(token, user);
    bindUnsubscribeHandler(token, formEl);
  } catch (err) {
    renderLoadError(loadingEl, notFoundEl, err);
  }
}

async function requestSettingsLink() {
  const email = String(byId("linkEmail").value || "").trim().toLowerCase();
  const errEl = byId("linkError");
  const sentEl = byId("linkSent");
  errEl.style.display = "none";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errEl.textContent = "Please enter a valid email address.";
    errEl.style.display = "block";
    return;
  }

  try {
    const data = await fetchJsonStrict("/api/request-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!data.success) throw buildRequestError(data.error || "Link request failed.");

    byId("linkFormWrap").querySelector("input").disabled = true;
    byId("linkFormWrap").querySelector("button").disabled = true;
    sentEl.style.display = "block";
  } catch (err) {
    errEl.textContent = mapRequestError(err, "request_link");
    errEl.style.display = "block";
  }
}

globalScope.SignalBriefSettingsRuntime = {
  initSettingsPage,
  setSettingsDays(preset) {
    const ui = getSettingsUi();
    if (ui) ui.setSettingsDays(preset);
  },
  toggleSettingsDay(el) {
    const ui = getSettingsUi();
    if (ui) ui.toggleSettingsDay(el);
  },
  requestSettingsLink,
};
})(window);
