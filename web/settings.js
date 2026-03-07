/* SignalBrief — settings.js (settings UI runtime) */

const INDUSTRY_TOPICS = [
  'HEALTHCARE', 'FINANCIAL SERVICES', 'PE×M&A', 'ENERGY', 'CONSUMER',
  'LIFE SCIENCES', 'TECHNOLOGY', 'INDUSTRIALS', 'REAL ESTATE', 'PUBLIC SECTOR',
];
const CAPABILITY_TOPICS = [
  'AI×TECH', 'STRATEGY', 'POLICY×REGULATORY', 'SUSTAINABILITY',
  'DIGITAL', 'M&A ADVISORY', 'TALENT',
];
const DEFAULT_TOPICS = [...INDUSTRY_TOPICS, ...CAPABILITY_TOPICS];

const TOPIC_LABELS = {
  'HEALTHCARE': 'Healthcare',
  'FINANCIAL SERVICES': 'Financial Services',
  'PE×M&A': 'Private Equity & M&A',
  'ENERGY': 'Energy',
  'CONSUMER': 'Consumer & Retail',
  'LIFE SCIENCES': 'Life Sciences',
  'TECHNOLOGY': 'Technology',
  'INDUSTRIALS': 'Industrials',
  'REAL ESTATE': 'Real Estate',
  'PUBLIC SECTOR': 'Public Sector',
  'AI×TECH': 'AI & Technology',
  'STRATEGY': 'Strategy',
  'POLICY×REGULATORY': 'Policy & Regulatory',
  'SUSTAINABILITY': 'Sustainability & ESG',
  'DIGITAL': 'Digital Transformation',
  'M&A ADVISORY': 'M&A Advisory',
  'TALENT': 'Talent & Workforce',
};

let selectedTopics = new Set();
const byId = (id) => document.getElementById(id);

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
    throw buildRequestError('network_error', { kind: 'network', cause: err });
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const apiMessage = data && typeof data.error === 'string' ? data.error.trim() : '';
    throw buildRequestError(apiMessage || `request_failed_${res.status}`, {
      kind: 'http',
      status: res.status,
      payload: data,
    });
  }

  if (!data || typeof data !== 'object') {
    throw buildRequestError('invalid_json_response', { kind: 'decode', status: res.status });
  }
  return data;
}

function mapRequestError(err, action) {
  const fallback = {
    load: 'Could not load your preferences. Check your connection and try again.',
    save: 'Could not save your preferences right now. Please try again.',
    unsubscribe: 'Could not unsubscribe right now. Please try again.',
    request_link: 'Something went wrong. Please try again.',
  }[action] || 'Something went wrong. Please try again.';

  if (action === 'load' && err && err.status === 404) return 'not_found';
  if (err && err.kind === 'network') return 'Network error. Check your connection and try again.';

  const apiMessage = err && err.payload && typeof err.payload.error === 'string'
    ? err.payload.error.trim()
    : '';
  if (apiMessage) return apiMessage;

  if (err && typeof err.message === 'string' && err.message && !err.message.startsWith('request_failed_') && err.message !== 'invalid_json_response') {
    return err.message;
  }

  return fallback;
}

function renderUnsubscribedState(formEl) {
  formEl.innerHTML = `
    <div class="form-section" style="text-align:center;padding:48px 24px;">
      <div style="font-size:40px;margin-bottom:16px;">👋</div>
      <h2 style="font-family:'Instrument Serif',serif;font-weight:400;font-size:26px;margin-bottom:8px;">You're unsubscribed.</h2>
      <p style="color:#6B7280;">No more digests. <a href="/" style="color:#2563EB;">Re-subscribe anytime →</a></p>
    </div>`;
}

// ── Custom topic display helpers ──────────────────────────────────────────────
function isCustomTopic(t) {
  return !DEFAULT_TOPICS.includes(t);
}

