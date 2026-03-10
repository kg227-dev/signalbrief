const {
  firstName,
  topicListForUser,
  deliveryTimeLabelEt,
  lifecycleEmailShell,
  profileLinks,
  buildMissingEmailResult,
} = require("./common");

async function sendReferralThankYouEmail(referrerUser, newUser, deps) {
  const { sendEmail, buildMailResult } = deps;
  if (!referrerUser?.email) return buildMissingEmailResult(buildMailResult);
  const referrerFirst = firstName(referrerUser.name, referrerUser.email.split("@")[0]);
  const newUserFirst = firstName(newUser?.name, "someone");
  const subject = "Your recommendation just brought someone in";
  const html = lifecycleEmailShell(`
    <p style="margin:0 0 14px;">Hey ${referrerFirst},</p>
    <p style="margin:0 0 14px;">Just wanted to let you know — ${newUserFirst} just signed up for SignalBrief using your referral link. They'll get their first digest this morning.</p>
    <p style="margin:0 0 14px;">Thanks for sharing it. The only way this grows is word of mouth from people like you.</p>
    <p style="margin:0;">— Kush</p>
  `);
  const result = await sendEmail(referrerUser.email, subject, html, referrerUser.token || null);
  console.log(`[referral thank-you] ${referrerUser.email} -> ${result.ok ? `sent via ${result.via}` : "failed"}`);
  return result;
}

function sendReengagementDay4EmailForUser(user, deps) {
  const { sendEmail, getBaseUrl, normalizeBaseUrl, buildMailResult } = deps;
  if (!user?.email) return Promise.resolve(buildMissingEmailResult(buildMailResult));
  const name = firstName(user.name, user.email.split("@")[0]);
  const links = profileLinks(user, normalizeBaseUrl, getBaseUrl);
  const topics = topicListForUser(user);
  const deliveryTime = deliveryTimeLabelEt(user);
  const subject = "Your SignalBrief is still running — want to adjust anything?";
  const html = lifecycleEmailShell(`
    <p style="margin:0 0 14px;">Hi ${name},</p>
    <p style="margin:0 0 14px;">I noticed you haven't opened SignalBrief in a few days. No judgment — inboxes are brutal.</p>
    <p style="margin:0 0 10px;">A few things that might help:</p>
    <p style="margin:0 0 10px;">Wrong topics? You're currently getting ${topics}. Update them in 30 seconds: <a href="${links.settings}" style="color:#2563EB;text-decoration:none;">settings</a></p>
    <p style="margin:0 0 10px;">Wrong time? Your digest arrives at ${deliveryTime}. Too early, too late? Change it: <a href="${links.settings}" style="color:#2563EB;text-decoration:none;">settings</a></p>
    <p style="margin:0 0 14px;">Too much text? Switch to headline-only depth for a faster scan: <a href="${links.settings}" style="color:#2563EB;text-decoration:none;">settings</a></p>
    <p style="margin:0 0 14px;">Or just reply here and tell me what's not working. I read every reply.</p>
    <p style="margin:0;">— Kush</p>
  `);
  return sendEmail(user.email, subject, html, user.token || null);
}

function sendReengagementDay8EmailForUser(user, deps) {
  const { sendEmail, getBaseUrl, normalizeBaseUrl, buildMailResult } = deps;
  if (!user?.email) return Promise.resolve(buildMissingEmailResult(buildMailResult));
  const name = firstName(user.name, user.email.split("@")[0]);
  const links = profileLinks(user, normalizeBaseUrl, getBaseUrl);
  const subject = "Should I pause your SignalBrief?";
  const html = lifecycleEmailShell(`
    <p style="margin:0 0 14px;">Hi ${name},</p>
    <p style="margin:0 0 14px;">You haven't opened SignalBrief in about a week. I don't want to fill your inbox if it's not useful.</p>
    <p style="margin:0 0 10px;">Keep it going: <a href="${links.reactivate}" style="color:#2563EB;text-decoration:none;">I'll keep sending as normal</a>.</p>
    <p style="margin:0 0 14px;">Pause it: <a href="${links.pause}" style="color:#2563EB;text-decoration:none;">I'll stop for now</a>. You can restart anytime from your settings.</p>
    <p style="margin:0 0 14px;">No wrong answer. If the timing or topics aren't right, I'd rather pause than become noise.</p>
    <p style="margin:0;">— Kush</p>
  `);
  return sendEmail(user.email, subject, html, user.token || null);
}

function sendAutoPauseConfirmationEmailForUser(user, deps) {
  const { sendEmail, getBaseUrl, normalizeBaseUrl, buildMailResult } = deps;
  if (!user?.email) return Promise.resolve(buildMissingEmailResult(buildMailResult));
  const name = firstName(user.name, user.email.split("@")[0]);
  const links = profileLinks(user, normalizeBaseUrl, getBaseUrl);
  const subject = "Your SignalBrief is paused for now";
  const html = lifecycleEmailShell(`
    <p style="margin:0 0 14px;">Hi ${name},</p>
    <p style="margin:0 0 14px;">We've paused your SignalBrief digest to keep your inbox clean — you hadn't opened it in a while and I didn't want to keep sending.</p>
    <p style="margin:0 0 14px;">To restart, it takes one click: <a href="${links.reactivate}" style="color:#2563EB;text-decoration:none;">reactivate SignalBrief</a></p>
    <p style="margin:0 0 14px;">Your topics and settings are all saved — you'll pick up right where you left off.</p>
    <p style="margin:0;">— Kush</p>
  `);
  return sendEmail(user.email, subject, html, user.token || null);
}

module.exports = {
  sendReferralThankYouEmail,
  sendReengagementDay4EmailForUser,
  sendReengagementDay8EmailForUser,
  sendAutoPauseConfirmationEmailForUser,
};
