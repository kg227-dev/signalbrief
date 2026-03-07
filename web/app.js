/* SignalBrief — index.js (onboarding UI runtime) */

function showOnboarding() {
  const hero = document.querySelector('.hero');
  const onboard = document.getElementById('onboard-form');
  if (!hero || !onboard) return;
  hero.style.display = 'none';
  onboard.style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showLanding() {
  const hero = document.querySelector('.hero');
  const onboard = document.getElementById('onboard-form');
  if (!hero || !onboard) return;
  onboard.style.display = 'none';
  hero.style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Topic chips ───────────────────────────────────────────────────────────
function toggleTopic(el) {
  el.classList.toggle('selected');
  updateProgress();
}

function addCustomTopic() {
  const input = document.getElementById('customTopic');
  const value = input.value.trim();
  if (!value) return;
  const slug = 'custom_' + value.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  if (document.querySelector('[data-topic="' + slug + '"]')) { input.value = ''; return; }
  const chip = document.createElement('div');
  chip.className = 'topic-chip topic-chip-custom selected';
  chip.dataset.topic = slug;
  chip.onclick = function() { toggleTopic(this); };
  chip.innerHTML = '<span class="check"></span> ' + value;
  document.getElementById('topicGrid').appendChild(chip);
  input.value = '';
  updateProgress();
}

document.getElementById('customTopic').addEventListener('keypress', function(e) {
  if (e.key === 'Enter') { e.preventDefault(); addCustomTopic(); }
});

// ── Depth ─────────────────────────────────────────────────────────────────
function setSelectedDepth(el) {
  document.querySelectorAll('.depth-option').forEach(function(o) { o.classList.remove('selected'); });
  el.classList.add('selected');
  updateProgress();
}

function getSelectedDepth() {
  var el = document.querySelector('.depth-option.selected');
  return el ? el.dataset.depth : 'headline_plus_why';
}

function initDepthSelector(initialDepth) {
  var current = document.querySelector('.depth-option.selected');
  if (current) return;
  var depth = initialDepth || 'headline_plus_why';
  var fallback = document.querySelector('.depth-option[data-depth="' + depth + '"]');
  if (fallback) fallback.classList.add('selected');
}

// ── Size toggle (2-pill) ──────────────────────────────────────────────────
function selectSize(el) {
  document.querySelectorAll('.size-pill').forEach(function(p) { p.classList.remove('selected'); });
  el.classList.add('selected');
}

function getSize() {
  const sel = document.querySelector('.size-pill.selected');
  return sel ? parseInt(sel.dataset.size) : 5;
}

// ── Day circles ───────────────────────────────────────────────────────────
function toggleDay(el) {
  el.classList.toggle('active');
  syncDayPresets();
  updateProgress();
}

function setDays(preset) {
  const circles = document.querySelectorAll('.day-circle');
  circles.forEach(function(c) {
    const day = parseInt(c.dataset.day);
    if (preset === 'weekdays') {
      c.classList.toggle('active', day >= 1 && day <= 5);
    } else if (preset === 'everyday') {
      c.classList.add('active');
    }
  });
  document.getElementById('preset-weekdays').classList.toggle('active', preset === 'weekdays');
  document.getElementById('preset-everyday').classList.toggle('active', preset === 'everyday');
  updateProgress();
}

function syncDayPresets() {
  const active = Array.from(document.querySelectorAll('.day-circle.active')).map(function(c) { return parseInt(c.dataset.day); });
  const isWeekdays = active.length === 5 && [1,2,3,4,5].every(function(d) { return active.includes(d); });
  const isEveryday = active.length === 7;
  document.getElementById('preset-weekdays').classList.toggle('active', isWeekdays);
  document.getElementById('preset-everyday').classList.toggle('active', isEveryday);
}

function getSelectedDays() {
  return Array.from(document.querySelectorAll('.day-circle.active')).map(function(c) { return parseInt(c.dataset.day); });
}

function getDaysFrequency() {
  const days = getSelectedDays();
  const isWeekdays = days.length === 5 && [1,2,3,4,5].every(function(d) { return days.includes(d); });
  const isEveryday = days.length === 7;
  if (isWeekdays) return 'daily_weekday';
  if (isEveryday) return 'daily_all';
  return 'custom';
}

// ── Progress ──────────────────────────────────────────────────────────────
function updateProgress() {
  const name = document.getElementById('name').value.trim();
  const email = document.getElementById('email').value.trim();
  const topics = document.querySelectorAll('.topic-chip.selected').length;
  const depth = getSelectedDepth();
  const days = document.querySelectorAll('.day-circle.active').length;

  function setStep(id, filled) {
    document.getElementById(id).className = 'progress-step' + (filled ? ' filled' : '');
  }
  setStep('prog-1', name && email);
  setStep('prog-2', topics >= 2);
  setStep('prog-3', !!depth);
  setStep('prog-4', days > 0);
}

document.getElementById('name').addEventListener('input', updateProgress);
document.getElementById('email').addEventListener('input', updateProgress);

function showSubmitError(msg) {
  var el = document.getElementById('submitError');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('visible');
}

function clearSubmitError() {
  var el = document.getElementById('submitError');
  if (!el) return;
  el.textContent = '';
  el.classList.remove('visible');
}

// ── Form submit ───────────────────────────────────────────────────────────
document.getElementById('onboardForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  clearSubmitError();

  const selectedTopics = Array.from(document.querySelectorAll('.topic-chip.selected'))
    .map(function(c) { return c.dataset.topic; });

  if (selectedTopics.length < 2) {
    showSubmitError('Please select at least 2 topics.');
    return;
  }

  const name = document.getElementById('name').value.trim();
  const email = document.getElementById('email').value.trim();
  if (!name || !email) {
    showSubmitError('Name and email are required.');
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showSubmitError('Please enter a valid email address.');
    document.getElementById('email').focus();
    return;
  }

  const days = getSelectedDays();
  if (days.length === 0) {
    showSubmitError('Please select at least one delivery day.');
    return;
  }

  const btn = document.querySelector('.submit-btn');
  btn.disabled = true;
  btn.textContent = 'Subscribing…';

  const selectedDepth = getSelectedDepth();
  const referralToken = (new URLSearchParams(window.location.search).get('ref') || '').trim();

  try {
    const res = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name,
        email: email,
        telegram: document.getElementById('telegram').value.trim().replace(/^@+/, '') || null,
        topics: selectedTopics,
        depth: selectedDepth,
        delivery_time: document.getElementById('deliveryTime').value,
        frequency: getDaysFrequency(),
        days_of_week: days,
        items_per_digest: getSize(),
        referral_token: referralToken || null
      })
    });
    const result = await res.json();
    if (result.success) {
      clearSubmitError();
      document.getElementById('onboardForm').style.display = 'none';
      document.getElementById('formFooter').style.display = 'none';
      document.getElementById('successCard').classList.add('visible');
      document.querySelectorAll('.progress-step').forEach(function(s) { s.className = 'progress-step filled'; });
      var settingsLink = document.getElementById('settingsLink');
      if (settingsLink && result.token) settingsLink.href = '/settings?token=' + encodeURIComponent(result.token);
      var archiveLink = document.getElementById('archiveLink');
      if (archiveLink && result.archiveUrl) archiveLink.href = result.archiveUrl;
      // Update delivery time in success message
      var timeVal = document.getElementById('deliveryTime').value || '07:00';
      var timeParts = timeVal.split(':').map(Number);
      var h = timeParts[0], m = timeParts[1];
      var ampm = h >= 12 ? 'PM' : 'AM';
      var hour = h % 12 || 12;
      var timeStr = hour + ':' + String(m).padStart(2, '0') + ' ' + ampm + ' ET';
      document.getElementById('successDeliveryMsg').innerHTML = 'Your first SignalBrief arrives at <strong>' + timeStr + '</strong>. Here\'s a preview of what to expect:';
    } else {
      showSubmitError(result.error || 'Something went wrong. Please try again.');
      btn.disabled = false;
      btn.textContent = 'Start my SignalBrief →';
    }
  } catch(err) {
    showSubmitError('Network error. Please try again.');
    btn.disabled = false;
    btn.textContent = 'Start my SignalBrief →';
  }
});

