function firstName(value, fallback = "there") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  return raw.split(/\s+/)[0] || fallback;
}

function topicLabel(topic) {
  const raw = String(topic || "").trim();
  if (!raw) return "";
  return raw.replace(/_/g, " ");
}

function topicListForUser(user) {
  const topics = Array.isArray(user?.topics) ? user.topics : [];
  const labels = topics.map(topicLabel).filter(Boolean);
  return labels.length ? labels.join(", ") : "your selected topics";
}

function deliveryTimeLabelEt(user) {
  const prefs = user?.preferences || {};
  const [hRaw, mRaw] = String(prefs.delivery_time || "07:00").split(":").map(Number);
  const h = Number.isFinite(hRaw) ? hRaw : 7;
  const m = Number.isFinite(mRaw) ? mRaw : 0;
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm} ET`;
}

function lifecycleEmailShell(innerHtml) {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:620px;margin:0 auto;padding:28px 22px;color:#111827;background:#F9FAFB;">
      <div style="background:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;padding:24px 22px;">
        <div style="font-size:21px;font-weight:700;margin-bottom:14px;">☀️ SignalBrief</div>
        <div style="font-size:15px;line-height:1.65;color:#1F2937;">${innerHtml}</div>
      </div>
    </div>`;
}

function profileLinks(user, normalizeBaseUrl, getBaseUrl) {
  const token = encodeURIComponent(String(user?.token || "").trim());
  const root = normalizeBaseUrl(getBaseUrl());
  return {
    settings: `${root}/settings?token=${token}`,
    pause: `${root}/api/pause?token=${token}`,
    reactivate: `${root}/api/reactivate?token=${token}`,
  };
}

function buildMissingEmailResult(buildMailResult) {
  return buildMailResult({
    ok: false,
    via: "none",
    skipped: true,
    error: "missing recipient email",
  });
}

module.exports = {
  firstName,
  topicListForUser,
  deliveryTimeLabelEt,
  lifecycleEmailShell,
  profileLinks,
  buildMissingEmailResult,
};
