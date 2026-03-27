"use strict";

function handleCheckAvailabilityRoute(ctx, deps) {
  const { req, res, pathname } = ctx;
  if (pathname !== "/api/check-availability" || req.method !== "POST") return false;

  const { json, requireJsonBody, allUsers } = deps;

  return (async () => {
    const body = await requireJsonBody(req, res);
    if (!body) return true;

    const email = String(body.email || "").toLowerCase().trim();
    if (!email) {
      json(res, { emailTaken: false });
      return true;
    }

    const users = allUsers();
    const emailTaken = users.some((u) => (u.email || "").toLowerCase().trim() === email);
    json(res, { emailTaken });
    return true;
  })();
}

module.exports = {
  handleCheckAvailabilityRoute,
};
