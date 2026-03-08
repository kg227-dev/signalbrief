/* SignalBrief — index.js (onboarding UI runtime) */

const Prefs = window.SignalBriefPrefs || {};
const INDUSTRY_TOPICS = Array.isArray(Prefs.INDUSTRY_TOPICS) ? Prefs.INDUSTRY_TOPICS : [];
const CAPABILITY_TOPICS = Array.isArray(Prefs.CAPABILITY_TOPICS) ? Prefs.CAPABILITY_TOPICS : [];
const prefState = typeof Prefs.createPreferenceState === "function"
  ? Prefs.createPreferenceState({
      depth: Prefs.DEFAULT_DEPTH || "headline_plus_why",
      daysOfWeek: [],
      itemsPerDigest: 5,
      deliveryTime: "07:00",
    })
  : null;

function showOnboarding() {
  const hero = document.querySelector(".hero");
  const onboard = document.getElementById("onboard-form");
  if (!hero || !onboard) return;
  hero.style.display = "none";
  onboard.style.display = "block";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showLanding() {
  const hero = document.querySelector(".hero");
  const onboard = document.getElementById("onboard-form");
  if (!hero || !onboard) return;
  onboard.style.display = "none";
  hero.style.display = "block";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function selectedTopicKeys() {
  if (prefState) return prefState.getTopics();
  return Array.from(document.querySelectorAll(".topic-chip.selected"))
    .map((chip) => chip.dataset.topic)
    .filter(Boolean);
}

function findTopicChip(topic) {
  return Array.from(document.querySelectorAll(".topic-chip")).find((chip) => chip.dataset.topic === topic) || null;
}

function topicDisplayLabel(topic) {
  if (typeof Prefs.topicDisplayLabel === "function") return Prefs.topicDisplayLabel(topic);
  return String(topic || "").replace(/^custom_/, "").replace(/_/g, " ");
}

function renderTopicCatalog() {
  const topicGrid = document.getElementById("topicGrid");
  if (!topicGrid) return;
  topicGrid.innerHTML = "";

  const appendGroup = (label, topics) => {
    if (!Array.isArray(topics) || !topics.length) return;
    const heading = document.createElement("div");
    heading.className = "topic-group-label";
    heading.textContent = label;
    topicGrid.appendChild(heading);
    topics.forEach((topic) => {
      const chip = document.createElement("div");
      chip.className = "topic-chip";
      chip.dataset.topic = topic;
      chip.innerHTML = `<span class="check"></span> ${topicDisplayLabel(topic)}`;
      chip.addEventListener("click", () => toggleTopic(chip));
      topicGrid.appendChild(chip);
    });
  };

  appendGroup("Industries", INDUSTRY_TOPICS);
  appendGroup("Capabilities", CAPABILITY_TOPICS);
}

async function ensureTopicCatalogLoaded() {
  if (typeof Prefs.loadTopicCatalog !== "function") return;
  try {
    await Prefs.loadTopicCatalog();
  } catch (err) {
    if (window.location.search.includes("debug_ui=1")) {
      const message = err && err.message ? err.message : String(err || "unknown error");
      console.warn(`[index] topic catalog fallback: ${message}`);
    }
  }
}

function buildRequestError(message, extra = {}) {
  const err = new Error(message);
  Object.assign(err, extra);
  return err;
}

async function fetchJsonStrict(url, options = {}) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (err) {
    throw buildRequestError("network_error", { kind: "network", cause: err });
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch (err) {
    if (window.location.search.includes("debug_ui=1")) {
      console.warn("[index] non-JSON response:", err.message);
    }
    payload = null;
  }

  if (!response.ok) {
    const apiMessage = payload && typeof payload.error === "string" ? payload.error.trim() : "";
    throw buildRequestError(apiMessage || `request_failed_${response.status}`, {
      kind: "http",
      status: response.status,
      payload,
    });
  }

  if (!payload || typeof payload !== "object") {
    throw buildRequestError("invalid_json_response", { kind: "decode", status: response.status });
  }

  return payload;
}

function mapRequestError(err, fallbackMessage) {
  if (err && err.kind === "network") return "Network error. Please try again.";
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
  return fallbackMessage || "Something went wrong. Please try again.";
}

// -- Topic chips --------------------------------------------------------------
function toggleTopic(topicChip) {
  const topic = String(topicChip?.dataset?.topic || "").trim();
  if (!topic) return;

  const isSelected = prefState
    ? prefState.toggleTopic(topic)
    : !topicChip.classList.contains("selected");

  topicChip.classList.toggle("selected", isSelected);
  updateProgress();
}

function addCustomTopic() {
  const input = document.getElementById("customTopic");
  const value = String(input?.value || "").trim();
  if (!value) return;

  const slug = typeof Prefs.normalizeCustomTopicInput === "function"
    ? Prefs.normalizeCustomTopicInput(value)
    : `custom_${value.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;

  if (!slug) {
    input.value = "";
    return;
  }

  const existing = findTopicChip(slug);
  if (existing) {
    if (prefState && !prefState.hasTopic(slug)) {
      prefState.addTopic(slug);
      existing.classList.add("selected");
    }
    input.value = "";
    updateProgress();
    return;
  }

  const chip = document.createElement("div");
  chip.className = "topic-chip topic-chip-custom selected";
  chip.dataset.topic = slug;
  chip.onclick = function onclick() { toggleTopic(chip); };
  chip.innerHTML = `<span class="check"></span> ${value}`;

  const topicGrid = document.getElementById("topicGrid");
  if (topicGrid) topicGrid.appendChild(chip);

  if (prefState) prefState.addTopic(slug);

  input.value = "";
  updateProgress();
}

document.getElementById("customTopic").addEventListener("keypress", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addCustomTopic();
  }
});

// -- Depth -------------------------------------------------------------------
function setSelectedDepth(depthOption) {
  const depth = String(depthOption?.dataset?.depth || "").trim() || "headline_plus_why";
  if (prefState) prefState.setDepth(depth);

  document.querySelectorAll(".depth-option").forEach((option) => {
    option.classList.toggle("selected", option.dataset.depth === depth);
  });

  updateProgress();
}

function getSelectedDepth() {
  if (prefState) return prefState.getDepth();
  const selected = document.querySelector(".depth-option.selected");
  return selected ? selected.dataset.depth : "headline_plus_why";
}

function initDepthSelector(initialDepth) {
  const depth = String(initialDepth || "").trim() || "headline_plus_why";
  if (prefState) prefState.setDepth(depth);
  const fallback = document.querySelector(`.depth-option[data-depth="${depth}"]`)
    || document.querySelector(`.depth-option[data-depth="headline_plus_why"]`);
  if (fallback) setSelectedDepth(fallback);
}

// -- Size toggle (2-pill) ----------------------------------------------------
function selectItemsPerDigest(sizePill) {
  const itemsPerDigest = Number(sizePill?.dataset?.size || 5);
  document.querySelectorAll(".size-pill").forEach((pill) => {
    pill.classList.toggle("selected", pill === sizePill);
  });
  if (prefState) prefState.setItemsPerDigest(itemsPerDigest);
}

function getItemsPerDigest() {
  if (prefState) return prefState.getItemsPerDigest();
  const selected = document.querySelector(".size-pill.selected");
  return selected ? parseInt(selected.dataset.size, 10) : 5;
}

// Backward-compatible aliases for any stale inline handlers.
function selectSize(sizePill) {
  selectItemsPerDigest(sizePill);
}

function getSize() {
  return getItemsPerDigest();
}

// -- Day circles --------------------------------------------------------------
function syncDayPresets() {
  const days = prefState
    ? prefState.getDays()
    : Array.from(document.querySelectorAll(".day-circle.active")).map((c) => parseInt(c.dataset.day, 10));

  const isWeekdays = typeof Prefs.isWeekdays === "function"
    ? Prefs.isWeekdays(days)
    : (days.length === 5 && [1, 2, 3, 4, 5].every((day) => days.includes(day)));

  const isEveryday = typeof Prefs.isEveryday === "function"
    ? Prefs.isEveryday(days)
    : days.length === 7;

  document.getElementById("preset-weekdays")?.classList.toggle("active", isWeekdays);
  document.getElementById("preset-everyday")?.classList.toggle("active", isEveryday);
}

function renderDays() {
  const days = prefState
    ? prefState.getDays()
    : Array.from(document.querySelectorAll(".day-circle.active")).map((c) => parseInt(c.dataset.day, 10));

  document.querySelectorAll(".day-circle").forEach((circle) => {
    const day = parseInt(circle.dataset.day, 10);
    circle.classList.toggle("active", days.includes(day));
  });

  syncDayPresets();
}

function toggleDay(dayCircle) {
  const day = parseInt(dayCircle?.dataset?.day, 10);
  if (prefState) prefState.toggleDay(day);
  dayCircle.classList.toggle(
    "active",
    prefState ? prefState.getDays().includes(day) : !dayCircle.classList.contains("active")
  );
  syncDayPresets();
  updateProgress();
}

function setDays(preset) {
  if (prefState) prefState.setDaysPreset(preset);
  renderDays();
  updateProgress();
}

function getSelectedDays() {
  if (prefState) return prefState.getDays();
  return Array.from(document.querySelectorAll(".day-circle.active")).map((circle) => parseInt(circle.dataset.day, 10));
}

function getDaysFrequency() {
  if (prefState) return prefState.getFrequency();
  const days = getSelectedDays();
  if (days.length === 5 && [1, 2, 3, 4, 5].every((day) => days.includes(day))) return "daily_weekday";
  if (days.length === 7) return "daily_all";
  return "custom";
}

// -- Progress ----------------------------------------------------------------
function updateProgress() {
  const name = document.getElementById("name").value.trim();
  const email = document.getElementById("email").value.trim();
  const topicCount = selectedTopicKeys().length;
  const depth = getSelectedDepth();
  const dayCount = getSelectedDays().length;

  function setStep(id, filled) {
    const step = document.getElementById(id);
    if (!step) return;
    step.className = `progress-step${filled ? " filled" : ""}`;
  }

  setStep("prog-1", !!(name && email));
  setStep("prog-2", topicCount >= 2);
  setStep("prog-3", !!depth);
  setStep("prog-4", dayCount > 0);
}

document.getElementById("name").addEventListener("input", updateProgress);
document.getElementById("email").addEventListener("input", updateProgress);

function showSubmitError(msg) {
  const el = document.getElementById("submitError");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("visible");
}

function clearSubmitError() {
  const el = document.getElementById("submitError");
  if (!el) return;
  el.textContent = "";
  el.classList.remove("visible");
}

// -- Form submit --------------------------------------------------------------
document.getElementById("onboardForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearSubmitError();

  const topics = selectedTopicKeys();
  if (topics.length < 2) {
    showSubmitError("Please select at least 2 topics.");
    return;
  }

  const name = document.getElementById("name").value.trim();
  const email = document.getElementById("email").value.trim();
  if (!name || !email) {
    showSubmitError("Name and email are required.");
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showSubmitError("Please enter a valid email address.");
    document.getElementById("email").focus();
    return;
  }

  const days = getSelectedDays();
  if (!days.length) {
    showSubmitError("Please select at least one delivery day.");
    return;
  }

  const btn = document.querySelector(".submit-btn");
  btn.disabled = true;
  btn.textContent = "Subscribing…";

  const deliveryTime = document.getElementById("deliveryTime").value || "07:00";
  const referralToken = (new URLSearchParams(window.location.search).get("ref") || "").trim();

  if (prefState) {
    prefState.setTopics(topics);
    prefState.setDepth(getSelectedDepth());
    prefState.setDeliveryTime(deliveryTime);
    prefState.setDays(days);
    prefState.setItemsPerDigest(getItemsPerDigest());
  }

  const payload = (prefState && typeof Prefs.buildSignupPayload === "function")
    ? Prefs.buildSignupPayload({
        state: prefState,
        name,
        email,
        telegram: document.getElementById("telegram").value,
        referralToken,
      })
    : {
        name,
        email,
        telegram: document.getElementById("telegram").value.trim().replace(/^@+/, "") || null,
        topics,
        depth: getSelectedDepth(),
        delivery_time: deliveryTime,
        frequency: getDaysFrequency(),
        days_of_week: days,
        items_per_digest: getItemsPerDigest(),
        referral_token: referralToken || null,
      };

  try {
    const result = await fetchJsonStrict("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (result.success || result.account_created === true) {
      clearSubmitError();
      document.getElementById("onboardForm").style.display = "none";
      document.getElementById("formFooter").style.display = "none";
      document.getElementById("successCard").classList.add("visible");
      document.querySelectorAll(".progress-step").forEach((step) => {
        step.className = "progress-step filled";
      });

      const settingsLink = document.getElementById("settingsLink");
      if (settingsLink && result.token) {
        settingsLink.href = `/settings?token=${encodeURIComponent(result.token)}`;
      }

      const archiveLink = document.getElementById("archiveLink");
      if (archiveLink && result.archiveUrl) {
        archiveLink.href = result.archiveUrl;
      }

      const timeParts = deliveryTime.split(":").map(Number);
      const hour24 = timeParts[0];
      const minutes = timeParts[1];
      const ampm = hour24 >= 12 ? "PM" : "AM";
      const hour12 = hour24 % 12 || 12;
      const prettyTime = `${hour12}:${String(minutes).padStart(2, "0")} ${ampm} ET`;
      document.getElementById("successDeliveryMsg").innerHTML = `Your first SignalBrief arrives at <strong>${prettyTime}</strong>. Here's a preview of what to expect:`;
      if (Array.isArray(result.warnings) && result.warnings.length) {
        console.warn("[signup] completed with side-effect warnings:", result.warnings);
      }
      return;
    }
    throw buildRequestError(result.error || "Could not complete signup.");
  } catch (err) {
    showSubmitError(mapRequestError(err, "Something went wrong. Please try again."));
    btn.disabled = false;
    btn.textContent = "Start my SignalBrief →";
  }
});

