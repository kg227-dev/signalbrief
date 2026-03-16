"use strict";

function handleCheckAvailabilityRoute(ctx, deps) {
  const { req, res, pathname } = ctx;
  if (pathname !== "/api/check-availability" || req.method !== "POST") return false;

  const { json, requireJsonBody, allUsers } = deps;

  return (async () => {
    const body = await requireJsonBody(req, res);
    if (!body) return true;

    const email = String(body.email || "").toLowerCase().trim();
    const telegramRaw = body.telegram ? String(body.telegram).replace(/^@+/, "").trim() : null;
    const telegram = telegramRaw ? telegramRaw.toLowerCase() : null;

    if (!email) {
      json(res, { emailTaken: false, telegramTaken: false });
      return true;
    }

    const users = allUsers();
    const emailTaken = users.some((u) => (u.email || "").toLowerCase().trim() === email);
    const telegramTaken = telegram
      ? users.some((u) => {
          const t = (u.telegram || "").toLowerCase().trim();
          return t && t === telegram;
        })
      : false;

    json(res, { emailTaken, telegramTaken });
    return true;
  })();
}

module.exports = {
  handleCheckAvailabilityRoute,
};
