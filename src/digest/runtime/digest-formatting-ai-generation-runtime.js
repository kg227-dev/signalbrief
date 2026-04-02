"use strict";

function createDigestAiGenerationRuntime(deps) {
  const {
    callHaikuOneLine,
    stripInlineHtml,
  } = deps;

  function fallbackSubjectLine(now) {
    const label = now.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      timeZone: "America/New_York",
    });
    return `Your signals for ${label}`;
  }

  async function generateLeadSubjectLine(leadItem, now) {
    const fallback = fallbackSubjectLine(now);
    if (!leadItem || !leadItem.headline) {
      return { subject: fallback, usage: { input_tokens: 0, output_tokens: 0 } };
    }

    const prompt = `Given this news headline and "why it matters" analysis, write a single email subject line (max 65 characters) for a daily sector briefing read by operators, founders, investors, and team leads following one topic closely. The subject should hint at the business implication without being clickbait. No emoji. No "SignalBrief" in the subject.

Headline: ${stripInlineHtml(leadItem.headline)}
Why it matters: ${stripInlineHtml(leadItem.wim || leadItem.wim_brief || leadItem.summary || "")}

Reply with ONLY the subject line, no quotes, no explanation.`;

    try {
      const { text, usage } = await callHaikuOneLine(prompt, 60);
      if (!text || text.length > 100 || /[\r\n]/.test(text) || /signalbrief/i.test(text)) {
        return { subject: fallback, usage };
      }
      return { subject: text, usage };
    } catch {
      // Intentionally silent: subject generation is best-effort and falls back to a deterministic label.
      return { subject: fallback, usage: { input_tokens: 0, output_tokens: 0 } };
    }
  }

  async function generateEditorialNote(items) {
    const safeItems = Array.isArray(items) ? items.filter((item) => item && item.headline) : [];
    if (!safeItems.length) return { note: "", usage: { input_tokens: 0, output_tokens: 0 } };

    const stories = safeItems
      .map((item) => `[${String(item.tag || "news").trim()}] ${stripInlineHtml(item.headline)}`)
      .join(", ");
    const prompt = `Write a single editorial sentence (max 120 characters) for a focused sector briefing. It should flag the clearest business pattern across these ${safeItems.length} stories. Be specific. Name a company, regulator, buyer segment, or supply chain node. No hedging. No "today's digest" language.

Stories: ${stories}

Reply with ONLY the sentence, no quotes.`;

    try {
      const { text, usage } = await callHaikuOneLine(prompt, 40);
      if (!text || text.length > 120 || /[\r\n]/.test(text)) {
        return { note: "", usage };
      }
      return { note: text, usage };
    } catch {
      // Intentionally silent: editorial-note generation is optional and should not fail the digest.
      return { note: "", usage: { input_tokens: 0, output_tokens: 0 } };
    }
  }

  return {
    generateLeadSubjectLine,
    generateEditorialNote,
  };
}

module.exports = {
  createDigestAiGenerationRuntime,
};