function formatCustomLabel(slug) {
  // "custom_otsuka" → "Otsuka"  |  "custom_glp_1" → "GLP 1"  |  "GLP-1" → "GLP-1"
  return slug
    .replace(/^custom_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function topicDisplayLabel(t) {
  if (DEFAULT_TOPICS.includes(t)) return TOPIC_LABELS[t] || t;
  return formatCustomLabel(t);
}

function updateTopicNote() {
  const n = selectedTopics.size;
  const el = byId('topicMinNote');
  if (!el) return;
  el.textContent = `${n} selected${n < 2 ? ' — pick at least 2' : ''}`;
  el.style.color = (n < 2 && n > 0) ? '#DC2626' : '#6B7280';
  updateSelectedSummary();
}

function updateSelectedSummary() {
  const el = byId('selectedSummary');
  if (!el) return;
  const topics = Array.from(selectedTopics);
  if (topics.length === 0) {
    el.innerHTML = 'No topics selected yet.';
    return;
  }
  const labels = topics.map((t) => topicDisplayLabel(t));
  el.innerHTML = `<strong>${topics.length} tracking:</strong> <span class="summary-topics">${labels.join(' · ')}</span>`;
}

function renderChip(topic, selected) {
  const chip = document.createElement('div');
  const custom = isCustomTopic(topic);
  chip.className = 'chip' + (selected ? ' selected' : '') + (custom ? ' chip-custom' : '');
  chip.dataset.topic = topic;
  const label = topicDisplayLabel(topic);
  chip.innerHTML = `<span class="chip-check">✓</span> ${label}`;
  chip.addEventListener('click', () => {
    if (selectedTopics.has(topic)) {
      selectedTopics.delete(topic);
      chip.classList.remove('selected');
    } else {
      selectedTopics.add(topic);
      chip.classList.add('selected');
    }
    updateTopicNote();
  });
  return chip;
}

function renderGroupLabel(text) {
  const el = document.createElement('div');
  el.className = 'topic-group-label';
  el.textContent = text;
  return el;
}

function renderChips(topics, userTopics) {
  const container = byId('topicGrid');
  if (!container) return;
  container.innerHTML = '';

  // Render Industries group
  container.appendChild(renderGroupLabel('Industries'));
  INDUSTRY_TOPICS.forEach((t) => {
    const sel = userTopics.includes(t);
    if (sel) selectedTopics.add(t);
    container.appendChild(renderChip(t, sel));
  });

  // Render Capabilities group
  container.appendChild(renderGroupLabel('Capabilities'));
  CAPABILITY_TOPICS.forEach((t) => {
    const sel = userTopics.includes(t);
    if (sel) selectedTopics.add(t);
    container.appendChild(renderChip(t, sel));
  });

  // Render any custom topics the user has (not in default list)
  const customTopics = userTopics.filter(t => !DEFAULT_TOPICS.includes(t));
  if (customTopics.length) {
    customTopics.forEach((t) => {
      selectedTopics.add(t);
      container.appendChild(renderChip(t, true));
    });
  }

  updateTopicNote();
}

function setSelectedDepth(el) {
  document.querySelectorAll('.depth-option').forEach((o) => { o.classList.remove('selected'); });
  el.classList.add('selected');
}

function getSelectedDepth() {
  const el = document.querySelector('.depth-option.selected');
  return el ? el.dataset.depth : 'headline_plus_why';
}

function initDepthSelector(initialDepth) {
  const depth = initialDepth || 'headline_plus_why';
  document.querySelectorAll('.depth-option').forEach((opt) => {
    opt.classList.toggle('selected', opt.dataset.depth === depth);
    opt.addEventListener('click', () => { setSelectedDepth(opt); });
  });
}

// ── Day circle helpers ────────────────────────────────────────────────────────
function daysFromFrequency(freq) {
  if (freq === 'daily_all') return [0, 1, 2, 3, 4, 5, 6];
  if (freq === 'daily_weekday' || freq === 'weekdays') return [1, 2, 3, 4, 5];
  if (freq === 'sixdays') return [1, 2, 3, 4, 5, 6];
  return [1, 2, 3, 4, 5]; // default weekdays
}

function initSettingsDays(days) {
  document.querySelectorAll('#dayCircles .day-circle').forEach((c) => {
    c.classList.toggle('active', days.includes(parseInt(c.dataset.day)));
  });
  syncSettingsDayPresets();
}

function toggleSettingsDay(el) {
  el.classList.toggle('active');
  syncSettingsDayPresets();
}

function setSettingsDays(preset) {
  document.querySelectorAll('#dayCircles .day-circle').forEach((c) => {
    const day = parseInt(c.dataset.day);
    if (preset === 'weekdays') c.classList.toggle('active', day >= 1 && day <= 5);
    else if (preset === 'everyday') c.classList.add('active');
  });
  syncSettingsDayPresets();
}

function syncSettingsDayPresets() {
  const active = Array.from(document.querySelectorAll('#dayCircles .day-circle.active'))
    .map((c) => parseInt(c.dataset.day));
  const isWeekdays = active.length === 5 && [1,2,3,4,5].every((d) => active.includes(d));
  const isEveryday = active.length === 7;
  byId('preset-weekdays').classList.toggle('active', isWeekdays);
  byId('preset-everyday').classList.toggle('active', isEveryday);
}

function getSettingsDays() {
  return Array.from(document.querySelectorAll('#dayCircles .day-circle.active'))
    .map((c) => parseInt(c.dataset.day));
}

function getSettingsFrequency() {
  const days = getSettingsDays();
  const isWeekdays = days.length === 5 && [1,2,3,4,5].every((d) => days.includes(d));
  const isEveryday = days.length === 7;
  if (isWeekdays) return 'daily_weekday';
  if (isEveryday) return 'daily_all';
  return 'custom';
}

function loadSettingsUser(token) {
  return fetchJsonStrict('/api/user?token=' + encodeURIComponent(token));
}

function renderLoadError(loadingEl, notFoundEl, err) {
  loadingEl.style.display = 'none';
  const loadMessage = mapRequestError(err, 'load');
  if (loadMessage === 'not_found') {
    notFoundEl.style.display = 'block';
    return;
  }
  loadingEl.innerHTML = `
    <div style="text-align:center;padding:40px 24px;">
      <p style="color:#DC2626;font-size:14px;margin-bottom:16px;">${loadMessage}</p>
      <button onclick="window.location.reload()" style="background:#2563EB;color:#fff;border:none;padding:10px 24px;border-radius:100px;font-size:14px;font-weight:600;cursor:pointer;">Retry</button>
    </div>`;
  loadingEl.style.display = 'block';
}

function setSettingsSelectValue(id, val) {
  const el = byId(id);
  if (el && val != null) el.value = String(val);
}

function renderInitialState(user, statusBanner, loadingEl, formEl) {
  loadingEl.style.display = 'none';
  formEl.style.display = 'block';
  if (statusBanner) showBanner(statusBanner, 5000);

  byId('name').value = user.name || '';
  byId('email').value = user.email || '';
  byId('telegram').value = user.telegram ? `@${user.telegram}` : '';

  selectedTopics = new Set();
  renderChips(DEFAULT_TOPICS, user.topics || []);

  const depth = user.preferences && user.preferences.depth ? user.preferences.depth : 'headline_plus_why';
  initDepthSelector(depth);

  const prefs = user.preferences || {};
  setSettingsSelectValue('deliveryTime', prefs.delivery_time);
  setSettingsSelectValue('itemsPerDigest', prefs.items_per_digest ? String(prefs.items_per_digest) : '5');
  initSettingsDays(prefs.days_of_week || daysFromFrequency(prefs.frequency));
}

function bindTopicHandlers() {
  const addTopicBtn = byId('addTopicBtn');
  const customTopicInput = byId('customTopicInput');
  const topicGrid = byId('topicGrid');
  if (!addTopicBtn || !customTopicInput || !topicGrid) return;

  addTopicBtn.addEventListener('click', () => {
    const val = customTopicInput.value.trim();
    if (!val) {
      customTopicInput.value = '';
      return;
    }
    const matchDefault = DEFAULT_TOPICS.find((t) => t.toLowerCase() === val.toLowerCase());
    const topicKey = matchDefault || ('custom_' + val.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''));
    if (selectedTopics.has(topicKey)) {
      customTopicInput.value = '';
      return;
    }
    const chip = renderChip(topicKey, true);
    selectedTopics.add(topicKey);
    topicGrid.appendChild(chip);
    updateTopicNote();
    customTopicInput.value = '';
  });

  customTopicInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTopicBtn.click();
    }
  });
}

