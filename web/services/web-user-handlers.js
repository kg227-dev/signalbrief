function createWebUserHandlers(deps) {
  const {
    requireJsonBody,
    json,
    getClientIp,
    checkRateLimit,
    allUsers,
    findUserByToken,
    normalizeReferralToken,
    generateToken,
    writeUser,
    sendReferralThankYou,
    sendWelcomeEmail,
    queueDigestTrigger,
    runDigestTrigger,
    startDigestTrigger,
    BASE_URL,
    DEFAULT_TOPICS,
    PROTECTED_FIELDS,
    isAdminAuthed,
    logAdminActionEvent,
  } = deps;

  function toRouteCtx(ctxOrReq, maybeRes) {
    if (ctxOrReq && typeof ctxOrReq === "object" && ctxOrReq.req && ctxOrReq.res) {
      return ctxOrReq;
    }
    return { req: ctxOrReq, res: maybeRes };
  }

  async function runSignupSideEffects({ user, chatId, referrerUser }) {
    const tasks = [];

    if (referrerUser) {
      tasks.push(
        sendReferralThankYou(referrerUser, user)
          .then(() => null)
          .catch((err) => ({ code: "referral_thank_you_failed", detail: err.message || "unknown error" }))
      );
    }

    tasks.push(
      sendWelcomeEmail(user)
        .then(() => null)
        .catch((err) => ({ code: "welcome_email_failed", detail: err.message || "unknown error" }))
    );

    tasks.push(
      queueDigestTrigger({
        source: "web:signup_welcome",
        trigger: "signup_welcome",
        chatId,
        maxAdmissionWaitMs: 10 * 60 * 1000,
        env: { BASE_URL },
      }).then((outcome) => {
        if (outcome.ok) return null;
        return {
          code: "welcome_digest_trigger_failed",
          detail: outcome.code || "unknown trigger status",
        };
      }).catch((err) => ({ code: "welcome_digest_trigger_failed", detail: err.message || "unknown error" }))
    );

    const settled = await Promise.all(tasks);
    return settled.filter(Boolean);
  }

  function sanitizePreferencesPatch(rawPreferences) {
    if (
      !rawPreferences
      || typeof rawPreferences !== "object"
      || Array.isArray(rawPreferences)
      || Object.getPrototypeOf(rawPreferences) !== Object.prototype
    ) {
      return { ok: false, error: "preferences must be an object" };
    }

    const patch = {};
    for (const [key, value] of Object.entries(rawPreferences)) {
      if (key === "depth" || key === "delivery_time" || key === "frequency" || key === "timezone") {
        if (typeof value !== "string" || !value.trim()) {
          return { ok: false, error: `preferences.${key} must be a non-empty string` };
        }
        patch[key] = value.trim();
        continue;
      }

      if (key === "items_per_digest") {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          return { ok: false, error: "preferences.items_per_digest must be a positive number" };
        }
        patch.items_per_digest = Math.floor(parsed);
        continue;
      }

      if (key === "days_of_week") {
        if (!Array.isArray(value)) {
          return { ok: false, error: "preferences.days_of_week must be an array of day indexes" };
        }
        const seen = new Set();
        const days = [];
        for (const day of value) {
          const parsed = Number(day);
          if (!Number.isFinite(parsed)) {
            return { ok: false, error: "preferences.days_of_week must contain numbers between 0 and 6" };
          }
          const normalized = Math.floor(parsed);
          if (normalized < 0 || normalized > 6) {
            return { ok: false, error: "preferences.days_of_week must contain numbers between 0 and 6" };
          }
          if (seen.has(normalized)) continue;
          seen.add(normalized);
          days.push(normalized);
        }
        patch.days_of_week = days;
        continue;
      }

      if (key === "email_enabled" || key === "telegram_enabled") {
        if (typeof value !== "boolean") {
          return { ok: false, error: `preferences.${key} must be a boolean` };
        }
        patch[key] = value;
        continue;
      }

      return { ok: false, error: `preferences.${key} is not allowed` };
    }

    return { ok: true, patch };
  }

  async function handleSignup(ctxOrReq, maybeRes) {
    const { req, res } = toRouteCtx(ctxOrReq, maybeRes);
    const body = await requireJsonBody(req, res);
    if (body == null) return;
    const { name, email, telegram, topics, depth, delivery_time, frequency, days_of_week, items_per_digest } = body;
    const emailNorm = String(email || "").toLowerCase().trim();
    const referralToken = normalizeReferralToken(body.referral_token);
    const topicsList = Array.isArray(topics) ? topics : null;

    if (!emailNorm || !name) return json(res, { error: "name and email required" }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) return json(res, { error: "invalid email address" }, 400);
    if (!topicsList) return json(res, { error: "topics must be an array" }, 400);

    const hasInvalidTopic = topicsList.some((topic) => typeof topic !== "string" || !topic.trim());
    if (hasInvalidTopic) {
      return json(res, { error: "topics must contain non-empty strings" }, 400);
    }

    const normalizedTopics = [...new Set(topicsList.map((topic) => topic.trim()))];
    if (normalizedTopics.length < 2) return json(res, { error: "select at least 2 topics" }, 400);

    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, emailNorm);
    if (rl.limited) return json(res, { error: rl.reason }, 429);

    const telegramClean = telegram ? String(telegram).replace(/^@+/, "").trim() : null;
    const users = allUsers();
    const existingEmail = users.find((u) => (u.email || "").toLowerCase().trim() === emailNorm);
    if (existingEmail) {
      return json(res, {
        error: "An account with this email already exists. Use your existing settings link to access it.",
      }, 409);
    }

    if (telegramClean) {
      const telegramKey = telegramClean.toLowerCase();
      const existingTelegram = users.find((u) => String(u.telegram || "").toLowerCase() === telegramKey);
      if (existingTelegram) {
        return json(res, { error: "That Telegram username is already linked to another account." }, 409);
      }
    }

    const chatId = `email-${Date.now()}`;
    let signupReferralSource = null;
    let referrerUser = null;
    if (referralToken) {
      const referrer = findUserByToken(referralToken);
      if (referrer) {
        referrerUser = referrer;
        signupReferralSource = {
          chatId: referrer.chatId,
          email: referrer.email || null,
          ts: new Date().toISOString(),
        };
      }
    }

    const user = {
      chatId,
      name,
      email: emailNorm,
      telegram: telegramClean || null,
      topics: normalizedTopics,
      status: "active",
      token: generateToken(),
      joined_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      digests_received: 0,
      bookmarks: [],
      topic_weights: {},
      custom_topics: normalizedTopics.filter((topic) => !DEFAULT_TOPICS.includes(topic)),
      signup_referral_source: signupReferralSource,
      digest_dates: [],
      last_digest_items: [],
      preferences: {
        depth: depth || "headline_plus_why",
        delivery_time: delivery_time || "07:00",
        frequency: frequency || "daily_weekday",
        days_of_week: Array.isArray(days_of_week) ? days_of_week : [1, 2, 3, 4, 5],
        items_per_digest: parseInt(items_per_digest, 10) || 5,
        timezone: "America/New_York",
        email_enabled: true,
        telegram_enabled: !!telegramClean,
      },
    };

    writeUser(chatId, user);
    console.log(`[signup] ${name} <${email}>`);
    if (referrerUser) {
      console.log(`[signup] referred by ${referrerUser.email || referrerUser.chatId}`);
    }
    const sideEffectFailures = await runSignupSideEffects({ user, chatId, referrerUser });
    if (sideEffectFailures.length && process.env.DEBUG_WEB_SERVER === "1") {
      console.warn(`[signup] side effects degraded for ${chatId}:`, sideEffectFailures);
    }

    const response = {
      success: sideEffectFailures.length === 0,
      account_created: true,
      chatId,
      token: user.token,
      archiveUrl: `${BASE_URL}/archive?token=${user.token}`,
      warnings: sideEffectFailures,
    };
    return json(res, response, sideEffectFailures.length ? 202 : 200);
  }

  async function handleSettings(ctxOrReq, maybeRes) {
    const { req, res } = toRouteCtx(ctxOrReq, maybeRes);
    const body = await requireJsonBody(req, res);
    if (body == null) return;
    const { token } = body;
    if (!token) return json(res, { error: "token required" }, 400);

    const existing = findUserByToken(token);
    if (!existing) return json(res, { error: "invalid token" }, 401);

    const safeBody = Object.fromEntries(
      Object.entries(body).filter(([k]) => !PROTECTED_FIELDS.includes(k))
    );

    if (safeBody.preferences != null) {
      const preferencesResult = sanitizePreferencesPatch(safeBody.preferences);
      if (!preferencesResult.ok) {
        return json(res, { error: preferencesResult.error }, 400);
      }
      safeBody.preferences = preferencesResult.patch;
    }

    if (safeBody.telegram != null) {
      safeBody.telegram = String(safeBody.telegram).replace(/^@+/, "").trim() || null;
      if (safeBody.telegram) {
        const telegramKey = safeBody.telegram.toLowerCase();
        const telegramConflict = allUsers().find((u) =>
          String(u.telegram || "").toLowerCase() === telegramKey
          && String(u.chatId || "") !== String(existing.chatId || "")
        );
        if (telegramConflict) {
          return json(res, { error: "That Telegram username is already linked to another account." }, 409);
        }
      }
    }

    if (safeBody.email != null) {
      const nextEmail = String(safeBody.email).toLowerCase().trim();
      if (!nextEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
        return json(res, { error: "invalid email address" }, 400);
      }
      const emailConflict = allUsers().find((u) =>
        String(u.email || "").toLowerCase().trim() === nextEmail
        && String(u.chatId || "") !== String(existing.chatId || "")
      );
      if (emailConflict) {
        return json(res, { error: "That email is already linked to another account." }, 409);
      }
      safeBody.email = nextEmail;
    }

    const updated = {
      ...existing,
      ...safeBody,
      last_updated: new Date().toISOString(),
      preferences: { ...existing.preferences, ...safeBody.preferences },
      ...Object.fromEntries(PROTECTED_FIELDS.map((k) => [k, existing[k]])),
    };

    if (updated.status === "unsubscribed" && existing.status !== "unsubscribed") {
      updated.email_unsubscribed_at = new Date().toISOString();
    }

    writeUser(existing.chatId, updated);
    return json(res, { success: true });
  }

  async function handleAdminRunDigest(ctxOrReq, maybeRes) {
    const { req, res } = toRouteCtx(ctxOrReq, maybeRes);
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    const body = await requireJsonBody(req, res);
    if (body == null) return;
    const targetChatId = body.chatId ? String(body.chatId).trim() : "";

    if (targetChatId) {
      const targetUser = allUsers().find((u) => String(u.chatId || "").trim() === targetChatId);
      if (!targetUser) return json(res, { error: `No user found for chatId ${targetChatId}` }, 404);
      if ((targetUser.status || "active") !== "active") {
        logAdminActionEvent(req, {
          action: "run_digest_targeted",
          target_email: targetUser.email || null,
          target_chat_id: targetChatId,
          success: false,
          details: { reason: `user status ${targetUser.status}` },
        });
        return json(res, { error: `User is ${targetUser.status}; re-activate before sending.` }, 400);
      }
      const prefs = targetUser.preferences || {};
      const emailReady = !!targetUser.email && prefs.email_enabled !== false;
      const tgReady = !!(targetUser.chatId && !String(targetUser.chatId).startsWith("email-") && prefs.telegram_enabled !== false);
      if (!emailReady && !tgReady) {
        logAdminActionEvent(req, {
          action: "run_digest_targeted",
          target_email: targetUser.email || null,
          target_chat_id: targetChatId,
          success: false,
          details: { reason: "no enabled delivery channels" },
        });
        return json(res, { error: "No enabled delivery channels for this user." }, 400);
      }

      try {
        const outcome = await runDigestTrigger({
          source: "web:admin_targeted",
          trigger: "admin_targeted",
          chatId: targetChatId,
          suppressWelcome: true,
          timeoutMs: 12 * 60 * 1000,
        });
        if (outcome.busy) {
          const detail = outcome.raw.run?.stderr
            ? outcome.raw.run.stderr.slice(-260)
            : "digest run lock active";
          logAdminActionEvent(req, {
            action: "run_digest_targeted",
            target_email: targetUser.email || null,
            target_chat_id: targetChatId,
            success: false,
            details: { detail, reason: "digest lock active" },
          });
          return json(res, { error: "Digest run already in progress. Try again shortly.", detail }, 409);
        }
        if (outcome.lockUnhealthy) {
          const detail = outcome.lockError || "digest lock requires manual intervention";
          logAdminActionEvent(req, {
            action: "run_digest_targeted",
            target_email: targetUser.email || null,
            target_chat_id: targetChatId,
            success: false,
            details: { detail, reason: "digest lock unhealthy", state: outcome.code },
          });
          return json(res, {
            error: `Digest lock unhealthy (${outcome.code}). Clear or repair lock before retrying.`,
            detail,
            code: outcome.code,
          }, 503);
        }
        if (outcome.status !== "ok" || !outcome.raw.run || outcome.raw.run.code == null) {
          const detail = outcome.raw.run?.stderr
            ? outcome.raw.run.stderr.slice(-240)
            : (outcome.raw.error || outcome.code || "unknown failure");
          logAdminActionEvent(req, {
            action: "run_digest_targeted",
            target_email: targetUser.email || null,
            target_chat_id: targetChatId,
            success: false,
            details: { detail },
          });
          return json(res, { error: `Digest failed for ${targetChatId}`, detail }, 500);
        }
        if (outcome.raw.run.code !== 0) {
          const detail = outcome.raw.run.stderr ? outcome.raw.run.stderr.slice(-240) : `exit ${outcome.raw.run.code}`;
          logAdminActionEvent(req, {
            action: "run_digest_targeted",
            target_email: targetUser.email || null,
            target_chat_id: targetChatId,
            success: false,
            details: { detail },
          });
          return json(res, { error: `Digest failed for ${targetChatId}`, detail }, 500);
        }
        logAdminActionEvent(req, {
          action: "run_digest_targeted",
          target_email: targetUser.email || null,
          target_chat_id: targetChatId,
          success: true,
        });
        return json(res, {
          success: true,
          message: `Digest sent to ${targetUser.email || targetChatId}`,
        });
      } catch (e) {
        logAdminActionEvent(req, {
          action: "run_digest_targeted",
          target_email: targetUser.email || null,
          target_chat_id: targetChatId,
          success: false,
          details: { detail: e.message },
        });
        return json(res, { error: `Failed to run digest: ${e.message}` }, 500);
      }
    }

    const outcome = await startDigestTrigger({
      source: "web:admin_full",
      trigger: "admin_full",
      suppressWelcome: true,
    });
    if (outcome.busy) {
      logAdminActionEvent(req, {
        action: "run_digest_full",
        success: false,
        details: { reason: "digest lock active", state: outcome.lockState || "valid" },
      });
      return json(res, { error: "Digest run already in progress. Try again shortly." }, 409);
    }
    if (outcome.lockUnhealthy) {
      const detail = outcome.lockError || "digest lock requires manual intervention";
      logAdminActionEvent(req, {
        action: "run_digest_full",
        success: false,
        details: { reason: "digest lock unhealthy", state: outcome.code, error: detail },
      });
      return json(res, {
        error: `Digest lock unhealthy (${outcome.code}). Clear or repair lock before retrying.`,
        detail,
        code: outcome.code,
      }, 503);
    }
    if (outcome.status !== "queued" && outcome.status !== "ok") {
      logAdminActionEvent(req, {
        action: "run_digest_full",
        success: false,
        details: { reason: outcome.code || "spawn_failed", error: outcome.raw.error || null },
      });
      return json(res, { error: "Failed to trigger full digest run." }, 500);
    }
    logAdminActionEvent(req, {
      action: "run_digest_full",
      success: true,
    });
    return json(res, { success: true, message: "Full scheduled digest run triggered" });
  }

  return {
    handleSignup,
    handleSettings,
    handleAdminRunDigest,
  };
}

module.exports = {
  createWebUserHandlers,
};
