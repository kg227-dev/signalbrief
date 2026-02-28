/* SignalBrief — settings.js
   Loaded only by settings.html — handles load, save, unsubscribe. */

const DEFAULT_TOPICS = [
  'AI×TECH', 'HEALTHCARE', 'FINANCIAL SERVICES', 'PE×M&A',
  'ENERGY', 'CONSUMER', 'POLICY×REGULATORY', 'STRATEGY',
  'SUSTAINABILITY', 'REAL ESTATE'
];

let selectedTopics = new Set();

function updateTopicNote() {
  const n = selectedTopics.size;
  const el = document.getElementById('topicMinNote');
  if (!el) return;
  el.textContent = n + ' selected' + (n < 2 ? ' — pick at least 2' : '');
  el.style.color = (n < 2 && n > 0) ? '#DC2626' : '#6B7280';
}

function renderChip(topic, selected) {
  const chip = document.createElement('div');
  chip.className = 'topic-chip' + (selected ? ' selected' : '');
  chip.dataset.topic = topic;
  chip.innerHTML = '<span class="check"></span> ' + topic;
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

function renderChips(topics, userTopics) {
  const container = document.getElementById('topicGrid');
  if (!container) return;
  container.innerHTML = '';
  const all = [...new Set([...DEFAULT_TOPICS, ...userTopics])];
  all.forEach(function(t) {
    const sel = userTopics.includes(t);
    if (sel) selectedTopics.add(t);
    container.appendChild(renderChip(t, sel));
  });
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
      if (el && val) el.value = val;
    }
    setSelect('deliveryTime', prefs.delivery_time);
    setSelect('frequency', prefs.frequency);
    setSelect('digestLength', prefs.items_per_digest ? String(prefs.items_per_digest) : '7');

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
              frequency: document.getElementById('frequency').value,
              items_per_digest: parseInt(document.getElementById('digestLength').value),
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