// ── Preview tab switcher ──────────────────────────────────────────────────
function switchPreview(panel, btn) {
  document.getElementById('prev-telegram').style.display = panel === 'telegram' ? 'block' : 'none';
  document.getElementById('prev-email').style.display = panel === 'email' ? 'block' : 'none';
  document.querySelectorAll('.prev-tab').forEach(function(t) {
    t.style.borderColor = '#E5E7EB';
    t.style.background = '#fff';
    t.style.color = '#6B7280';
    t.style.fontWeight = '500';
  });
  btn.style.borderColor = '#2563EB';
  btn.style.background = '#EFF6FF';
  btn.style.color = '#2563EB';
  btn.style.fontWeight = '600';
}

// ── Dark mode ──────────────────────────────────────────────────────────────
function toggleDark() {
  document.body.classList.toggle('dark');
  var isDark = document.body.classList.contains('dark');
  document.getElementById('darkToggle').textContent = isDark ? '☀️' : '🌙';
  try { localStorage.setItem('sbDark', isDark ? '1' : '0'); } catch(e){}
}
(function initDark() {
  try { if (localStorage.getItem('sbDark') === '1') { document.body.classList.add('dark'); document.getElementById('darkToggle').textContent = '☀️'; } } catch(e){}
})();

// Init
initDepthSelector('headline_plus_why');
updateProgress();
