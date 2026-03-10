const crypto = require("crypto");

function chatKey(chatId) {
  return String(chatId);
}

function normalizeEmail(value) {
  return String(value || "").toLowerCase().trim();
}

function generateVerificationCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function validateCodeInput(codeRaw) {
  const code = String(codeRaw || "").trim();
  if (!/^\d{6}$/.test(code)) {
    return { ok: false, message: "Please provide a 6-digit code, e.g. `/verify 123456`." };
  }
  return { ok: true, code };
}

module.exports = {
  chatKey,
  normalizeEmail,
  generateVerificationCode,
  validateCodeInput,
};
