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

module.exports = {
  createServerState,
  createSignupRateLimiter,
};