// -- Preview tab switcher -----------------------------------------------------
function switchPreview(panel, btn) {
  document.getElementById("prev-telegram").style.display = panel === "telegram" ? "block" : "none";
  document.getElementById("prev-email").style.display = panel === "email" ? "block" : "none";
  document.querySelectorAll(".prev-tab").forEach((tab) => {
    tab.style.borderColor = "#E5E7EB";
    tab.style.background = "#fff";
    tab.style.color = "#6B7280";
    tab.style.fontWeight = "500";
  });
  btn.style.borderColor = "#2563EB";
  btn.style.background = "#EFF6FF";
  btn.style.color = "#2563EB";
  btn.style.fontWeight = "600";
}

// -- Dark mode ----------------------------------------------------------------
function reportStorageError(context, err) {
  if (!window.location.search.includes("debug_ui=1")) return;
  const message = err && err.message ? err.message : String(err || "unknown error");
  console.warn(`[index] localStorage ${context} failed: ${message}`);
}

function toggleDark() {
  document.body.classList.toggle("dark");
  const isDark = document.body.classList.contains("dark");
  document.getElementById("darkToggle").textContent = isDark ? "☀️" : "🌙";
  try {
    localStorage.setItem("sbDark", isDark ? "1" : "0");
  } catch (err) {
    reportStorageError("write", err);
  }
}

(function initDark() {
  try {
    if (localStorage.getItem("sbDark") === "1") {
      document.body.classList.add("dark");
      document.getElementById("darkToggle").textContent = "☀️";
    }
  } catch (err) {
    reportStorageError("read", err);
  }
})();

(async function initFormState() {
  await ensureTopicCatalogLoaded();
  renderTopicCatalog();

  if (!prefState) {
    updateProgress();
    return;
  }

  prefState.setTopics([]);

  const selectedSize = document.querySelector(".size-pill.selected");
  if (selectedSize) prefState.setItemsPerDigest(selectedSize.dataset.size);

  const deliverySelect = document.getElementById("deliveryTime");
  if (deliverySelect) {
    prefState.setDeliveryTime(deliverySelect.value || "07:00");
    deliverySelect.addEventListener("change", () => {
      prefState.setDeliveryTime(deliverySelect.value || "07:00");
    });
  }

  initDepthSelector(prefState.getDepth());
  renderDays();
  updateProgress();
})();
