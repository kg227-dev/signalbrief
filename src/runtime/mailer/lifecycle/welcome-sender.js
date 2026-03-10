const {
  buildWelcomeDeliveryLabel,
  buildWelcomeDaysLabel,
  buildWelcomeDepthLabel,
  buildWelcomeTopicsHtml,
} = require("./welcome-content");

async function sendWelcomeEmailForUser(user, deps) {
  const { sendEmail, getBaseUrl, loadWelcomeTemplate } = deps;
  const { name, email } = user;
  const prefs = user.preferences || {};
  const baseUrl = getBaseUrl();
  const settingsUrl = `${baseUrl}/settings?token=${user.token}`;
  const archiveUrl = `${baseUrl}/archive?token=${user.token}`;
  const first = (name || "there").split(" ")[0];
  const timeLabel = buildWelcomeDeliveryLabel(prefs);
  const daysLabel = buildWelcomeDaysLabel(prefs);
  const depthLabel = buildWelcomeDepthLabel(prefs);
  const topics = user.topics || [];
  const topicsHtml = buildWelcomeTopicsHtml(topics);

  const html = loadWelcomeTemplate()
    .replace(/\{\{NAME\}\}/g, first)
    .replace(/\{\{TOPICS_HTML\}\}/g, topicsHtml)
    .replace(/\{\{TOPIC_COUNT\}\}/g, String(topics.length))
    .replace(/\{\{DELIVERY_TIME_LABEL\}\}/g, timeLabel)
    .replace(/\{\{DELIVERY_DAYS_LABEL\}\}/g, daysLabel)
    .replace(/\{\{DEPTH_LABEL\}\}/g, depthLabel)
    .replace(/\{\{ITEMS_COUNT\}\}/g, String(prefs.items_per_digest || 5))
    .replace(/\{\{SETTINGS_URL\}\}/g, settingsUrl)
    .replace(/\{\{ARCHIVE_URL\}\}/g, archiveUrl)
    .replace(/\{\{USER_EMAIL\}\}/g, email);

  const subject = `Welcome to SignalBrief, ${first} — your brief is set for ${timeLabel}`;
  const result = await sendEmail(email, subject, html, user.token);
  console.log(`[welcome email] ${email} -> ${result.ok ? `sent via ${result.via}` : "failed"}`);
  return result;
}

module.exports = {
  sendWelcomeEmailForUser,
};
