"use strict";

function createDigestOrchestratorEnrichmentRuntime(deps) {
  const {
    enrichItems,
    emitDigestIncident,
  } = deps;
  const emitIncident = typeof emitDigestIncident === "function"
    ? emitDigestIncident
    : async () => false;

  async function enrichSelectedItems(params) {
    const {
      selected,
      enrichOpts,
      runMode,
      dueUsersCount,
    } = params;
    const enrichment = await enrichItems(selected, enrichOpts);
    const degradation = enrichment?.degradation && typeof enrichment.degradation === "object"
      ? enrichment.degradation
      : null;
    if (enrichment?.degraded && degradation?.provider) {
      await emitIncident(
        `${degradation.provider}-partial-degradation`,
        `${degradation.provider} degradation during enrichment (${degradation.reason || "unknown"})`,
        {
          mode: runMode,
          due_users: Number(dueUsersCount || 0),
          selected_items: Array.isArray(selected) ? selected.length : 0,
          provider: degradation.provider,
          reason: degradation.reason || "unknown",
          status_code: degradation.status_code != null ? Number(degradation.status_code) : null,
          timeout_ms: degradation.timeout_ms != null ? Number(degradation.timeout_ms) : null,
        }
      );
    }
    return {
      enriched: Array.isArray(enrichment?.items) ? enrichment.items : [],
      claudeUsage: {
        input_tokens: Number(enrichment?.usage?.input_tokens || 0),
        output_tokens: Number(enrichment?.usage?.output_tokens || 0),
      },
    };
  }

  return {
    enrichSelectedItems,
  };
}

module.exports = {
  createDigestOrchestratorEnrichmentRuntime,
};
