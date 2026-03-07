function createCommandRouter(handlers) {
  const fallback = handlers.default || handlers.help;

  return async function routeCommand(intent, chatId) {
    const action = String(intent?.action || "unknown");
    const handler = handlers[action] || fallback;
    if (!handler) return null;
    return handler(intent, chatId);
  };
}

module.exports = {
  createCommandRouter,
};