function bindSaveHandler(effectiveToken, user) {
  const saveBtn = byId('saveBtn');
  if (!saveBtn) return;

  saveBtn.addEventListener('click', async () => {
    if (selectedTopics.size < 2) {
      showError('Please select at least 2 topics.');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    try {
      const data = await fetchJsonStrict('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: effectiveToken,
          name: byId('name').value.trim(),
          telegram: byId('telegram').value.replace('@', '').trim() || null,
          topics: Array.from(selectedTopics),
          preferences: {
            depth: getSelectedDepth(),
            delivery_time: byId('deliveryTime').value,
            frequency: getSettingsFrequency(),
            days_of_week: getSettingsDays(),
            items_per_digest: parseInt(byId('itemsPerDigest').value),
            email_enabled: true,
            telegram_enabled: !!(user.chatId && !String(user.chatId).startsWith('email-') && (user.preferences || {}).telegram_enabled !== false),
          }
        })
      });
      if (!data.success) throw buildRequestError(data.error || 'Save failed.');
      showError('');
      showBanner('✅ Preferences saved');
    } catch (err) {
      showError(mapRequestError(err, 'save'));
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save preferences';
    }
  });
}

function scrollToUnsubscribeAnchor() {
  if (window.location.hash !== '#unsub') return;
  setTimeout(() => {
    const el = byId('unsub');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 400);
}

function bindUnsubscribeHandler(effectiveToken, formEl) {
  scrollToUnsubscribeAnchor();
  const unsubBtn = byId('unsubBtn');
  if (!unsubBtn) return;

  unsubBtn.addEventListener('click', async () => {
    if (!confirm('Unsubscribe from SignalBrief? You can re-subscribe anytime at getsignalbrief.com.')) return;
    const previousLabel = unsubBtn.textContent;
    unsubBtn.disabled = true;
    unsubBtn.textContent = 'Unsubscribing…';
    try {
      const data = await fetchJsonStrict('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: effectiveToken, status: 'unsubscribed' })
      });
      if (!data.success) throw buildRequestError(data.error || 'Unsubscribe failed.');
      showError('');
      renderUnsubscribedState(formEl);
    } catch (err) {
      showError(mapRequestError(err, 'unsubscribe'));
    } finally {
      unsubBtn.disabled = false;
      unsubBtn.textContent = previousLabel;
    }
  });
}

