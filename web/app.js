/* SignalBrief — app.js */

const API = '';  // same origin

const DEFAULT_TOPICS = [
  'AI×Healthcare', 'Pharma M&A', 'Biotech', 'Payers',
  'Regulatory/FDA', 'Clinical Trials', 'Digital Health',
  'Consulting Industry', 'Strategy & Business', 'Health Systems'
];

let selectedTopics = new Set();

// ── Shared: Topic chips ───────────────────────────────────────────────────────

function renderChips(containerEl, noteEl, topics, selected = []) {
  selected.forEach(t => selectedTopics.add(t));
  containerEl.innerHTML = '';

  topics.forEach(topic => {
    const chip = document.createElement('div');
    chip.className = 'chip' + (selectedTopics.has(topic) ? ' selected' : '');
    chip.dataset.topic = topic;
    chip.innerHTML = `<span class="chip-check">✓</span> ${topic}`;
    chip.addEventListener('click', () => toggleChip(chip, topic, noteEl));
    containerEl.appendChild(chip);
  });
  updateNote(noteEl);
}

function toggleChip(chip, topic, noteEl) {
  if (selectedTopics.has(topic)) {
    selectedTopics.delete(topic);
    chip.classList.remove('selected');
  } else {
    selectedTopics.add(topic);
    chip.classList.add('selected');
  }
  updateNote(noteEl);
}

function updateNote(noteEl) {
  if (!noteEl) return;
  const n = selectedTopics.size;
  noteEl.textContent = `${n} selected${n < 2 ? ' — pick at least 2' : ''}`;
  noteEl.classList.toggle('error', n < 2 && n > 0);
}

function addCustomTopic(inputEl, containerEl, noteEl) {
  const val = inputEl.value.trim();
  if (!val) return;
  if (selectedTopics.has(val)) { inputEl.value = ''; return; }

  // Add chip
  const chip = document.createElement('div');
  chip.className = 'chip selected';
  chip.dataset.topic = val;
  chip.innerHTML = `<span class="chip-check">✓</span> ${val} <span style="opacity:0.5;margin-left:2px;">×</span>`;
  chip.addEventListener('click', () => toggleChip(chip, val, noteEl));
  containerEl.appendChild(chip);
  selectedTopics.add(val);
  updateNote(noteEl);
  inputEl.value = '';
}

// ── Shared: Depth radio ───────────────────────────────────────────────────────

function initDepthOptions(defaultVal = 'full') {
  document.querySelectorAll('.depth-option').forEach(opt => {
    const val = opt.dataset.value;
    if (val === defaultVal) {
      opt.classList.add('selected');
      opt.querySelector('input').checked = true;
    }
    opt.addEventListener('click', () => {
      document.querySelectorAll('.depth-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      opt.querySelector('input').checked = true;
    });
  });
}

function getDepthValue() {
  const checked = document.querySelector('.depth-option.selected');
  return checked ? checked.dataset.value : 'full';
}

// ── ONBOARDING PAGE ───────────────────────────────────────────────────────────

function initOnboarding() {
  const sections = document.querySelectorAll('.section');
  const dots = document.querySelectorAll('.step-dot');
  const progressFill = document.getElementById('progressFill');

  // Fade-up sections on load
  sections.forEach((s, i) => {
    setTimeout(() => s.classList.add('visible'), 100 + i * 120);
  });

  // Update progress based on scroll position
  function updateProgress() {
    let maxVisible = 0;
    sections.forEach((s, i) => {
      const rect = s.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.8) maxVisible = i + 1;
    });
    const pct = Math.round((maxVisible / sections.length) * 100);
    progressFill.style.width = pct + '%';
    dots.forEach((d, i) => {
      d.classList.toggle('active', i === maxVisible - 1);
      d.classList.toggle('done', i < maxVisible - 1);
    });
  }
  window.addEventListener('scroll', updateProgress);
  updateProgress();

  // Chips
  const chipsEl = document.getElementById('topicChips');
  const noteEl = document.getElementById('topicMinNote');
  renderChips(chipsEl, noteEl, DEFAULT_TOPICS);

  document.getElementById('addTopicBtn').addEventListener('click', () => {
    addCustomTopic(document.getElementById('customTopicInput'), chipsEl, noteEl);
  });
  document.getElementById('customTopicInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addCustomTopic(e.target, chipsEl, noteEl); }
  });

  // Depth
  initDepthOptions('full');

  // Preview tabs
  document.querySelectorAll('.preview-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.preview-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.preview-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('panel-' + tab.dataset.panel).classList.add('active');
    });
  });

  // Form submit
  document.getElementById('signupForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('name').value.trim();
    const email = document.getElementById('email').value.trim();
    const telegram = document.getElementById('telegram').value.trim();
    const emailErr = document.getElementById('emailError');
    const submitErr = document.getElementById('submitError');
    const btn = document.getElementById('submitBtn');

    // Validate
    let valid = true;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      emailErr.classList.add('visible'); valid = false;
    } else { emailErr.classList.remove('visible'); }

    if (selectedTopics.size < 2) {
      noteEl.classList.add('error');
      noteEl.textContent = `${selectedTopics.size} selected — pick at least 2`;
      document.getElementById('section1').scrollIntoView({ behavior: 'smooth' });
      valid = false;
    }
    if (!valid) return;

    btn.disabled = true;
    btn.textContent = 'Subscribing…';

    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          telegram: telegram.replace('@', '') || null,
          topics: [...selectedTopics],
          depth: getDepthValue(),
          delivery_time: document.getElementById('deliveryTime').value,
          frequency: document.getElementById('frequency').value,
          items_per_digest: document.getElementById('itemsPerDigest').value,
        })
      });
      const data = await res.json();
      if (data.success) {
        document.getElementById('signupForm').style.display = 'none';
        const success = document.getElementById('successState');
        success.classList.add('visible');
        success.scrollIntoView({ behavior: 'smooth' });
        progressFill.style.width = '100%';
      } else {
        submitErr.textContent = data.error || 'Something went wrong. Try again.';
        submitErr.classList.add('visible');
        btn.disabled = false;
        btn.textContent = 'Subscribe to SignalBrief →';
      }
    } catch {
      submitErr.textContent = 'Network error. Please try again.';
      submitErr.classList.add('visible');
      btn.disabled = false;
      btn.textContent = 'Subscribe to SignalBrief →';
    }
  });
}

