"use strict";

function createDigestOrchestratorEnrichmentRuntime(deps) {
  const {
    enrichItems,
  } = deps;

  async function enrichSelectedItems(params) {
    const {
      selected,
      enrichOpts,
    } = params;
    const enrichment = await enrichItems(selected, enrichOpts);
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
