/* SignalBrief — settings.js
   Loaded only by settings.html — handles load, save, unsubscribe. */

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

function updateTopicNote() {
  const n = selectedTopics.size;
  const el = document.getElementById('topicMinNote');
  if (!el) return;
  el.textContent = n + ' selected' + (n < 2 ? ' — pick at least 2' : '');
  el.style.color = (n < 2 && n > 0) ? '#DC2626' : '#6B7280';
  updateSelectedSummary();
}

function updateSelectedSummary() {
  const el = document.getElementById('selectedSummary');
  if (!el) return;
  const topics = Array.from(selectedTopics);
  if (topics.length === 0) {
    el.innerHTML = 'No topics selected yet.';
    return;
  }
  const labels = topics.map(function(t) { return TOPIC_LABELS[t] || t; });
  el.innerHTML = '<strong>' + topics.length + ' tracking:</strong> <span class="summary-topics">' + labels.join(' · ') + '</span>';
}

function renderChip(topic, selected) {
  const chip = document.createElement('div');
  chip.className = 'chip' + (selected ? ' selected' : '');
  chip.dataset.topic = topic;
  const label = TOPIC_LABELS[topic] || topic;
  chip.innerHTML = '<span class="chip-check">✓</span> ' + label;
  chip.addEventListener('click', function() {
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
  const container = document.getElementById('topicGrid');
  if (!container) return;
  container.innerHTML = '';

  // Render Industries group
  container.appendChild(renderGroupLabel('Industries'));
  INDUSTRY_TOPICS.forEach(function(t) {
    const sel = userTopics.includes(t);
    if (sel) selectedTopics.add(t);
    container.appendChild(renderChip(t, sel));
  });

  // Render Capabilities group
  container.appendChild(renderGroupLabel('Capabilities'));
  CAPABILITY_TOPICS.forEach(function(t) {
    const sel = userTopics.includes(t);
    if (sel) selectedTopics.add(t);
    container.appendChild(renderChip(t, sel));
  });

  // Render any custom topics the user has (not in default list)
  const customTopics = userTopics.filter(t => !DEFAULT_TOPICS.includes(t));
  if (customTopics.length) {
    customTopics.forEach(function(t) {
      selectedTopics.add(t);
      container.appendChild(renderChip(t, true));
    });
  }

  updateTopicNote();
}

function selectDepth(el) {
  document.querySelectorAll('.depth-option').forEach(function(o) { o.classList.remove('selected'); });
  el.classList.add('selected');
}

function getDepth() {
  const el = document.querySelector('.depth-option.selected');
  return el ? el.dataset.depth : 'headline_plus_why';
}

// ── Day circle helpers ────────────────────────────────────────────────────────
function daysFromFrequency(freq) {
  if (freq === 'daily_all') return [0, 1, 2, 3, 4, 5, 6];
  if (freq === 'daily_weekday' || freq === 'weekdays') return [1, 2, 3, 4, 5];
  if (freq === 'sixdays') return [1, 2, 3, 4, 5, 6];
  return [1, 2, 3, 4, 5]; // default weekdays
}

function initSettingsDays(days) {
  document.querySelectorAll('#dayCircles .day-circle').forEach(function(c) {
    c.classList.toggle('active', days.includes(parseInt(c.dataset.day)));
  });
  syncSettingsDayPresets();
}

function toggleSettingsDay(el) {
  el.classList.toggle('active');
  syncSettingsDayPresets();
}

function setSettingsDays(preset) {
  document.querySelectorAll('#dayCircles .day-circle').forEach(function(c) {
    const day = parseInt(c.dataset.day);
    if (preset === 'weekdays') c.classList.toggle('active', day >= 1 && day <= 5);
    else if (preset === 'everyday') c.classList.add('active');
  });
  syncSettingsDayPresets();
}

function syncSettingsDayPresets() {
  const active = Array.from(document.querySelectorAll('#dayCircles .day-circle.active'))
    .map(function(c) { return parseInt(c.dataset.day); });
  const isWeekdays = active.length === 5 && [1,2,3,4,5].every(function(d) { return active.includes(d); });
  const isEveryday = active.length === 7;
  document.getElementById('preset-weekdays').classList.toggle('active', isWeekdays);
  document.getElementById('preset-everyday').classList.toggle('active', isEveryday);
}

function getSettingsDays() {
  return Array.from(document.querySelectorAll('#dayCircles .day-circle.active'))
    .map(function(c) { return parseInt(c.dataset.day); });
}

function getSettingsFrequency() {
  const days = getSettingsDays();
  const isWeekdays = days.length === 5 && [1,2,3,4,5].every(function(d) { return days.includes(d); });
  const isEveryday = days.length === 7;
  if (isWeekdays) return 'daily_weekday';
  if (isEveryday) return 'daily_all';
  return 'custom';
}

async function init() {
  const params = new URLSearchParams(window.location.search);
  const email = params.get('email');
  const loadingEl = document.getElementById('loadingState');
  const formEl = document.getElementById('settingsForm');
  const notFoundEl = document.getElementById('notFoundState');

  if (!email) {
    loadingEl.style.display = 'none';
    notFoundEl.style.display = 'block';
    return;
  }

  try {
    const res = await fetch('/api/user?email=' + encodeURIComponent(email));
    if (!res.ok) throw new Error('not found');
    const user = await res.json();

    loadingEl.style.display = 'none';
    formEl.style.display = 'block';

    // Fill details
    document.getElementById('name').value = user.name || '';
    document.getElementById('email').value = user.email || '';
    document.getElementById('telegram').value = user.telegram ? '@' + user.telegram : '';

    // Topics
    renderChips(DEFAULT_TOPICS, user.topics || []);

    // Custom topic add
    document.getElementById('addTopicBtn').addEventListener('click', function() {
      const input = document.getElementById('customTopicInput');
      const val = input.value.trim();
      if (!val || selectedTopics.has(val)) { input.value = ''; return; }
      const chip = renderChip(val, true);
      selectedTopics.add(val);
      document.getElementById('topicGrid').appendChild(chip);
      updateTopicNote();
      input.value = '';
    });
    document.getElementById('customTopicInput').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); document.getElementById('addTopicBtn').click(); }
    });

    // Depth
    const depth = user.preferences && user.preferences.depth ? user.preferences.depth : 'headline_plus_why';
    document.querySelectorAll('.depth-option').forEach(function(opt) {
      opt.classList.toggle('selected', opt.dataset.depth === depth);
      opt.addEventListener('click', function() { selectDepth(opt); });
    });

    // Schedule
    const prefs = user.preferences || {};
    function setSelect(id, val) {
      const el = document.getElementById(id);
      if (el && val != null) el.value = String(val);
    }
    setSelect('deliveryTime', prefs.delivery_time);
    setSelect('itemsPerDigest', prefs.items_per_digest ? String(prefs.items_per_digest) : '5');

    // Day circles — populate from saved days_of_week, fall back to frequency string
    const savedDays = prefs.days_of_week || daysFromFrequency(prefs.frequency);
    initSettingsDays(savedDays);

    // Save
    document.getElementById('saveBtn').addEventListener('click', async function() {
      if (selectedTopics.size < 2) {
        showError('Please select at least 2 topics.');
        return;
      }
      const btn = document.getElementById('saveBtn');
      btn.disabled = true;
      btn.textContent = 'Saving…';

      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email,
            name: document.getElementById('name').value.trim(),
            telegram: document.getElementById('telegram').value.replace('@', '').trim() || null,
            topics: Array.from(selectedTopics),
            preferences: {
              depth: getDepth(),
              delivery_time: document.getElementById('deliveryTime').value,
              frequency: getSettingsFrequency(),
              days_of_week: getSettingsDays(),
              items_per_digest: parseInt(document.getElementById('itemsPerDigest').value),
              email_enabled: true,
              telegram_enabled: !!document.getElementById('telegram').value.trim(),
            }
          })
        });
        const data = await res.json();
        if (data.success) {
          showBanner('✅ Preferences saved');
        } else {
          showError(data.error || 'Save failed.');
        }
      } catch (err) {
        showError('Network error.');
      }
      btn.disabled = false;
      btn.textContent = 'Save preferences';
    });

    // Unsubscribe
    document.getElementById('unsubBtn').addEventListener('click', async function() {
      if (!confirm('Unsubscribe from SignalBrief? You can re-subscribe anytime at localhost:3003.')) return;
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, status: 'unsubscribed' })
      });
      document.getElementById('settingsForm').innerHTML =
        '<div class="form-section" style="text-align:center;padding:48px 24px;">' +
        '<div style="font-size:40px;margin-bottom:16px;">👋</div>' +
        '<h2 style="font-family:\'Instrument Serif\',serif;font-weight:400;font-size:26px;margin-bottom:8px;">You\'re unsubscribed.</h2>' +
        '<p style="color:#6B7280;">No more digests. <a href="/" style="color:#2563EB;">Re-subscribe anytime →</a></p>' +
        '</div>';
    });

  } catch (e) {
    loadingEl.style.display = 'none';
    notFoundEl.style.display = 'block';
  }
}

function showError(msg) {
  const el = document.getElementById('saveError');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}

function showBanner(msg) {
  const el = document.getElementById('savedBanner');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('visible');
  setTimeout(function() { el.classList.remove('visible'); }, 3000);
}

init();
