async function handleAdminApiRoutes(ctx, deps) {
  const { req, res, url, pathname } = ctx;
  const {
    json, isAdminAuthed, getClientIp, checkLoginRate, requireJsonBody, CONFIG,
    verifyAdminPassword, createAdminSession, clearAdminSessionByRequest, BASE_URL,
    emitIgnoredEventsIfDue, loadCostRunsNewest, allUsers, loadEngagementEvents, parseIsoTs,
    computeFeedbackTrend, digestRunStatus, getCachedOrRefreshSchedulerHeartbeat, readJsonLineLog,
    ADMIN_MESSAGE_LOG, ADMIN_ACTION_LOG, maskEmail, getRecentAutoAdjustmentsForUser,
    logAdminActionEvent, normalizeDeliveryTimeInput, writeUser, sendMagicLinkEmail,
    handleAdminRunDigest, logAdminMessageEvent, summarizeMessage, hashText, escapeHtml,
    sendEmail, sendTelegramText, formatTimeEt, parseEtNowParts, computeNextDeliveryEt,
    formatDaysLabel, computeQualityTrend, formatCountdown,
  } = deps;
  if (pathname === "/api/admin/login" && req.method === "POST") {
    const ip = getClientIp(req);
    if (checkLoginRate(ip)) return json(res, { error: "Too many attempts. Try again in 15 minutes." }, 429);

    const body = await requireJsonBody(req, res);
    if (body == null) return;
    const { email, password } = body;
    if (!email || !password) return json(res, { error: "Email and password required" }, 400);

    const adminEmail = (CONFIG.admin && CONFIG.admin.email) || "";
    if (email.toLowerCase().trim() !== adminEmail.toLowerCase() || !verifyAdminPassword(password, CONFIG.admin || {})) {
      return json(res, { error: "Invalid credentials" }, 401);
    }

    const sessionToken = createAdminSession(email);
    const isSecure = BASE_URL.startsWith("https");
    const cookieFlags = [
      `sb_admin=${sessionToken}`,
      "HttpOnly",
      "Path=/",
      `Max-Age=${7 * 24 * 60 * 60}`,
      "SameSite=Strict",
      isSecure ? "Secure" : "",
    ].filter(Boolean).join("; ");

    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Set-Cookie": cookieFlags,
    });
    return res.end(JSON.stringify({ success: true }));
  }

  // POST /api/admin/logout — clear admin session
  if (pathname === "/api/admin/logout" && req.method === "POST") {
    clearAdminSessionByRequest(req);

    const isSecure = BASE_URL.startsWith("https");
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Set-Cookie": [
        "sb_admin=deleted",
        "HttpOnly",
        "Path=/",
        "Max-Age=0",
        "SameSite=Strict",
        isSecure ? "Secure" : "",
      ].filter(Boolean).join("; "),
    });
    return res.end(JSON.stringify({ success: true }));
  }

  // GET /api/admin/check — check if current session is authenticated
  if (pathname === "/api/admin/check" && req.method === "GET") {
    return json(res, { authenticated: isAdminAuthed(req) });
  }

  // GET /api/admin/stats — cost dashboard data
  if (pathname === "/api/admin/stats" && req.method === "GET") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    let ignoredBackfill = { emitted: 0, considered: 0 };
    try {
      ignoredBackfill = emitIgnoredEventsIfDue({
        window_hours: Number(CONFIG?.digest?.ignoredWindowHours || 24),
        max_age_days: 45,
      }) || ignoredBackfill;
    } catch (err) {
      if (process.env.DEBUG_WEB_SERVER === "1") {
        console.warn(`[web] ignored-events backfill failed: ${err.message}`);
      }
    }
    const runs = loadCostRunsNewest();

    const now = new Date();
    // Use ET date for month prefix so runs at 10 PM ET (= 3 AM UTC next day) aren't miscounted
    const monthPrefix = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" }).slice(0, 7);
    const monthLabel  = now.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "America/New_York" });
    const monthRuns = runs.filter(r => String(r?.date || "").startsWith(monthPrefix));
    const sum = (arr, key) => arr.reduce((s, r) => s + (r[key] || 0), 0);
    const monthDeliveries = sum(monthRuns, "users_served");
    const monthUniqueUsersLog = new Set();
    for (const r of monthRuns) {
      for (const u of (Array.isArray(r?.per_user) ? r.per_user : [])) {
        if (u && u.id) monthUniqueUsersLog.add(String(u.id));
      }
    }
    const usersAll = allUsers();
    const referrals = usersAll
      .map((u) => {
        const source = u && typeof u.signup_referral_source === "object" ? u.signup_referral_source : null;
        if (!source) return null;
        return {
          referrerEmail: source.email || null,
          newUserEmail: u.email || null,
          ts: source.ts || null,
        };
      })
      .filter((row) => row && row.referrerEmail && row.newUserEmail && row.ts)
      .sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || "")));

    const nowMs = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;
    const engagementEvents = loadEngagementEvents({ max_age_days: 120, dedupe: true });
    const inWindow = (ev, days) => {
      const ts = parseIsoTs(ev?.ts_utc);
      return ts != null && ts >= (nowMs - (Math.max(1, Number(days || 1)) * DAY_MS));
    };
    // Open-rate method: unique email_open events divided by unique digest_sent(email) events.
    const openEvents7d = engagementEvents.filter((ev) =>
      String(ev?.event_type || "") === "email_open" && inWindow(ev, 7)
    ).length;
    const openEvents30d = engagementEvents.filter((ev) =>
      String(ev?.event_type || "") === "email_open" && inWindow(ev, 30)
    ).length;
    const digestEmailSent7d = engagementEvents.filter((ev) =>
      String(ev?.event_type || "") === "digest_sent"
      && String(ev?.channel || "") === "email"
      && inWindow(ev, 7)
    ).length;
    const digestEmailSent30d = engagementEvents.filter((ev) =>
      String(ev?.event_type || "") === "digest_sent"
      && String(ev?.channel || "") === "email"
      && inWindow(ev, 30)
    ).length;
    const openRate7d = digestEmailSent7d > 0 ? Number((openEvents7d / digestEmailSent7d).toFixed(4)) : 0;
    const openRate30d = digestEmailSent30d > 0 ? Number((openEvents30d / digestEmailSent30d).toFixed(4)) : 0;
    const totalActive = usersAll.filter((u) => String(u?.status || "active") === "active").length;
    const totalPaused = usersAll.filter((u) => String(u?.status || "") === "paused").length;
    const totalUnsubscribed = usersAll.filter((u) => String(u?.status || "") === "unsubscribed").length;
    const inReengagementDay4 = usersAll.filter((u) => {
      if (String(u?.status || "active") !== "active") return false;
      const rs = u && typeof u.reengagement_state === "object" ? u.reengagement_state : {};
      return !!rs.day4_sent_at && !rs.day8_sent_at && !rs.auto_paused_at;
    }).length;
    const inReengagementDay8 = usersAll.filter((u) => {
      if (String(u?.status || "active") !== "active") return false;
      const rs = u && typeof u.reengagement_state === "object" ? u.reengagement_state : {};
      return !!rs.day8_sent_at && !rs.auto_paused_at;
    }).length;
    const autoPausedLast30d = usersAll.filter((u) => {
      const rs = u && typeof u.reengagement_state === "object" ? u.reengagement_state : {};
      const ts = parseIsoTs(rs.auto_paused_at);
      return ts != null && ts >= (nowMs - (30 * DAY_MS));
    }).length;
    const engagement = {
      total_active: totalActive,
      total_paused: totalPaused,
      total_unsubscribed: totalUnsubscribed,
      open_rate_7d: openRate7d,
      open_rate_30d: openRate30d,
      in_reengagement_day4: inReengagementDay4,
      in_reengagement_day8: inReengagementDay8,
      auto_paused_last_30d: autoPausedLast30d,
      referral_signups_total: referrals.length,
    };

    // Per-user rollup across all runs — divide run cost by number of users served
    const userMap = {};
    for (const r of runs) {
      const usersServed = r.users_served || 1;
      for (const u of (Array.isArray(r?.per_user) ? r.per_user : [])) {
        if (!userMap[u.id]) userMap[u.id] = { id: u.id, runs: 0, total_cost: 0 };
        userMap[u.id].runs++;
        // Attribute each user their fair share of the run cost
        userMap[u.id].total_cost += (r.total_cost_usd || 0) / usersServed;
      }
    }
    const perUser = Object.values(userMap)
      .map(u => ({ ...u, total_cost: parseFloat(u.total_cost.toFixed(5)) }))
      .sort((a, b) => b.total_cost - a.total_cost);

    // User roster for admin view
    // Convert UTC timestamps to ET dates (users signing up after 7 PM ET appear as next UTC day)
    const toETDate = iso => iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) : null;
    const depthLabel = d => ({ headline_only: "Scan", headline_plus_oneliner: "Brief", headline_plus_why: "Deep", full: "Deep", deep: "Deep" }[d] || "Deep");

    // Count scheduled delivery days elapsed since last_digest_at with no delivery.
    // Walks back from yesterday (excludes today — delivery may still be pending).
    const DOW_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    function calcDaysMissed(lastDigestAtIso, daysOfWeek) {
      if (!lastDigestAtIso) return 0; // never delivered — not "missed"
      const toET = iso => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      const todayET  = toET(new Date().toISOString());
      const lastET   = toET(lastDigestAtIso);
      if (lastET >= todayET) return 0; // delivered today
      let missed = 0;
      const cursor = new Date();
      cursor.setDate(cursor.getDate() - 1); // start from yesterday
      for (let i = 0; i < 14; i++) {
        const curET = toET(cursor.toISOString());
        if (curET <= lastET) break;
        const dowET = DOW_NAMES.indexOf(
          cursor.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long" })
        );
        if ((daysOfWeek || [1,2,3,4,5]).includes(dowET)) missed++;
        cursor.setDate(cursor.getDate() - 1);
      }
      return missed;
    }

    const roster = usersAll.map(u => {
      const prefs = u.preferences || {};
      const qualityTrend = computeQualityTrend(u.quality_history || []);
      const [dh, dm] = (prefs.delivery_time || "07:00").split(":").map(Number);
      const ampm = dh >= 12 ? "PM" : "AM";
      const hour = dh % 12 || 12;
      const min  = dm === 0 ? "" : `:${String(dm).padStart(2,"0")}`;
      const allowedDays = prefs.days_of_week || [1, 2, 3, 4, 5];
      const daysLabel = formatDaysLabel(allowedDays);
      const nextDelivery = u.status === "active" ? computeNextDeliveryEt(prefs) : null;
      const tgLinked = !!(u.chatId && !u.chatId.startsWith("email-"));
      const adminUserPath = u.email ? `/admin/user?email=${encodeURIComponent(u.email)}` : null;
      const archivePath = u.email
        ? (u.token
          ? `/archive?token=${encodeURIComponent(u.token)}&admin=1&admin_return=${encodeURIComponent(adminUserPath || "/admin")}`
          : `/archive?email=${encodeURIComponent(u.email)}&admin=1&admin_return=${encodeURIComponent(adminUserPath || "/admin")}`)
        : null;
      return {
        name:               u.name || "",
        email:              u.email || "",
        chat_id:            u.chatId || "",
        status:             u.status || "active",
        joined:             toETDate(u.joined_at),
        digests:            u.digests_received || 0,
        last_digest:        toETDate(u.last_digest_at),
        telegram:           tgLinked,
        email_enabled:      prefs.email_enabled !== false,
        telegram_enabled:   !!(prefs.telegram_enabled && tgLinked),
        topics:             (u.topics || []).length,
        topics_raw:         Array.isArray(u.topics) ? u.topics : [],
        topics_list:        (u.topics || []).map(t => t.replace(/^custom_/,"").replace(/_/g," ")).join(", ") || "—",
        bookmarks:          (u.bookmarks || []).length,
        adjustments:        Object.keys(u.topic_weights || {}).length,
        topic_weights:      u.topic_weights || {},
        last_digest_preview: (u.last_digest_items || []).slice(0, 3).map(item => ({
          headline: (item.headline || "").slice(0, 80),
          tag:      item.tag || "",
          url:      item.url || "",
        })),
        last_digest_item_count: Array.isArray(u.last_digest_items) ? u.last_digest_items.length : 0,
        days_missed:        u.status === "active" ? calcDaysMissed(u.last_digest_at, allowedDays) : 0,
        delivery_time:      `${hour}${min} ${ampm} ET`,
        delivery_time_raw:  prefs.delivery_time || "07:00",
        days_of_week:       allowedDays,
        days_label:         daysLabel,
        timezone:           prefs.timezone || "America/New_York",
        items_per_digest:   parseInt(prefs.items_per_digest, 10) || 5,
        depth:              depthLabel(prefs.depth),
        next_delivery_et:   nextDelivery?.label || "—",
        next_delivery_key:  nextDelivery?.key || null,
        settings_url:       adminUserPath ? `${BASE_URL}${adminUserPath}` : null,
        archive_url:        archivePath ? `${BASE_URL}${archivePath}` : null,
        dqs_current:        qualityTrend.current,
        dqs_7d_avg:         qualityTrend.avg_7d,
        dqs_14d_delta:      qualityTrend.delta_14d,
        dqs_floor_14d:      qualityTrend.floor_14d,
        dqs_band:           qualityTrend.band || null,
        dqs_sample_14d:     qualityTrend.sample_14d || 0,
      };
    }).sort((a, b) => (b.digests - a.digests));
    const activeUsersCount = roster.filter(u => u.status === "active").length;
    const activeTelegramUsersCount = roster.filter(u => u.status === "active" && u.telegram).length;
    const monthUsersServedFromRoster = roster.filter(u => u.last_digest && u.last_digest.startsWith(monthPrefix)).length;

    // Users whose deliveries appear to be falling behind (2+ scheduled days missed)
    const deliveryWarnings = roster
      .filter(u => u.status === "active" && u.days_missed >= 2)
      .map(u => ({ name: u.name || u.email, email: u.email, days_missed: u.days_missed }));

    // Delivery reliability snapshot (last 7 completed ET days vs previous 7)
    const activeRoster = roster.filter(u => u.status === "active");
    const activeEmailSet = new Set(
      activeRoster
        .map(u => String(u.email || "").toLowerCase().trim())
        .filter(Boolean)
    );
    const nowEt = parseEtNowParts();
    const toEtDateOffset = offset => {
      const d = new Date(Date.UTC(nowEt.year, nowEt.month - 1, nowEt.day + offset));
      return {
        dateKey: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`,
        dow: d.getUTCDay(),
      };
    };
    const buildWindow = (startOffset, endOffset) => {
      const rows = [];
      for (let offset = startOffset; offset <= endOffset; offset++) rows.push(toEtDateOffset(offset));
      return rows;
    };
    const currentWindow = buildWindow(-7, -1);
    const previousWindow = buildWindow(-14, -8);
    const expectedScheduledCount = (windowRows) => {
      let total = 0;
      for (const day of windowRows) {
        for (const u of activeRoster) {
          const allowedDays = Array.isArray(u.days_of_week) && u.days_of_week.length
            ? u.days_of_week.map(Number)
            : [1, 2, 3, 4, 5];
          if (allowedDays.includes(day.dow)) total++;
        }
      }
      return total;
    };
    const deliveredScheduledCount = (windowRows) => {
      const allowedDates = new Set(windowRows.map(row => row.dateKey));
      const deliveredSet = new Set();
      for (const run of runs) {
        if (run.on_demand) continue;
        const dateKey = String(run.date || "");
        if (!allowedDates.has(dateKey)) continue;
        const perUsers = Array.isArray(run.per_user) ? run.per_user : [];
        for (const pu of perUsers) {
          const uid = String((pu && pu.id) || "").toLowerCase().trim();
          if (!uid || !activeEmailSet.has(uid)) continue;
          deliveredSet.add(`${dateKey}|${uid}`);
        }
      }
      return deliveredSet.size;
    };
    const expectedCurrent7d = expectedScheduledCount(currentWindow);
    const deliveredCurrent7d = deliveredScheduledCount(currentWindow);
    const expectedPrevious7d = expectedScheduledCount(previousWindow);
    const deliveredPrevious7d = deliveredScheduledCount(previousWindow);
    const missedCurrent7d = Math.max(0, expectedCurrent7d - deliveredCurrent7d);
    const missedPrevious7d = Math.max(0, expectedPrevious7d - deliveredPrevious7d);
    const missedDelta7d = missedCurrent7d - missedPrevious7d;
    const successRate7d = expectedCurrent7d > 0
      ? Number(((deliveredCurrent7d / expectedCurrent7d) * 100).toFixed(1))
      : 100;
    const missedTrendLabel = missedDelta7d === 0
      ? "Flat vs prior 7d"
      : `${missedDelta7d > 0 ? "+" : ""}${missedDelta7d} missed vs prior 7d`;
    const lastSuccessfulScheduledRun = runs.find(r => !r.on_demand && (r.users_served || 0) > 0) || null;
    const nextExpectedActiveDelivery = activeRoster
      .filter(u => u.next_delivery_key)
      .sort((a, b) => String(a.next_delivery_key || "").localeCompare(String(b.next_delivery_key || "")))[0] || null;
    const minutesUntilEtKey = key => {
      const m = String(key || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}) ET$/);
      if (!m) return null;
      const [, yy, mo, dd, hh, mm] = m;
      const nowStamp = Date.UTC(nowEt.year, nowEt.month - 1, nowEt.day, nowEt.hour, nowEt.minute);
      const targetStamp = Date.UTC(parseInt(yy, 10), parseInt(mo, 10) - 1, parseInt(dd, 10), parseInt(hh, 10), parseInt(mm, 10));
      return Math.max(0, Math.round((targetStamp - nowStamp) / 60000));
    };
    const formatCountdown = totalMinutes => {
      if (totalMinutes == null) return "—";
      const mins = Math.max(0, totalMinutes);
      const days = Math.floor(mins / 1440);
      const hours = Math.floor((mins % 1440) / 60);
      const minutes = mins % 60;
      if (days > 0) return `${days}d ${hours}h`;
      if (hours > 0) return `${hours}h ${minutes}m`;
      return `${minutes}m`;
    };
    const nextExpectedCountdownMinutes = nextExpectedActiveDelivery
      ? minutesUntilEtKey(nextExpectedActiveDelivery.next_delivery_key)
      : null;
    const digestRun = digestRunStatus();
    const schedulerWorker = getCachedOrRefreshSchedulerHeartbeat();

    // Health / system status
    const lastRun = runs[0] || null; // runs is newest-first
    const serverUptimeSecs = Math.floor(process.uptime());
    const uptimeHours = Math.floor(serverUptimeSecs / 3600);
    const uptimeMins  = Math.floor((serverUptimeSecs % 3600) / 60);
    const uptimeStr   = uptimeHours > 0 ? `${uptimeHours}h ${uptimeMins}m` : `${uptimeMins}m`;
    const adminMessages = readJsonLineLog(ADMIN_MESSAGE_LOG, 30).map(m => ({
      at: m.at || null,
      actor: m.actor || "unknown",
      action: m.action || "message_user",
      target_email: m.target_email || null,
      target_email_masked: maskEmail(m.target_email || ""),
      target_chat_id: m.target_chat_id || null,
      requested_channels: Array.isArray(m.requested_channels) ? m.requested_channels : [],
      sent_channels: Array.isArray(m.sent_channels) ? m.sent_channels : [],
      success: !!m.success,
      errors: Array.isArray(m.errors) ? m.errors : [],
      message_preview: m.message_preview || "",
      payload_hash: m.payload_hash || null,
    }));

    const qualityUsers = roster.filter((u) => Number.isFinite(Number(u.dqs_current)));
    const qualityCurrentAvg = qualityUsers.length
      ? Number((qualityUsers.reduce((sum, u) => sum + Number(u.dqs_current || 0), 0) / qualityUsers.length).toFixed(2))
      : null;
    const quality7dAvg = qualityUsers.length
      ? Number((qualityUsers.reduce((sum, u) => sum + Number(u.dqs_7d_avg || u.dqs_current || 0), 0) / qualityUsers.length).toFixed(2))
      : null;
    const qualityImproving14d = qualityUsers.filter((u) => Number(u.dqs_14d_delta || 0) >= 5).length;
    const qualityAtRisk = qualityUsers.filter((u) => Number(u.dqs_current || 0) < 75).length;
    const feedbackTrend = computeFeedbackTrend(usersAll);

    return json(res, {
      summary: {
        all_time_cost:      parseFloat(sum(runs, "total_cost_usd").toFixed(4)),
        all_time_runs:      runs.length,
        all_time_deliveries: sum(runs, "users_served"),
        month_cost:         parseFloat(sum(monthRuns, "total_cost_usd").toFixed(4)),
        month_runs:         monthRuns.length,
        month_on_demand:    monthRuns.filter(r => r.on_demand).length,
        month_users_served: monthUsersServedFromRoster,
        month_unique_users: monthUsersServedFromRoster,
        month_unique_users_log: monthUniqueUsersLog.size,
        month_deliveries:   monthDeliveries,
        total_users:        roster.length,
        active_users:       activeUsersCount,
        active_tg_users:    activeTelegramUsersCount,
        month_label:        monthLabel,
        quality: {
          users_scored: qualityUsers.length,
          dqs_current_avg: qualityCurrentAvg,
          dqs_7d_avg: quality7dAvg,
          improving_14d: qualityImproving14d,
          at_risk: qualityAtRisk,
        },
        feedback: feedbackTrend,
      },
      health: {
        server_uptime:            uptimeStr,
        last_run_at:              lastRun ? lastRun.run_at_et || lastRun.run_at : null,
        last_run_users:           lastRun ? lastRun.users_served : null,
        last_run_cost:            lastRun ? `$${(lastRun.total_cost_usd || 0).toFixed(4)}` : null,
        cron_schedule:            "5-minute worker loop (always-on VM)",
        users_delivery_warning:   deliveryWarnings,
        delivery_reliability: {
          success_rate_7d: successRate7d,
          delivered_7d: deliveredCurrent7d,
          expected_7d: expectedCurrent7d,
          missed_current_7d: missedCurrent7d,
          missed_previous_7d: missedPrevious7d,
          missed_delta_7d: missedDelta7d,
          missed_trend_label: missedTrendLabel,
          last_successful_scheduled_run: lastSuccessfulScheduledRun
            ? (lastSuccessfulScheduledRun.run_at_et || lastSuccessfulScheduledRun.run_at || null)
            : null,
          next_expected_delivery_et: nextExpectedActiveDelivery?.next_delivery_et || null,
          next_expected_countdown: formatCountdown(nextExpectedCountdownMinutes),
          next_expected_countdown_minutes: nextExpectedCountdownMinutes,
        },
        scheduler_worker:         schedulerWorker,
        digest_runner: digestRun.running
          ? {
            running: true,
            state: digestRun.state || "valid",
            unhealthy: digestRun.state === "corrupt" || digestRun.state === "io_error" || digestRun.state === "stale_uncleared",
            mode: digestRun.lock.mode || "scheduled",
            started_at: digestRun.lock.startedAtIso || digestRun.lock.startedAt || null,
            age_seconds: Math.max(0, Math.round((digestRun.lock.ageMs || 0) / 1000)),
            pid: digestRun.lock.pid || null,
            error: digestRun.lock.error || null,
          }
          : { running: false, state: digestRun.state || "absent", unhealthy: false },
        engagement_events: {
          ignored_backfill_emitted: ignoredBackfill.emitted || 0,
          ignored_backfill_considered: ignoredBackfill.considered || 0,
        },
      },
      runs: runs.slice(0, 30),
      per_user: perUser,
      roster,
      engagement,
      referrals,
      admin_messages: adminMessages,
    });
  }

  // GET /api/admin/user-by-email?email=... — admin user lookup
  if (pathname === "/api/admin/user-by-email" && req.method === "GET") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    const emailParam = url.searchParams.get("email");
    if (!emailParam) return json(res, { error: "email required" }, 400);
    const requestedAutoLimit = parseInt(url.searchParams.get("auto_limit"), 10);
    const autoLimit = Number.isFinite(requestedAutoLimit)
      ? Math.min(Math.max(requestedAutoLimit, 1), 20)
      : 8;
    const lookup = emailParam.toLowerCase().trim();
    const adminUser = allUsers().find(u => (u.email || "").toLowerCase().trim() === lookup);
    if (!adminUser) return json(res, { error: "not found" }, 404);
    return json(res, {
      ...adminUser,
      auto_adjustments_recent: getRecentAutoAdjustmentsForUser(adminUser, autoLimit),
    });
  }

  // GET /api/admin/audit?email=... — unified admin timeline per user
  if (pathname === "/api/admin/audit" && req.method === "GET") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    const email = String(url.searchParams.get("email") || "").toLowerCase().trim();
    if (!email) return json(res, { error: "email required" }, 400);
    const requestedLimit = parseInt(url.searchParams.get("limit"), 10);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 120) : 30;

    const actionRows = readJsonLineLog(ADMIN_ACTION_LOG, limit * 6)
      .filter(row => String(row.target_email || "").toLowerCase().trim() === email)
      .map(row => {
        const action = String(row.action || "action");
        const details = row.details && typeof row.details === "object" ? row.details : {};
        let summary = action;
        if (action === "set_delivery_time" && details.from && details.to) {
          summary = `Delivery time ${details.from} → ${details.to}`;
        } else if (action === "bulk_pause") {
          summary = "Paused deliveries";
        } else if (action === "bulk_resume") {
          summary = "Resumed deliveries";
        } else if (action === "bulk_resend_link") {
          summary = "Resent settings link";
        } else if (action === "bulk_set_time" && details.to) {
          summary = `Set delivery time to ${details.to}`;
        } else if (action === "run_digest_targeted") {
          summary = row.success ? "Triggered digest run" : "Digest run failed";
        }
        return {
          at: row.at || null,
          actor: row.actor || "unknown",
          type: "action",
          action,
          success: row.success !== false,
          summary,
          details,
        };
      });

    const messageRows = readJsonLineLog(ADMIN_MESSAGE_LOG, limit * 6)
      .filter(row => String(row.target_email || "").toLowerCase().trim() === email)
      .map(row => ({
        at: row.at || null,
        actor: row.actor || "unknown",
        type: "message",
        action: "message_user",
        success: !!row.success,
        summary: row.success
          ? `Message sent via ${(row.sent_channels || []).join(" + ") || "channel"}`
          : `Message failed: ${(row.errors || []).join(" | ") || "unknown error"}`,
        details: {
          requested_channels: Array.isArray(row.requested_channels) ? row.requested_channels : [],
          sent_channels: Array.isArray(row.sent_channels) ? row.sent_channels : [],
          errors: Array.isArray(row.errors) ? row.errors : [],
          message_preview: row.message_preview || "",
        },
      }));

    const entries = [...actionRows, ...messageRows]
      .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
      .slice(0, limit);
    return json(res, { entries });
  }

  // POST /api/admin/bulk-action — dry-run + apply safe admin bulk ops
  if (pathname === "/api/admin/bulk-action" && req.method === "POST") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    const body = await requireJsonBody(req, res);
    if (body == null) return;
    const action = String(body.action || "").toLowerCase().trim();
    const dryRun = body.dry_run !== false;
    const emailsRaw = Array.isArray(body.emails) ? body.emails : [];
    const uniqueEmails = [...new Set(
      emailsRaw
        .map(v => String(v || "").toLowerCase().trim())
        .filter(Boolean)
    )].slice(0, 200);

    if (!uniqueEmails.length) return json(res, { error: "at least one email required" }, 400);
    const allowedActions = new Set(["set_time", "pause", "resume", "resend_link"]);
    if (!allowedActions.has(action)) return json(res, { error: "unsupported bulk action" }, 400);

    let normalizedTime = null;
    if (action === "set_time") {
      normalizedTime = normalizeDeliveryTimeInput(body.delivery_time);
      if (!normalizedTime) return json(res, { error: "invalid delivery_time" }, 400);
    }

    const usersByEmail = new Map(
      allUsers()
        .filter(u => u.email)
        .map(u => [String(u.email).toLowerCase().trim(), u])
    );

    const planned = [];
    const skipped = [];
    for (const email of uniqueEmails) {
      const user = usersByEmail.get(email);
      if (!user) {
        skipped.push({ email, reason: "user not found" });
        continue;
      }
      if (action === "set_time") {
        const from = String((user.preferences || {}).delivery_time || "07:00");
        if (from === normalizedTime) {
          skipped.push({ email, reason: "delivery time unchanged" });
          continue;
        }
        planned.push({ email, user, kind: "bulk_set_time", from, to: normalizedTime });
        continue;
      }
      if (action === "pause") {
        const from = String(user.status || "active");
        if (from === "paused") {
          skipped.push({ email, reason: "already paused" });
          continue;
        }
        planned.push({ email, user, kind: "bulk_pause", from, to: "paused" });
        continue;
      }
      if (action === "resume") {
        const from = String(user.status || "active");
        if (from === "active") {
          skipped.push({ email, reason: "already active" });
          continue;
        }
        planned.push({ email, user, kind: "bulk_resume", from, to: "active" });
        continue;
      }
      if (action === "resend_link") {
        if (!user.token) {
          skipped.push({ email, reason: "missing user token" });
          continue;
        }
        planned.push({ email, user, kind: "bulk_resend_link" });
      }
    }

    const affected = planned.map(item => ({
      email: item.email,
      name: item.user.name || item.user.email || item.user.chatId || "",
      action: item.kind,
      from: item.from || null,
      to: item.to || null,
      status: "planned",
    }));

    if (dryRun) {
      return json(res, {
        success: true,
        dry_run: true,
        action,
        requested: uniqueEmails.length,
        applicable: planned.length,
        skipped,
        affected,
      });
    }

    const applied = [];
    for (const item of planned) {
      try {
        if (item.kind === "bulk_set_time") {
          const updated = {
            ...item.user,
            preferences: {
              ...(item.user.preferences || {}),
              delivery_time: item.to,
            },
            last_updated: new Date().toISOString(),
          };
          writeUser(item.user.chatId, updated);
        } else if (item.kind === "bulk_pause" || item.kind === "bulk_resume") {
          const updated = {
            ...item.user,
            status: item.to,
            last_updated: new Date().toISOString(),
          };
          writeUser(item.user.chatId, updated);
        } else if (item.kind === "bulk_resend_link") {
          await sendMagicLinkEmail(item.user);
        }
        logAdminActionEvent(req, {
          action: item.kind,
          target_email: item.email,
          success: true,
          details: { from: item.from || null, to: item.to || null },
        });
        applied.push({ ...item, status: "applied" });
      } catch (e) {
        const reason = e.message || "failed";
        skipped.push({ email: item.email, reason });
        logAdminActionEvent(req, {
          action: item.kind,
          target_email: item.email,
          success: false,
          details: { reason, from: item.from || null, to: item.to || null },
        });
      }
    }

    return json(res, {
      success: true,
      dry_run: false,
      action,
      requested: uniqueEmails.length,
      applicable: planned.length,
      applied: applied.length,
      skipped,
      affected: applied.map(item => ({
        email: item.email,
        name: item.user.name || item.user.email || item.user.chatId || "",
        action: item.kind,
        from: item.from || null,
        to: item.to || null,
        status: "applied",
      })),
    });
  }

  // POST /api/admin/update-delivery-time — admin inline schedule editor
  if (pathname === "/api/admin/update-delivery-time" && req.method === "POST") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);

    const body = await requireJsonBody(req, res);
    if (body == null) return;
    const email = String(body.email || "").toLowerCase().trim();
    const deliveryTime = normalizeDeliveryTimeInput(body.delivery_time);

    if (!email) return json(res, { error: "email required" }, 400);
    if (!deliveryTime) {
      return json(res, { error: "invalid delivery time (use HH:MM or H:MM AM/PM)" }, 400);
    }

    const user = allUsers().find(u => (u.email || "").toLowerCase().trim() === email);
    if (!user) return json(res, { error: "user not found" }, 404);
    const previousDeliveryTime = String((user.preferences || {}).delivery_time || "07:00");

    const [h, m] = deliveryTime.split(":").map(Number);
    const updated = {
      ...user,
      preferences: {
        ...(user.preferences || {}),
        delivery_time: deliveryTime,
      },
      last_updated: new Date().toISOString(),
    };

    writeUser(user.chatId, updated);
    logAdminActionEvent(req, {
      action: "set_delivery_time",
      target_email: email,
      success: true,
      details: {
        from: previousDeliveryTime,
        to: deliveryTime,
      },
    });
    return json(res, {
      success: true,
      email,
      delivery_time: deliveryTime,
      delivery_time_label: formatTimeEt(h, m),
    });
  }

  // POST /api/admin/run-digest — trigger a digest run
  if (pathname === "/api/admin/run-digest" && req.method === "POST") {
    return handleAdminRunDigest(req, res);
  }

  // POST /api/admin/message-user — send custom admin message via configured channels
  // Accept trailing slash variant for proxy/canonicalization compatibility.
  if ((pathname === "/api/admin/message-user" || pathname === "/api/admin/message-user/") && req.method === "POST") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    const body = await requireJsonBody(req, res);
    if (body == null) return;
    const email = String(body.email || "").toLowerCase().trim();
    const message = String(body.message || "").trim();
    const subject = String(body.subject || "Message from SignalBrief").trim().slice(0, 140) || "Message from SignalBrief";
    const channels = Array.isArray(body.channels)
      ? body.channels.map(c => String(c).toLowerCase().trim()).filter(Boolean)
      : [];
    const messagePreview = summarizeMessage(message);
    const payloadHash = hashText(message);
    const writeAudit = (extra = {}) => {
      logAdminMessageEvent(req, {
        action: "message_user",
        target_email: email || null,
        target_chat_id: extra.target_chat_id || null,
        requested_channels: channels,
        sent_channels: Array.isArray(extra.sent_channels) ? extra.sent_channels : [],
        subject,
        message_length: message.length,
        message_preview: messagePreview,
        payload_hash: payloadHash,
        success: !!extra.success,
        errors: Array.isArray(extra.errors) ? extra.errors : [],
      });
    };

    if (!email) {
      writeAudit({ success: false, errors: ["email required"] });
      return json(res, { error: "email required" }, 400);
    }
    if (message.length < 2) {
      writeAudit({ success: false, errors: ["message too short"] });
      return json(res, { error: "message too short" }, 400);
    }
    if (message.length > 4000) {
      writeAudit({ success: false, errors: ["message too long (max 4000 chars)"] });
      return json(res, { error: "message too long (max 4000 chars)" }, 400);
    }
    if (!channels.length) {
      writeAudit({ success: false, errors: ["select at least one channel"] });
      return json(res, { error: "select at least one channel" }, 400);
    }

    const user = allUsers().find(u => (u.email || "").toLowerCase().trim() === email);
    if (!user) {
      writeAudit({ success: false, errors: ["user not found"] });
      return json(res, { error: "user not found" }, 404);
    }

    const prefs = user.preferences || {};
    const emailReady = !!user.email && prefs.email_enabled !== false;
    const tgReady = !!(user.chatId && !String(user.chatId).startsWith("email-") && prefs.telegram_enabled !== false);
    const wantsEmail = channels.includes("email");
    const wantsTelegram = channels.includes("telegram");

    const sent = { email: false, telegram: false };
    const errors = [];

    if (wantsEmail) {
      if (!emailReady) {
        errors.push("email channel not available for this user");
      } else {
        try {
          const html = `
            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:28px 22px;color:#111;">
              <div style="font-size:21px;font-weight:700;margin-bottom:12px;">☀️ SignalBrief</div>
              <div style="font-size:14px;color:#6B7280;margin-bottom:14px;">Message from the SignalBrief team</div>
              <div style="font-size:15px;line-height:1.65;color:#1F2937;white-space:pre-wrap;">${escapeHtml(message)}</div>
            </div>`;
          await sendEmail(user.email, subject, html, user.token || null);
          sent.email = true;
        } catch (e) {
          errors.push(`email failed: ${e.message}`);
        }
      }
    }

    if (wantsTelegram) {
      if (!tgReady) {
        errors.push("telegram channel not available for this user");
      } else {
        try {
          await sendTelegramText(user.chatId, `📣 SignalBrief update\n\n${message}`);
          sent.telegram = true;
        } catch (e) {
          errors.push(`telegram failed: ${e.message}`);
        }
      }
    }

    if (!sent.email && !sent.telegram) {
      writeAudit({
        target_chat_id: user.chatId || null,
        sent_channels: [],
        success: false,
        errors,
      });
      return json(res, { error: errors.join(" | ") || "no channels succeeded" }, 400);
    }

    writeAudit({
      target_chat_id: user.chatId || null,
      sent_channels: [
        sent.email ? "email" : null,
        sent.telegram ? "telegram" : null,
      ].filter(Boolean),
      success: true,
      errors,
    });

    return json(res, {
      success: true,
      sent,
      warnings: errors,
      message: `Sent via ${[
        sent.email ? "email" : null,
        sent.telegram ? "telegram" : null,
      ].filter(Boolean).join(" + ")}`,
    });
  }

  // ── Sandbox API ──────────────────────────────────────────────────────────────

  // POST /api/admin/sandbox/estimate — cost estimate without API calls
  if (pathname === "/api/admin/sandbox/estimate" && req.method === "POST") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    const body = await requireJsonBody(req, res);
    if (body == null) return;
    try {
      const { estimateCost } = require("../../src/sandbox-pipeline");
      const estimate = estimateCost(body);
      return json(res, estimate);
    } catch (err) {
      return json(res, { error: err.message }, 500);
    }
  }

  // POST /api/admin/sandbox/run — run pipeline, return results (no delivery)
  if (pathname === "/api/admin/sandbox/run" && req.method === "POST") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    const body = await requireJsonBody(req, res);
    if (body == null) return;
    try {
      const { runPipeline } = require("../../src/sandbox-pipeline");
      const result = await runPipeline(body);
      return json(res, result);
    } catch (err) {
      return json(res, { error: err.message }, 500);
    }
  }

  return false;
}

module.exports = {
  handleAdminApiRoutes,
};
