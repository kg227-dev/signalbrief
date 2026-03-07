/* SignalBrief — shared preference model for onboarding/settings flows */
(function bootstrapPreferences(globalScope) {
  const FALLBACK_INDUSTRY_TOPICS = [
    "HEALTHCARE",
    "FINANCIAL SERVICES",
    "PE×M&A",
    "ENERGY",
    "CONSUMER",
    "LIFE SCIENCES",
    "TECHNOLOGY",
    "INDUSTRIALS",
    "REAL ESTATE",
    "PUBLIC SECTOR",
  ];

  const FALLBACK_CAPABILITY_TOPICS = [
    "AI×TECH",
    "STRATEGY",
    "POLICY×REGULATORY",
    "SUSTAINABILITY",
    "DIGITAL",
    "M&A ADVISORY",
    "TALENT",
  ];

  const INDUSTRY_TOPICS = [...FALLBACK_INDUSTRY_TOPICS];
  const CAPABILITY_TOPICS = [...FALLBACK_CAPABILITY_TOPICS];
  const DEFAULT_TOPICS = [...INDUSTRY_TOPICS, ...CAPABILITY_TOPICS];

  const TOPIC_LABELS = {
    HEALTHCARE: "Healthcare",
    "FINANCIAL SERVICES": "Financial Services",
    "PE×M&A": "Private Equity & M&A",
    ENERGY: "Energy",
    CONSUMER: "Consumer & Retail",
    "LIFE SCIENCES": "Life Sciences",
    TECHNOLOGY: "Technology",
    INDUSTRIALS: "Industrials",
    "REAL ESTATE": "Real Estate",
    "PUBLIC SECTOR": "Public Sector",
    "AI×TECH": "AI & Technology",
    STRATEGY: "Strategy",
    "POLICY×REGULATORY": "Policy & Regulatory",
    SUSTAINABILITY: "Sustainability & ESG",
    DIGITAL: "Digital Transformation",
    "M&A ADVISORY": "M&A Advisory",
    TALENT: "Talent & Workforce",
  };

  const DEFAULT_DEPTH = "headline_plus_why";
  let topicCatalogLoaded = false;

  function replaceArray(target, nextValues) {
    target.splice(0, target.length, ...nextValues);
  }

  function sanitizeTopicList(values) {
    if (!Array.isArray(values)) return [];
    const out = [];
    for (const value of values) {
      const topic = String(value || "").trim();
      if (!topic || out.includes(topic)) continue;
      out.push(topic);
    }
    return out;
  }

  function getTopicCatalog() {
    return {
      industries: INDUSTRY_TOPICS.slice(),
      capabilities: CAPABILITY_TOPICS.slice(),
      topics: DEFAULT_TOPICS.slice(),
    };
  }

  function setTopicCatalog(payload = {}) {
    const industries = sanitizeTopicList(payload.industries);
    const capabilities = sanitizeTopicList(payload.capabilities);
    const defaults = sanitizeTopicList(payload.topics);

    const nextIndustries = industries.length ? industries : FALLBACK_INDUSTRY_TOPICS;
    const nextCapabilities = capabilities.length ? capabilities : FALLBACK_CAPABILITY_TOPICS;
    const nextDefaults = defaults.length ? defaults : [...nextIndustries, ...nextCapabilities];

    replaceArray(INDUSTRY_TOPICS, nextIndustries);
    replaceArray(CAPABILITY_TOPICS, nextCapabilities);
    replaceArray(DEFAULT_TOPICS, nextDefaults);
    topicCatalogLoaded = true;
    return getTopicCatalog();
  }

  async function loadTopicCatalog(opts = {}) {
    if (topicCatalogLoaded && !opts.force) return getTopicCatalog();
    if (typeof fetch !== "function") {
      topicCatalogLoaded = true;
      return getTopicCatalog();
    }

    try {
      const res = await fetch("/api/topics", {
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const payload = await res.json();
        if (payload && typeof payload === "object") {
          return setTopicCatalog(payload);
        }
      }
    } catch (err) {
      // Keep fallback catalog when topics endpoint is unavailable.
      const debugUi = typeof globalScope?.location?.search === "string"
        && globalScope.location.search.includes("debug_ui=1");
      if (debugUi) {
        const message = err && err.message ? err.message : String(err || "unknown error");
        console.warn(`[prefs] topic catalog fallback: ${message}`);
      }
    }

    topicCatalogLoaded = true;
    return getTopicCatalog();
  }

  function normalizeDay(day) {
    const n = Number(day);
    if (!Number.isFinite(n)) return null;
    const normalized = Math.floor(n);
    if (normalized < 0 || normalized > 6) return null;
    return normalized;
  }

  function normalizeDays(days) {
    const values = Array.isArray(days) ? days : [];
    const unique = [];
    for (const day of values) {
      const normalized = normalizeDay(day);
      if (normalized == null || unique.includes(normalized)) continue;
      unique.push(normalized);
    }
    return unique;
  }

  function normalizeCustomTopicInput(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    return slug ? `custom_${slug}` : "";
  }

  function topicKeyFromInput(value, opts = {}) {
    const raw = String(value || "").trim();
    if (!raw) return "";

    if (opts.matchDefault) {
      const defaultMatch = DEFAULT_TOPICS.find((topic) => topic.toLowerCase() === raw.toLowerCase());
      if (defaultMatch) return defaultMatch;
    }

    return normalizeCustomTopicInput(raw);
  }

  function isCustomTopic(topic) {
    return !DEFAULT_TOPICS.includes(String(topic || ""));
  }

  function formatCustomLabel(topic) {
    return String(topic || "")
      .replace(/^custom_/, "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function topicDisplayLabel(topic) {
    const key = String(topic || "");
    if (!key) return "";
    if (DEFAULT_TOPICS.includes(key)) return TOPIC_LABELS[key] || key;
    return formatCustomLabel(key);
  }

  function isWeekdays(days) {
    const list = normalizeDays(days);
    return list.length === 5 && [1, 2, 3, 4, 5].every((day) => list.includes(day));
  }

  function isEveryday(days) {
    return normalizeDays(days).length === 7;
  }

  function daysFromFrequency(freq) {
    if (freq === "daily_all") return [0, 1, 2, 3, 4, 5, 6];
    if (freq === "daily_weekday" || freq === "weekdays") return [1, 2, 3, 4, 5];
    if (freq === "sixdays") return [1, 2, 3, 4, 5, 6];
    return [1, 2, 3, 4, 5];
  }

  function frequencyFromDays(days) {
    const normalized = normalizeDays(days);
    if (isWeekdays(normalized)) return "daily_weekday";
    if (isEveryday(normalized)) return "daily_all";
    return "custom";
  }

  function normalizeTelegram(value) {
    const raw = String(value || "").trim().replace(/^@+/, "");
    return raw || null;
  }

  function createPreferenceState(initial = {}) {
    let selectedTopics = new Set(Array.isArray(initial.topics) ? initial.topics.map(String) : []);
    let depth = String(initial.depth || DEFAULT_DEPTH);
    let deliveryTime = String(initial.delivery_time || initial.deliveryTime || "07:00");
    let daysOfWeek = normalizeDays(
      initial.days_of_week || initial.daysOfWeek || daysFromFrequency(initial.frequency || "daily_weekday")
    );
    let itemsPerDigest = Number(initial.items_per_digest || initial.itemsPerDigest || 5);

    if (!Number.isFinite(itemsPerDigest) || itemsPerDigest <= 0) {
      itemsPerDigest = 5;
    }

    return {
      getTopics() {
        return Array.from(selectedTopics);
      },

      setTopics(topics) {
        selectedTopics = new Set(Array.isArray(topics) ? topics.map(String) : []);
        return this.getTopics();
      },

      hasTopic(topic) {
        return selectedTopics.has(String(topic || ""));
      },

      addTopic(topic) {
        const key = String(topic || "").trim();
        if (!key) return false;
        const sizeBefore = selectedTopics.size;
        selectedTopics.add(key);
        return selectedTopics.size !== sizeBefore;
      },

      removeTopic(topic) {
        return selectedTopics.delete(String(topic || ""));
      },

      toggleTopic(topic) {
        const key = String(topic || "").trim();
        if (!key) return false;
        if (selectedTopics.has(key)) {
          selectedTopics.delete(key);
          return false;
        }
        selectedTopics.add(key);
        return true;
      },

      getDepth() {
        return depth || DEFAULT_DEPTH;
      },

      setDepth(nextDepth) {
        const key = String(nextDepth || "").trim();
        depth = key || DEFAULT_DEPTH;
        return depth;
      },

      getDeliveryTime() {
        return deliveryTime || "07:00";
      },

      setDeliveryTime(value) {
        deliveryTime = String(value || "").trim() || "07:00";
        return deliveryTime;
      },

      getDays() {
        return daysOfWeek.slice();
      },

      setDays(days) {
        daysOfWeek = normalizeDays(days);
        return this.getDays();
      },

      toggleDay(day) {
        const normalized = normalizeDay(day);
        if (normalized == null) return false;
        if (daysOfWeek.includes(normalized)) {
          daysOfWeek = daysOfWeek.filter((value) => value !== normalized);
          return false;
        }
        daysOfWeek = normalizeDays([...daysOfWeek, normalized]);
        return true;
      },

      setDaysPreset(preset) {
        if (preset === "weekdays") {
          daysOfWeek = [1, 2, 3, 4, 5];
        } else if (preset === "everyday") {
          daysOfWeek = [0, 1, 2, 3, 4, 5, 6];
        }
        return this.getDays();
      },

      getFrequency() {
        return frequencyFromDays(daysOfWeek);
      },

      getItemsPerDigest() {
        return itemsPerDigest;
      },

      setItemsPerDigest(value) {
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) {
          itemsPerDigest = Math.floor(n);
        }
        return itemsPerDigest;
      },

      snapshot() {
        return {
          topics: this.getTopics(),
          depth: this.getDepth(),
          delivery_time: this.getDeliveryTime(),
          frequency: this.getFrequency(),
          days_of_week: this.getDays(),
          items_per_digest: this.getItemsPerDigest(),
        };
      },
    };
  }

  function buildSignupPayload({
    state,
    name,
    email,
    telegram,
    referralToken,
  }) {
    const snapshot = state.snapshot();
    return {
      name: String(name || "").trim(),
      email: String(email || "").trim(),
      telegram: normalizeTelegram(telegram),
      topics: snapshot.topics,
      depth: snapshot.depth,
      delivery_time: snapshot.delivery_time,
      frequency: snapshot.frequency,
      days_of_week: snapshot.days_of_week,
      items_per_digest: snapshot.items_per_digest,
      referral_token: String(referralToken || "").trim() || null,
    };
  }

  function buildSettingsPayload({
    state,
    token,
    name,
    telegram,
    telegramEnabled,
  }) {
    const snapshot = state.snapshot();
    return {
      token: String(token || "").trim(),
      name: String(name || "").trim(),
      telegram: normalizeTelegram(telegram),
      topics: snapshot.topics,
      preferences: {
        depth: snapshot.depth,
        delivery_time: snapshot.delivery_time,
        frequency: snapshot.frequency,
        days_of_week: snapshot.days_of_week,
        items_per_digest: snapshot.items_per_digest,
        email_enabled: true,
        telegram_enabled: !!telegramEnabled,
      },
    };
  }

  globalScope.SignalBriefPrefs = {
    INDUSTRY_TOPICS,
    CAPABILITY_TOPICS,
    DEFAULT_TOPICS,
    TOPIC_LABELS,
    getTopicCatalog,
    loadTopicCatalog,
    DEFAULT_DEPTH,
    createPreferenceState,
    normalizeCustomTopicInput,
    topicKeyFromInput,
    topicDisplayLabel,
    isCustomTopic,
    isWeekdays,
    isEveryday,
    daysFromFrequency,
    frequencyFromDays,
    normalizeTelegram,
    buildSignupPayload,
    buildSettingsPayload,
  };
})(window);