async function initSettingsPage() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  const statusBanner = params.get('paused') === '1'
    ? '⏸️ Digest paused. We will stop sending until you reactivate.'
    : (params.get('reactivated') === '1' ? '✅ SignalBrief reactivated. Your digest will resume.' : '');
  const archiveNavLink = byId('archiveNavLink');
  if (archiveNavLink) {
    archiveNavLink.href = token
      ? '/archive?token=' + encodeURIComponent(token)
      : '/archive';
  }
  const loadingEl = byId('loadingState');
  const formEl = byId('settingsForm');
  const notFoundEl = byId('notFoundState');

  // Show unsubscribed confirmation if redirected from /api/unsubscribe
  if (params.get('unsubscribed') === '1') {
    loadingEl.style.display = 'none';
    renderUnsubscribedState(formEl);
    formEl.style.display = 'block';
    return;
  }

  if (!token) {
    loadingEl.style.display = 'none';
    notFoundEl.style.display = 'block';
    return;
  }

  try {
    const user = await loadSettingsUser(token);
    renderInitialState(user, statusBanner, loadingEl, formEl);
    bindTopicHandlers();
    bindSaveHandler(token, user);
    bindUnsubscribeHandler(token, formEl);
  } catch (e) {
    renderLoadError(loadingEl, notFoundEl, e);
  }
}

function showError(msg) {
  const el = byId('saveError');
  if (!el) return;
  el.textContent = msg;
  // Hide the element when there's no error message to display
  el.style.display = msg ? 'block' : 'none';
}

function showBanner(msg, timeoutMs) {
  const el = byId('savedBanner');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('visible');
  const delay = Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : 3000;
  setTimeout(() => { el.classList.remove('visible'); }, delay);
}

async function requestSettingsLink() {
  const email = (byId('linkEmail').value || '').trim().toLowerCase();
  const errEl = byId('linkError');
  const sentEl = byId('linkSent');
  errEl.style.display = 'none';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errEl.textContent = 'Please enter a valid email address.';
    errEl.style.display = 'block';
    return;
  }
  try {
    const data = await fetchJsonStrict('/api/request-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    if (!data.success) throw buildRequestError(data.error || 'Link request failed.');
    // Always show success (do not reveal whether email exists).
    byId('linkFormWrap').querySelector('input').disabled = true;
    byId('linkFormWrap').querySelector('button').disabled = true;
    sentEl.style.display = 'block';
  } catch (err) {
    errEl.textContent = mapRequestError(err, 'request_link');
    errEl.style.display = 'block';
  }
}

initSettingsPage();
