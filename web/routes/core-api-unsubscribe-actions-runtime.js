const { USER_STATUS } = require("../../src/platform/store");

function buildResolveOneClickToken(findUserByToken) {
  return (rawToken) => {
    const token = String(rawToken || "").trim();
    if (!token) return { ok: false, code: "missing_token", token: "" };
    const user = findUserByToken(token);
    if (!user) return { ok: false, code: "invalid_token", token };
    return { ok: true, token, user };
  };
}

function buildResolveLegacyUnsubscribeToken(allUsers, signUnsubEmail) {
  return (emailRaw, sigRaw) => {
    const email = decodeURIComponent(String(emailRaw || "")).toLowerCase().trim();
    const sig = String(sigRaw || "").trim();
    if (!email) return { ok: false, code: "email_required" };
    if (!sig || sig !== signUnsubEmail(email)) return { ok: false, code: "invalid_signature" };
    const legacyUser = allUsers().find((user) => String(user.email || "").toLowerCase().trim() === email);
    return { ok: true, token: legacyUser?.token ? String(legacyUser.token) : "" };
  };
}

function buildUnsubscribeByToken(findUserByToken, writeUser) {
  return (tokenLookup) => {
    const token = String(tokenLookup || "").trim();
    if (!token) return null;
    const existing = findUserByToken(token);
    if (!existing) return null;
    writeUser(existing.chatId, {
      ...existing,
      status: USER_STATUS.UNSUBSCRIBED,
      email_unsubscribed_at: new Date().toISOString(),
    });
    console.log(`[unsubscribe] ${existing.email}`);
    return existing;
  };
}

function redirectUnsubscribed(res, existing) {
  const location = existing?.token
    ? `/settings?token=${encodeURIComponent(existing.token)}&unsubscribed=1`
    : "/settings?unsubscribed=1";
  res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

function redirectInvalidToken(res) {
  res.writeHead(302, { Location: "/settings?invalid_token=1", "Cache-Control": "no-store" });
  res.end();
}

function createUnsubscribeActions(deps) {
  const {
    json,
    findUserByToken,
    signUnsubEmail,
    allUsers,
    writeUser,
    blankReengagementState,
  } = deps;

  const resolveOneClickToken = buildResolveOneClickToken(findUserByToken);
  const resolveLegacyUnsubscribeToken = buildResolveLegacyUnsubscribeToken(allUsers, signUnsubEmail);
  const unsubscribeByToken = buildUnsubscribeByToken(findUserByToken, writeUser);

  async function handleUnsubscribeConfirm(ctx) {
    const { res, url } = ctx;
    const resolved = resolveOneClickToken(url.searchParams.get("token"));
    if (!resolved.ok) {
      redirectInvalidToken(res);
      return true;
    }
    const existing = unsubscribeByToken(resolved.token);
    redirectUnsubscribed(res, existing);
    return true;
  }

  async function handleUnsubscribeOneClick(ctx) {
    const { res, url } = ctx;
    const token = String(url.searchParams.get("token") || "").trim();
    if (!token) {
      json(res, { error: "token required" }, 400);
      return true;
    }
    const existing = unsubscribeByToken(token);
    if (!existing) {
      json(res, { error: "invalid token" }, 401);
      return true;
    }
    json(res, { success: true });
    return true;
  }

  async function handleUnsubscribeLegacy(ctx) {
    const { req, res, url } = ctx;
    const legacy = resolveLegacyUnsubscribeToken(
      url.searchParams.get("email"),
      url.searchParams.get("sig")
    );
    if (!legacy.ok) {
      if (legacy.code === "invalid_signature") json(res, { error: "invalid signature" }, 403);
      else json(res, { error: "email required" }, 400);
      return true;
    }
    const existing = unsubscribeByToken(legacy.token);
    if (req.method === "POST") json(res, { success: true });
    else redirectUnsubscribed(res, existing);
    return true;
  }

  async function handleUnsubscribeCompat(ctx) {
    const { req, res, url } = ctx;
    const tokenParam = String(url.searchParams.get("token") || "").trim();
    const emailParam = String(url.searchParams.get("email") || "").trim();
    const sigParam = String(url.searchParams.get("sig") || "").trim();

    if (req.method === "GET") {
      if (tokenParam) {
        res.writeHead(302, {
          Location: `/api/unsubscribe/confirm?token=${encodeURIComponent(tokenParam)}`,
          "Cache-Control": "no-store",
        });
        res.end();
        return true;
      }
      if (emailParam || sigParam) {
        res.writeHead(302, {
          Location: `/api/unsubscribe/legacy?email=${encodeURIComponent(emailParam)}&sig=${encodeURIComponent(sigParam)}`,
          "Cache-Control": "no-store",
        });
        res.end();
        return true;
      }
      redirectUnsubscribed(res, null);
      return true;
    }

    if (tokenParam) {
      const existing = unsubscribeByToken(tokenParam);
      if (!existing) {
        json(res, { error: "invalid token" }, 401);
        return true;
      }
      json(res, { success: true, deprecated: true, use: "/api/unsubscribe/one-click" });
      return true;
    }

    if (emailParam || sigParam) {
      const legacy = resolveLegacyUnsubscribeToken(emailParam, sigParam);
      if (!legacy.ok) {
        if (legacy.code === "invalid_signature") json(res, { error: "invalid signature" }, 403);
        else json(res, { error: "email required" }, 400);
        return true;
      }
      unsubscribeByToken(legacy.token);
      json(res, { success: true, deprecated: true, use: "/api/unsubscribe/legacy" });
      return true;
    }

    json(res, { error: "token required" }, 400);
    return true;
  }

  async function handlePause(ctx) {
    const { res, url } = ctx;
    const resolved = resolveOneClickToken(url.searchParams.get("token"));
    if (!resolved.ok) {
      redirectInvalidToken(res);
      return true;
    }

    const user = resolved.user;
    const updated = {
      ...user,
      status: USER_STATUS.PAUSED,
      preferences: { ...(user.preferences || {}), email_enabled: false },
      last_updated: new Date().toISOString(),
    };
    writeUser(user.chatId, updated);
    console.log(`[pause] ${user.email || user.chatId}`);
    res.writeHead(302, {
      Location: `/settings?token=${encodeURIComponent(resolved.token)}&paused=1`,
      "Cache-Control": "no-store",
    });
    res.end();
    return true;
  }

  async function handleReactivate(ctx) {
    const { res, url } = ctx;
    const resolved = resolveOneClickToken(url.searchParams.get("token"));
    if (!resolved.ok) {
      redirectInvalidToken(res);
      return true;
    }

    const user = resolved.user;
    const updated = {
      ...user,
      status: USER_STATUS.ACTIVE,
      preferences: { ...(user.preferences || {}), email_enabled: true },
      reengagement_state: blankReengagementState(),
      last_updated: new Date().toISOString(),
    };
    writeUser(user.chatId, updated);
    console.log(`[reactivate] ${user.email || user.chatId}`);
    res.writeHead(302, {
      Location: `/settings?token=${encodeURIComponent(resolved.token)}&reactivated=1`,
      "Cache-Control": "no-store",
    });
    res.end();
    return true;
  }

  return {
    handleUnsubscribeConfirm,
    handleUnsubscribeOneClick,
    handleUnsubscribeLegacy,
    handleUnsubscribeCompat,
    handlePause,
    handleReactivate,
  };
}

module.exports = {
  createUnsubscribeActions,
};