// ── SETTINGS PAGE ─────────────────────────────────────────────────────────────

async function initSettings() {
  const loadingEl = document.getElementById('loadingState');
  const formEl = document.getElementById('settingsForm');
  const notFoundEl = document.getElementById('notFoundState');

  const params = new URLSearchParams(window.location.search);
  const email = params.get('email');

  if (!email) { loadingEl.style.display = 'none'; notFoundEl.style.display = 'block'; return; }

  // Load user
  const res = await fetch(`/api/user?email=${encodeURIComponent(email)}`);
  if (!res.ok) { loadingEl.style.display = 'none'; notFoundEl.style.display = 'block'; return; }
  const user = await res.json();

  loadingEl.style.display = 'none';
  formEl.style.display = 'block';

  // Pre-fill details
  document.getElementById('name').value = user.name || '';
  document.getElementById('email').value = user.email || '';
  document.getElementById('telegram').value = user.telegram ? '@' + user.telegram : '';

  // Chips
  const chipsEl = document.getElementById('topicChips');
  const noteEl = document.getElementById('topicMinNote');
  const allTopics = [...new Set([...DEFAULT_TOPICS, ...(user.topics || [])])];
  renderChips(chipsEl, noteEl, allTopics, user.topics || []);

  document.getElementById('addTopicBtn').addEventListener('click', () => {
    addCustomTopic(document.getElementById('customTopicInput'), chipsEl, noteEl);
  });
  document.getElementById('customTopicInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addCustomTopic(e.target, chipsEl, noteEl); }
  });

  // Depth
  const depth = user.preferences?.depth || 'full';
  initDepthOptions(depth);

  // Schedule
  const p = user.preferences || {};
  const setVal = (id, val) => { if (val && document.getElementById(id)) document.getElementById(id).value = val; };
  setVal('deliveryTime', p.delivery_time);
  setVal('frequency', p.frequency);
  setVal('itemsPerDigest', p.items_per_digest?.toString());

  // Save
  document.getElementById('saveBtn').addEventListener('click', async () => {
    const btn = document.getElementById('saveBtn');
    const errEl = document.getElementById('saveError');
    if (selectedTopics.size < 2) {
      errEl.textContent = 'Please select at least 2 topics.';
      errEl.classList.add('visible'); return;
    }
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          name: document.getElementById('name').value.trim(),
          telegram: document.getElementById('telegram').value.replace('@','').trim() || null,
          topics: [...selectedTopics],
          preferences: {
            depth: getDepthValue(),
            delivery_time: document.getElementById('deliveryTime').value,
            frequency: document.getElementById('frequency').value,
            items_per_digest: parseInt(document.getElementById('itemsPerDigest').value),
          }
        })
      });
      const data = await res.json();
      if (data.success) {
        const banner = document.getElementById('savedBanner');
        banner.classList.add('visible');
        setTimeout(() => banner.classList.remove('visible'), 3000);
      } else {
        errEl.textContent = data.error || 'Save failed.';
        errEl.classList.add('visible');
      }
    } catch {
      errEl.textContent = 'Network error.'; errEl.classList.add('visible');
    }
    btn.disabled = false; btn.textContent = 'Save preferences';
  });

  // Unsubscribe
  document.getElementById('unsubBtn').addEventListener('click', async () => {
    if (!confirm('Unsubscribe from SignalBrief? You can re-subscribe anytime.')) return;
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, status: 'unsubscribed' })
    });
    document.getElementById('settingsForm').innerHTML = `
      <div class="section visible" style="text-align:center;padding:40px 24px;">
        <div style="font-size:32px;margin-bottom:12px;">👋</div>
        <div style="font-family:'Instrument Serif',serif;font-size:22px;margin-bottom:8px;">You're unsubscribed.</div>
        <div style="color:var(--text-muted);font-size:14px;">No more digests. <a href="/" style="color:var(--blue);">Re-subscribe anytime →</a></div>
      </div>`;
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

if (window.SETTINGS_MODE) {
  initSettings();
} else if (document.getElementById('signupForm')) {
  initOnboarding();
}
