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

module.exports = {
  sendReferralThankYouEmail,
};
