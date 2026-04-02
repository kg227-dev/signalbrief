const BULK_ACTIONS = new Set(["set_time", "pause", "resume", "resend_link"]);

function normalizeBulkEmails(emailsRaw) {
  return [...new Set(
    (Array.isArray(emailsRaw) ? emailsRaw : [])
      .map((value) => String(value || "").toLowerCase().trim())
      .filter(Boolean)
  )].slice(0, 200);
}

function planBulkActionEntries({ action, normalizedTime, uniqueEmails, usersByEmail }) {
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

    if (!user.token) {
      skipped.push({ email, reason: "missing user token" });
      continue;
    }
    planned.push({ email, user, kind: "bulk_resend_link" });
  }

  return { planned, skipped };
}

function mapBulkAffected(items, status) {
  return items.map((item) => ({
    email: item.email,
    name: item.user.name || item.user.email || item.user.chatId || "",
    action: item.kind,
    from: item.from || null,
    to: item.to || null,
    status,
  }));
}

async function applyBulkActionEntries({
  req,
  planned,
  skipped,
  writeUser,
  sendMagicLinkEmail,
  logAdminActionEvent,
}) {
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
    } catch (error) {
      const reason = error.message || "failed";
      skipped.push({ email: item.email, reason });
      logAdminActionEvent(req, {
        action: item.kind,
        target_email: item.email,
        success: false,
        details: { reason, from: item.from || null, to: item.to || null },
      });
    }
  }
  return { applied, skipped };
}

module.exports = {
  BULK_ACTIONS,
  normalizeBulkEmails,
  planBulkActionEntries,
  mapBulkAffected,
  applyBulkActionEntries,
};
