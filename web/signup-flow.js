/* SignalBrief — signup flow runtime (Typeform-style step navigation) */
(function bootstrapSignupFlow(globalScope) {
  var Prefs = globalScope.SignalBriefPrefs || {};
  var IndexHelpers = globalScope.SignalBriefIndexHelpersRuntime || {};
  var FormSubmit = globalScope.SignalBriefIndexFormSubmitRuntime || {};

  var TOTAL_STEPS = 5;
  var currentStep = 0;
  var direction = 1; // 1 = forward, -1 = backward
  var emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  var requestHelpers = typeof IndexHelpers.createRequestHelpers === "function"
    ? IndexHelpers.createRequestHelpers()
    : null;

  var prefState = typeof Prefs.createPreferenceState === "function"
    ? Prefs.createPreferenceState({
        depth: Prefs.DEFAULT_DEPTH || "headline_plus_why",
        daysOfWeek: [],
        deliveryTime: "07:00",
      })
    : null;

  /* ── Helpers ── */
  function byId(id) { return document.getElementById(id); }

  function showError(stepIdx, msg) {
    var el = byId("error-" + stepIdx);
    if (el) { el.textContent = msg; el.classList.add("visible"); }
  }
  function clearError(stepIdx) {
    var el = byId("error-" + stepIdx);
    if (el) { el.textContent = ""; el.classList.remove("visible"); }
  }

  function showFieldError(id, html) {
    var el = byId(id);
    if (el) { el.innerHTML = html; el.classList.add("visible"); }
  }
  function clearFieldError(id) {
    var el = byId(id);
    if (el) { el.innerHTML = ""; el.classList.remove("visible"); }
  }
  function setInputError(id, hasError) {
    var el = byId(id);
    if (el) el.classList.toggle("input-error", hasError);
  }

  function selectedTopicKeys() {
    if (prefState) return prefState.getTopics();
    return Array.from(document.querySelectorAll(".topic-chip.selected"))
      .map(function(c) { return c.dataset.topic; })
      .filter(Boolean);
  }

  /* ── Dark mode ── */
  (function() {
    var toggle = byId("darkToggle");
    var moonSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
    var sunSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
    function apply(isDark) {
      document.body.classList.toggle("dark", isDark);
      if (toggle) {
        toggle.innerHTML = isDark ? sunSvg : moonSvg;
        toggle.setAttribute("aria-pressed", isDark ? "true" : "false");
      }
    }
    try { if (localStorage.getItem("sbDark") === "1") apply(true); } catch(e) {}
    if (toggle) toggle.onclick = function() {
      var isDark = !document.body.classList.contains("dark");
      apply(isDark);
      try { localStorage.setItem("sbDark", isDark ? "1" : "0"); } catch(e) {}
    };
  })();

  /* ── Pre-fill email from URL ── */
  (function() {
    var params = new URLSearchParams(globalScope.location.search);
    var email = (params.get("email") || "").trim();
    if (email) {
      var input = byId("email");
      if (input) input.value = email;
    }
  })();

  /* ── Progress bar ── */
  function updateProgress() {
    var fill = byId("progressFill");
    if (fill) {
      var pct = currentStep >= TOTAL_STEPS ? 100 : ((currentStep + 1) / TOTAL_STEPS) * 100;
      fill.style.width = pct + "%";
    }
  }

  /* ── Step navigation ── */
  function goToStep(idx) {
    if (idx < 0 || idx > TOTAL_STEPS) return;
    var prevEl = byId("step-" + currentStep);
    var nextEl = byId("step-" + idx);
    if (!prevEl || !nextEl) return;

    direction = idx > currentStep ? 1 : -1;

    // Exit current step
    prevEl.classList.remove("active");
    prevEl.classList.add("exiting");

    setTimeout(function() {
      prevEl.classList.remove("exiting");
      prevEl.style.display = "none";

      currentStep = idx;
      updateProgress();

      // Enter new step
      nextEl.style.display = "block";
      nextEl.classList.remove("exiting");
      nextEl.classList.add("active");
      // Override animation direction for back navigation
      if (direction < 0) {
        nextEl.style.animation = "stepInReverse 0.4s cubic-bezier(0.4,0,0.2,1) forwards";
      } else {
        nextEl.style.animation = "";
      }

      // Build review if entering step 4
      if (idx === 4) buildReview();

      // Scroll to top
      globalScope.scrollTo(0, 0);
    }, 280);
  }

  function validateStep(idx) {
    clearError(idx);
    if (idx === 0) {
      var name = (byId("name").value || "").trim();
      var email = (byId("email").value || "").trim();
      if (!name) { showError(0, "Please enter your name."); byId("name").focus(); return false; }
      if (!email || !emailRe.test(email)) { showError(0, "Please enter a valid email address."); byId("email").focus(); return false; }
      return true;
    }
    if (idx === 1) {
      if (selectedTopicKeys().length < 1) { showError(1, "Please select at least 1 topic."); return false; }
      if (selectedTopicKeys().length > 3) { showError(1, "Please select no more than 3 topics."); return false; }
      return true;
    }
    if (idx === 2) {
      var selected = document.querySelector(".depth-card.selected");
      if (!selected) { showError(2, "Please select a depth level."); return false; }
      return true;
    }
    if (idx === 3) {
      var days = getSelectedDays();
      if (!days.length) { showError(3, "Please select at least one delivery day."); return false; }
      return true;
    }
    return true;
  }

  async function sendMagicLinkInline(email) {
    var sendBtn = byId("sendAccessBtn");
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = "Sending\u2026"; }
    try {
      await fetch("/api/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email }),
      });
      // Server always returns 200 regardless of whether email is found
      var emailErrEl = byId("email-error");
      if (emailErrEl) {
        emailErrEl.innerHTML = '\u2713 Check your inbox \u2014 we sent your access link.';
        emailErrEl.classList.add("visible");
        emailErrEl.style.color = "#059669";
      }
    } catch (err) {
      if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = "Send me my access link \u2192"; }
    }
  }

  async function advanceStep0() {
    clearError(0);
    clearFieldError("email-error");
    setInputError("email", false);

    var name = (byId("name").value || "").trim();
    var email = (byId("email").value || "").trim();

    if (!name) { showError(0, "Please enter your name."); byId("name").focus(); return; }
    if (!email || !emailRe.test(email)) { showError(0, "Please enter a valid email address."); byId("email").focus(); return; }

    var btn = byId("next-0");
    if (btn) { btn.disabled = true; btn.textContent = "Checking\u2026"; }

    try {
      var response = await fetch("/api/check-availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email }),
      });
      var result = response.ok ? await response.json() : {};

      if (result.emailTaken) {
        setInputError("email", true);
        showFieldError("email-error",
          "An account with this email already exists. " +
          '<button class="send-access-btn" id="sendAccessBtn" type="button">Send me my access link \u2192</button>'
        );
        var sendBtn = byId("sendAccessBtn");
        if (sendBtn) {
          var capturedEmail = email;
          sendBtn.addEventListener("click", function() { sendMagicLinkInline(capturedEmail); });
        }
      } else {
        goToStep(1);
      }
    } catch (err) {
      // Network error — fall through to let the server catch conflicts at submit
      goToStep(1);
    } finally {
      var b = byId("next-0");
      if (b) { b.disabled = false; b.textContent = "Continue"; }
    }
  }

  function advanceStep() {
    if (!validateStep(currentStep)) return;
    goToStep(currentStep + 1);
  }

  function retreatStep() {
    if (currentStep > 0) goToStep(currentStep - 1);
  }

  /* ── Topic rendering ── */
  function renderTopics() {
    var grid = byId("topicGrid");
    if (!grid) return;

    var industries = Array.isArray(Prefs.INDUSTRY_TOPICS) ? Prefs.INDUSTRY_TOPICS : [];
    function topicLabel(topic) {
      return typeof Prefs.topicDisplayLabel === "function" ? Prefs.topicDisplayLabel(topic) : topic;
    }

    function addGroup(label, topics, chipClass) {
      if (!topics.length) return; // skip empty groups (no capabilities in MVP)
      var heading = document.createElement("div");
      heading.className = "topic-group-label";
      heading.textContent = label;
      grid.appendChild(heading);

      var wrap = document.createElement("div");
      wrap.className = "topic-grid";
      topics.forEach(function(topic) {
        var chip = document.createElement("div");
        chip.className = "topic-chip " + chipClass;
        chip.dataset.topic = topic;
        chip.innerHTML = '<span class="check"></span> ' + topicLabel(topic);
        chip.addEventListener("click", function() { toggleTopic(chip); });
        wrap.appendChild(chip);
      });
      grid.appendChild(wrap);
    }

    addGroup("Sectors", industries, "topic-chip-industry");
  }

  function toggleTopic(chip) {
    var topic = chip.dataset.topic;
    var isSelected = chip.classList.contains("selected");

    if (isSelected) {
      chip.classList.remove("selected");
      if (prefState) prefState.removeTopic(topic);
    } else {
      if (selectedTopicKeys().length >= 3) {
        updateTopicFeedback("Select up to 3 sectors.");
        return;
      }
      chip.classList.add("selected");
      if (prefState) prefState.addTopic(topic);
    }
    updateTopicFeedback();
  }

  function updateTopicFeedback(message) {
    var fb = byId("topicFeedback");
    if (!fb) return;
    if (message) {
      fb.textContent = message;
      fb.className = "topic-feedback visible";
      return;
    }
    var count = selectedTopicKeys().length;
    if (count === 0) {
      fb.textContent = "Select at least 1 sector to continue.";
      fb.className = "topic-feedback visible";
    } else {
      fb.textContent = "";
      fb.className = "topic-feedback";
    }
  }

  /* ── Depth ── */
  function initDepth() {
    var cards = document.querySelectorAll(".depth-card");
    cards.forEach(function(card) {
      card.addEventListener("click", function() {
        cards.forEach(function(c) { c.classList.remove("selected"); });
        card.classList.add("selected");
        if (prefState) prefState.setDepth(card.dataset.depth);
      });
    });
    // Set initial state
    if (prefState) prefState.setDepth("headline_plus_why");
  }

  /* ── Schedule ── */
  function getSelectedDays() {
    var days = [];
    document.querySelectorAll(".day-circle.active").forEach(function(el) {
      days.push(Number(el.dataset.day));
    });
    return days;
  }

  function setDayCircles(dayNums) {
    document.querySelectorAll(".day-circle").forEach(function(el) {
      var d = Number(el.dataset.day);
      el.classList.toggle("active", dayNums.includes(d));
    });
    updateDayPresets();
    if (prefState) prefState.setDays(dayNums);
  }

  function updateDayPresets() {
    var days = getSelectedDays();
    var wk = byId("preset-weekdays");
    var ev = byId("preset-everyday");
    var isWeekdays = typeof Prefs.isWeekdays === "function" ? Prefs.isWeekdays(days) : days.length === 5;
    var isEvery = typeof Prefs.isEveryday === "function" ? Prefs.isEveryday(days) : days.length === 7;
    if (wk) wk.classList.toggle("active", isWeekdays && !isEvery);
    if (ev) ev.classList.toggle("active", isEvery);
  }

  function initSchedule() {
    // Day circles
    document.querySelectorAll(".day-circle").forEach(function(el) {
      el.addEventListener("click", function() {
        el.classList.toggle("active");
        var days = getSelectedDays();
        if (prefState) prefState.setDays(days);
        updateDayPresets();
      });
    });

    // Presets
    var wk = byId("preset-weekdays");
    var ev = byId("preset-everyday");
    if (wk) wk.addEventListener("click", function() { setDayCircles([1,2,3,4,5]); });
    if (ev) ev.addEventListener("click", function() { setDayCircles([0,1,2,3,4,5,6]); });

    // Delivery time
    var timeSelect = byId("deliveryTime");
    if (timeSelect) {
      timeSelect.addEventListener("change", function() {
        if (prefState) prefState.setDeliveryTime(timeSelect.value);
      });
    }
  }

  /* ── Review ── */
  function buildReview() {
    var card = byId("reviewCard");
    if (!card) return;

    var name = (byId("name").value || "").trim();
    var email = (byId("email").value || "").trim();
    var topics = selectedTopicKeys();
    var topicLabels = topics.map(function(t) {
      return typeof Prefs.topicDisplayLabel === "function" ? Prefs.topicDisplayLabel(t) : t;
    });

    var depthEl = document.querySelector(".depth-card.selected");
    var depthLabel = depthEl ? depthEl.querySelector(".depth-label").textContent : "Deep";

    var timeSelect = byId("deliveryTime");
    var timeLabel = timeSelect ? timeSelect.options[timeSelect.selectedIndex].text : "7:00 AM ET";

    var days = getSelectedDays();
    var dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var dayLabels = days.sort(function(a,b){return a-b;}).map(function(d) { return dayNames[d]; });
    var isWeekdays = days.length === 5 && [1,2,3,4,5].every(function(d) { return days.includes(d); });
    var isEvery = days.length === 7;
    var daysText = isEvery ? "Every day" : (isWeekdays ? "Weekdays" : dayLabels.join(", "));

    card.innerHTML =
      '<div class="review-row"><span class="review-label">Name</span><span class="review-value">' + escapeHtml(name) + '</span></div>' +
      '<div class="review-row"><span class="review-label">Email</span><span class="review-value">' + escapeHtml(email) + '</span></div>' +
      '<div class="review-row"><span class="review-label">Topics</span><span class="review-value">' + escapeHtml(topicLabels.join(", ")) + '</span></div>' +
      '<div class="review-row"><span class="review-label">Depth</span><span class="review-value">' + escapeHtml(depthLabel) + '</span></div>' +
      '<div class="review-row"><span class="review-label">Delivery</span><span class="review-value">' + escapeHtml(timeLabel) + '</span></div>' +
      '<div class="review-row"><span class="review-label">Days</span><span class="review-value">' + escapeHtml(daysText) + '</span></div>' +
      '<div class="review-row"><span class="review-label">Items per topic</span><span class="review-value">5 signals</span></div>';
  }

  function escapeHtml(str) {
    var d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  /* ── Submit ── */
  async function handleSubmit() {
    clearError(4);
    var submitBtn = byId("next-4");
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Subscribing\u2026"; }

    var name = (byId("name").value || "").trim();
    var email = (byId("email").value || "").trim();
    var topics = selectedTopicKeys();
    var deliveryTime = (byId("deliveryTime").value || "07:00");
    var days = getSelectedDays();
    var referralToken = (new URLSearchParams(globalScope.location.search).get("ref") || "").trim();

    var depthEl = document.querySelector(".depth-card.selected");
    var depth = depthEl ? depthEl.dataset.depth : "headline_plus_why";

    // Sync prefState
    if (prefState) {
      prefState.setTopics(topics);
      prefState.setDepth(depth);
      prefState.setDeliveryTime(deliveryTime);
      prefState.setDays(days);
    }

    var payload;
    if (prefState && typeof Prefs.buildSignupPayload === "function") {
      payload = Prefs.buildSignupPayload({
        state: prefState,
        name: name,
        email: email,
        referralToken: referralToken,
      });
    } else {
      var freq = "custom";
      if (typeof Prefs.frequencyFromDays === "function") freq = Prefs.frequencyFromDays(days);
      payload = {
        name: name,
        email: email,
        topics: topics,
        depth: depth,
        delivery_time: deliveryTime,
        frequency: freq,
        days_of_week: days,
        referral_token: referralToken || null,
      };
    }

    try {
      var fetchFn = requestHelpers && typeof requestHelpers.fetchJsonStrict === "function"
        ? requestHelpers.fetchJsonStrict
        : null;

      var result;
      if (fetchFn) {
        result = await fetchFn("/api/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        var response = await fetch("/api/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        result = await response.json();
        if (!response.ok) throw new Error(result.error || "Signup failed");
      }

      if (result.success || result.account_created) {
        // Show success
        var timeSelect = byId("deliveryTime");
        var timeLabel = timeSelect ? timeSelect.options[timeSelect.selectedIndex].text : "7:00 AM ET";
        var msgEl = byId("successMsg");
        if (msgEl) msgEl.textContent = "Your first briefing arrives at " + timeLabel + ".";

        // Update links with token
        if (result.token) {
          var settingsLink = document.querySelector('.success-links a[href="/settings"]');
          var archiveLink = document.querySelector('.success-links a[href="/archive"]');
          if (settingsLink) settingsLink.href = "/settings?token=" + result.token;
          if (archiveLink) archiveLink.href = result.archiveUrl || ("/archive?token=" + result.token);
        }

        goToStep(5);
        return;
      }
      throw new Error(result.error || "Could not complete signup.");
    } catch (err) {
      var msg = "Something went wrong. Please try again.";
      if (requestHelpers && typeof requestHelpers.mapRequestError === "function") {
        msg = requestHelpers.mapRequestError(err, msg);
      } else if (err && err.message) {
        msg = err.message;
      }
      showError(4, msg);
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Start my SignalBrief \u2192"; }
    }
  }

  /* ── Wire up navigation ── */
  function init() {
    updateProgress();
    renderTopics();
    initDepth();
    initSchedule();

    // Step 0 Continue — async availability check
    var next0Btn = byId("next-0");
    if (next0Btn) next0Btn.addEventListener("click", function() { advanceStep0(); });

    // Continue buttons for steps 1–3
    for (var i = 1; i < TOTAL_STEPS - 1; i++) {
      (function(idx) {
        var btn = byId("next-" + idx);
        if (btn) btn.addEventListener("click", function() { advanceStep(); });
      })(i);
    }

    // Submit button (step 4)
    var submitBtn = byId("next-4");
    if (submitBtn) submitBtn.addEventListener("click", function(e) {
      e.preventDefault();
      handleSubmit();
    });

    // Back buttons
    for (var j = 1; j <= TOTAL_STEPS - 1; j++) {
      (function(idx) {
        var btn = byId("back-" + idx);
        if (btn) btn.addEventListener("click", function() { retreatStep(); });
      })(j);
    }

    // Enter key to advance on step 0 inputs
    ["name", "email"].forEach(function(id) {
      var input = byId(id);
      if (input) input.addEventListener("keydown", function(e) {
        if (e.key === "Enter") { e.preventDefault(); advanceStep0(); }
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window);
