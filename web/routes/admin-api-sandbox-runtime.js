async function handleAdminSandboxRoutes(ctx, deps) {
  const { req, pathname } = ctx;
  const {
    json,
    isAdminAuthed,
    requireJsonBody,
    estimateSandboxCost,
    runSandboxPipeline,
    appendSandboxCostLog,
  } = deps;

  if (pathname === "/api/admin/sandbox/estimate" && req.method === "POST") {
    if (!isAdminAuthed(req)) {
      json(ctx.res, { error: "admin access only" }, 403);
      return true;
    }
    const body = await requireJsonBody(req, ctx.res);
    if (body == null) return true;
    try {
      const estimate = estimateSandboxCost(body);
      json(ctx.res, estimate);
    } catch (error) {
      json(ctx.res, { error: error.message }, 500);
    }
    return true;
  }

  if (pathname === "/api/admin/sandbox/run" && req.method === "POST") {
    if (!isAdminAuthed(req)) {
      json(ctx.res, { error: "admin access only" }, 403);
      return true;
    }
    const body = await requireJsonBody(req, ctx.res);
    if (body == null) return true;
    try {
      const result = await runSandboxPipeline(body);

      // Record sandbox cost so it appears in admin cost totals
      if (typeof appendSandboxCostLog === "function" && result?.cost) {
        const now = new Date();
        appendSandboxCostLog({
          date: now.toLocaleDateString("en-CA", { timeZone: "America/New_York" }),
          run_id: `sandbox:${now.toISOString().replace(/[:.]/g, "-")}`,
          run_at: now.toISOString(),
          run_at_et: now.toLocaleString("en-US", {
            timeZone: "America/New_York",
            month: "short", day: "numeric",
            hour: "numeric", minute: "2-digit", hour12: true,
          }),
          on_demand: true,
          sandbox: true,
          perplexity_calls: Number(result.cost.perplexity?.calls || 0),
          perplexity_calls_standard: Number(result.cost.perplexity?.calls || 0),
          perplexity_calls_custom: 0,
          perplexity_cost_usd: Number(result.cost.perplexity?.costUsd || 0),
          claude_tokens_in: Number(result.cost.claude?.inputTokens || 0),
          claude_tokens_out: Number(result.cost.claude?.outputTokens || 0),
          claude_cost_usd: Number(result.cost.claude?.costUsd || 0),
          total_cost_usd: Number(result.cost.totalUsd || 0),
          users_targeted: 0,
          users_served: 0,
          per_user: [],
          per_user_failed: [],
        });
      }

      json(ctx.res, result);
    } catch (error) {
      json(ctx.res, { error: error.message }, 500);
    }
    return true;
  }

  return false;
}

module.exports = {
  handleAdminSandboxRoutes,
};
