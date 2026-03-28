function buildWelcomeDeliveryLabel(prefs) {
  const [hRaw, mRaw] = String(prefs.delivery_time || "07:00").split(":").map(Number);
  const ampm = hRaw >= 12 ? "PM" : "AM";
  const hour = hRaw % 12 || 12;
  return `${hour}:${String(mRaw).padStart(2, "0")} ${ampm} ET`;
}

function buildWelcomeDaysLabel(prefs) {
  const days = prefs.days_of_week || [1, 2, 3, 4, 5];
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  if (days.length === 7) return "Every day";
  if (days.length === 6 && days.includes(6)) return "Mon-Sat";
  if (days.length === 5 && !days.includes(0) && !days.includes(6)) return "Mon-Fri";
  return days.map((day) => dayNames[day]).join(", ");
}

function buildWelcomeDepthLabel(prefs) {
  const depthLabels = {
    headline_only: "Scan (headlines only)",
    scan: "Scan (headlines only)",
    headline_plus_oneliner: "Brief (headline + one-liner)",
    headline_plus_why: "Brief (headline + why it matters)",
    deep: "Deep (extended analysis)",
  };
  return depthLabels[prefs.depth] || "Brief (headline + why it matters)";
}

function buildWelcomeTopicsHtml(topics) {
  return (topics || []).map((topic) => {
    return `<span style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:0.05em;color:#2563EB;background:#EFF6FF;padding:3px 10px;border-radius:4px;margin:0 5px 6px 0;">${topic}</span>`;
  }).join("");
}

module.exports = {
  buildWelcomeDeliveryLabel,
  buildWelcomeDaysLabel,
  buildWelcomeDepthLabel,
  buildWelcomeTopicsHtml,
};
