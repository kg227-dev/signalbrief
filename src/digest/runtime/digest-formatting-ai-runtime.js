"use strict";

const { createDigestAiGenerationRuntime } = require("./digest-formatting-ai-generation-runtime");

function createDigestAiFormattingRuntime(deps) {
  const {
    CONFIG,
    httpsPostWithRetry,
  } = deps;

  function stripInlineHtml(raw) {
    return String(raw || "")
      .replace(/<\/?[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function sanitizeSingleLineModelOutput(raw) {
    return String(raw || "")
      .replace(/```[\s\S]*?```/g, "")
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  async function callHaikuOneLine(prompt, maxTokens) {
    const res = await httpsPostWithRetry(
      "api.anthropic.com",
      "/v1/messages",
      { "Content-Type": "application/json", "x-api-key": CONFIG.keys.anthropic, "anthropic-version": "2023-06-01" },
      {
        model: "claude-haiku-4-5",
        max_tokens: Math.max(8, Number(maxTokens || 40)),
        messages: [{ role: "user", content: String(prompt || "").trim() }],
      }
    );
    const usage = {
      input_tokens: Number(res.body?.usage?.input_tokens || 0),
      output_tokens: Number(res.body?.usage?.output_tokens || 0),
    };
    if (res.status >= 400) throw new Error(`haiku status ${res.status}`);
    const text = sanitizeSingleLineModelOutput(res.body?.content?.[0]?.text || "");
    return { text, usage };
  }

  const generationRuntime = createDigestAiGenerationRuntime({
    callHaikuOneLine,
    stripInlineHtml,
  });

  return {
    stripInlineHtml,
    generateLeadSubjectLine: generationRuntime.generateLeadSubjectLine,
    generateEditorialNote: generationRuntime.generateEditorialNote,
  };
}

module.exports = {
  createDigestAiFormattingRuntime,
};
