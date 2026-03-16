function createServerState() {
  return {
    rateIp: new Map(),
    rateEmail: new Map(),
  };
}

function createSignupRateLimiter({
  ipLimit = 5,
  ipWindowMs = 15 * 60 * 1000,
  emailCooldownMs = 10 * 60 * 1000,
} = {}) {
  let state = createServerState();

  function resetServerState() {
    state = createServerState();
    return state;
  }

  function checkRateLimit(ip, email) {
    const now = Date.now();
    const rateIp = state.rateIp;
    const rateEmail = state.rateEmail;

    for (const [key, value] of rateIp) {
      if (value.resetAt < now) rateIp.delete(key);
    }
    for (const [key, value] of rateEmail) {
      if (value < now) rateEmail.delete(key);
    }

    const ipEntry = rateIp.get(ip) || { count: 0, resetAt: now + ipWindowMs };
    if (ipEntry.resetAt < now) {
      ipEntry.count = 0;
      ipEntry.resetAt = now + ipWindowMs;
    }
    if (ipEntry.count >= ipLimit) {
      return { limited: true, reason: "Too many signups from your network. Try again in 15 minutes." };
    }
    ipEntry.count += 1;
    rateIp.set(ip, ipEntry);

    const emailKey = String(email || "").toLowerCase();
    const emailReset = rateEmail.get(emailKey);
    if (emailReset && emailReset > now) {
      return { limited: true, reason: "This email was just submitted. Wait a few minutes before resubmitting." };
    }
    rateEmail.set(emailKey, now + emailCooldownMs);

    return { limited: false };
  }

  return {
    checkRateLimit,
    resetServerState,
  };
}

function createMagicLinkRateLimiter({
  ipLimit = 3,
  ipWindowMs = 15 * 60 * 1000,
  emailCooldownMs = 5 * 60 * 1000,
} = {}) {
  let state = createServerState();

  function checkMagicLinkRateLimit(ip, email) {
    const now = Date.now();
    const rateIp = state.rateIp;
    const rateEmail = state.rateEmail;

    for (const [key, value] of rateIp) {
      if (value.resetAt < now) rateIp.delete(key);
    }
    for (const [key, value] of rateEmail) {
      if (value < now) rateEmail.delete(key);
    }

    const ipEntry = rateIp.get(ip) || { count: 0, resetAt: now + ipWindowMs };
    if (ipEntry.resetAt < now) {
      ipEntry.count = 0;
      ipEntry.resetAt = now + ipWindowMs;
    }
    if (ipEntry.count >= ipLimit) {
      return { limited: true, reason: "Too many requests from your network. Try again later." };
    }
    ipEntry.count += 1;
    rateIp.set(ip, ipEntry);

    const emailKey = String(email || "").toLowerCase();
    if (emailKey) {
      const emailReset = rateEmail.get(emailKey);
      if (emailReset && emailReset > now) {
        return { limited: true, reason: "A link was recently sent to that address. Wait a few minutes before requesting another." };
      }
      rateEmail.set(emailKey, now + emailCooldownMs);
    }

    return { limited: false };
  }

  return { checkMagicLinkRateLimit };
}

function createSettingsRateLimiter({
  ipLimit = 30,
  ipWindowMs = 60 * 1000,
} = {}) {
  const rateIp = new Map();

  function checkSettingsRateLimit(ip) {
    const now = Date.now();

    for (const [key, value] of rateIp) {
      if (value.resetAt < now) rateIp.delete(key);
    }

    const ipEntry = rateIp.get(ip) || { count: 0, resetAt: now + ipWindowMs };
    if (ipEntry.resetAt < now) {
      ipEntry.count = 0;
      ipEntry.resetAt = now + ipWindowMs;
    }
    if (ipEntry.count >= ipLimit) {
      return { limited: true, reason: "Too many settings updates. Try again in a minute." };
    }
    ipEntry.count += 1;
    rateIp.set(ip, ipEntry);

    return { limited: false };
  }

  return { checkSettingsRateLimit };
}

module.exports = {
  createServerState,
  createSignupRateLimiter,
  createMagicLinkRateLimiter,
  createSettingsRateLimiter,
};
