function verificationPrompt(email) {
  return (
    `🔐 I sent a 6-digit verification code to *${email}*.\n\n`
    + "Reply here with `/verify 123456` to link this Telegram chat to your existing account.\n\n"
    + "Code expires in 10 minutes."
  );
}

function linkSuccessMessage(updatedUser, formatDeliveryTime) {
  const firstName = (updatedUser.name || "").split(" ")[0] || "there";
  return (
    `✅ *Verified, ${firstName}!* Telegram is now linked to your SignalBrief account.\n\n`
    + `Digest arrives at *${formatDeliveryTime(updatedUser.preferences)}* by email.\n\n`
    + "Use ⚙️ /settings if you need to change topics or delivery time."
  );
}

module.exports = {
  verificationPrompt,
  linkSuccessMessage,
};
