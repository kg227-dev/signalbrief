/* SignalBrief — index.js (onboarding UI runtime) */

const Prefs = window.SignalBriefPrefs || {};
const IndexHelpersRuntime = window.SignalBriefIndexHelpersRuntime || {};
const IndexFormRuntime = window.SignalBriefIndexFormRuntime || {};
const DEBUG_UI = window.location.search.includes("debug_ui=1");
const requestHelpers = typeof IndexHelpersRuntime.createRequestHelpers === "function"
  ? IndexHelpersRuntime.createRequestHelpers({ debugEnabled: DEBUG_UI })
  : null;
const darkModeHelpers = typeof IndexHelpersRuntime.createDarkModeHelpers === "function"
  ? IndexHelpersRuntime.createDarkModeHelpers({ debugEnabled: DEBUG_UI })
  : null;
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

  if (typeof IndexHelpersRuntime.appendTopicGroup === "function") {
    IndexHelpersRuntime.appendTopicGroup(topicGrid, "Industries", INDUSTRY_TOPICS, topicDisplayLabel, toggleTopic);
    IndexHelpersRuntime.appendTopicGroup(topicGrid, "Capabilities", CAPABILITY_TOPICS, topicDisplayLabel, toggleTopic);
  }
}

async function ensureTopicCatalogLoaded() {
  if (typeof Prefs.loadTopicCatalog !== "function") return;
  try {
    await Prefs.loadTopicCatalog();
  } catch (err) {
    if (DEBUG_UI) {
      const message = err && err.message ? err.message : String(err || "unknown error");
      console.warn(`[index] topic catalog fallback: ${message}`);
    }
  }
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

const indexForm = typeof IndexFormRuntime.createIndexFormContext === "function"
  ? IndexFormRuntime.createIndexFormContext({
      Prefs,
      prefState,
      requestHelpers,
      selectedTopicKeys,
      getSelectedDepth,
      getSelectedDays,
      getDaysFrequency,
      getItemsPerDigest,
      debugEnabled: DEBUG_UI,
    })
  : null;

function showOnboarding() {
  if (indexForm && typeof indexForm.showOnboarding === "function") {
    indexForm.showOnboarding();
    return;
  }
  const hero = document.querySelector(".hero");
  const onboard = document.getElementById("onboard-form");
  if (!hero || !onboard) return;
  hero.style.display = "none";
  onboard.style.display = "block";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showLanding() {
  if (indexForm && typeof indexForm.showLanding === "function") {
    indexForm.showLanding();
    return;
  }
  const hero = document.querySelector(".hero");
  const onboard = document.getElementById("onboard-form");
  if (!hero || !onboard) return;
  onboard.style.display = "none";
  hero.style.display = "block";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateProgress() {
  if (indexForm && typeof indexForm.updateProgress === "function") {
    indexForm.updateProgress();
    return;
  }
  const name = String(document.getElementById("name")?.value || "").trim();
  const email = String(document.getElementById("email")?.value || "").trim();
  const topicCount = selectedTopicKeys().length;
  const depth = getSelectedDepth();
  const dayCount = getSelectedDays().length;
  [
    ["prog-1", !!(name && email)],
    ["prog-2", topicCount >= 2],
    ["prog-3", !!depth],
    ["prog-4", dayCount > 0],
  ].forEach(([id, filled]) => {
    const step = document.getElementById(id);
    if (step) step.className = `progress-step${filled ? " filled" : ""}`;
  });
}

function switchPreview(panel, btn) {
  if (indexForm && typeof indexForm.switchPreview === "function") {
    indexForm.switchPreview(panel, btn);
    return;
  }
  document.getElementById("prev-telegram").style.display = panel === "telegram" ? "block" : "none";
  document.getElementById("prev-email").style.display = panel === "email" ? "block" : "none";
}

// -- Dark mode ----------------------------------------------------------------
function toggleDark() {
  if (!darkModeHelpers) return;
  darkModeHelpers.toggleDarkMode();
}

if (darkModeHelpers) darkModeHelpers.initDarkMode();

(async function initFormState() {
  if (indexForm) {
    indexForm.bindProgressInputs();
    indexForm.bindSignupForm();
  }

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
