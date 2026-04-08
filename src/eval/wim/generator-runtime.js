"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");
const {
  writeJsonAtomic,
  readJson,
  updateManifest,
  markPhaseComplete,
} = require("./manifest-runtime");

function loadPromptFiles(promptDir, variants) {
  const names = variants && variants.length > 0
    ? variants
    : fs.readdirSync(promptDir).filter(f => f.endsWith(".json")).map(f => f.replace(".json", ""));
  const files = {};
  for (const name of names) {
    const filePath = path.join(promptDir, `${name}.json`);
    if (!fs.existsSync(filePath)) throw new Error(`Prompt file not found: ${filePath}`);
    files[name] = JSON.parse(fs.readFileSync(filePath, "utf8"));
  }
  return files;
}

function assemblePrompt(promptFile, item, inputMode) {
  const excerptLine = (inputMode === "enhanced" && item.excerpt)
    ? `\nExcerpt: ${String(item.excerpt).slice(0, 800)}`
    : "";
  return `${promptFile.prompt}---\nArticle:\nHeadline: ${item.headline || ""}\nSummary: ${item.summary || ""}${excerptLine}\n`;
}

function callClaude(apiKey, model, prompt, maxTokens, temperature) {
  return new Promise(function(resolve, reject) {
    const body = JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [{ role: "user", content: prompt }],
    });
    const req = https.request({
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(body),
      },
    }, function(res) {
      let data = "";
      res.on("data", function(chunk) { data += chunk; });
      res.on("end", function() {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(`Claude API ${res.statusCode}: ${data}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`Failed to parse Claude response: ${e.message}`));
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function parseWimResponse(text) {
  const cleaned = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  try {
    const obj = JSON.parse(cleaned);
    const finalWim = obj.finalWim || obj.wim || null;
    const finalWimBrief = obj.finalWimBrief || obj.wim_brief || null;
    return {
      wim: finalWim,
      wim_brief: finalWimBrief,
      finalWim,
      finalWimBrief,
    };
  } catch (_) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const obj = JSON.parse(match[0]);
        const finalWim = obj.finalWim || obj.wim || null;
        const finalWimBrief = obj.finalWimBrief || obj.wim_brief || null;
        return {
          wim: finalWim,
          wim_brief: finalWimBrief,
          finalWim,
          finalWimBrief,
        };
      } catch (_2) { /* fall through */ }
    }
    return { wim: null, wim_brief: null, finalWim: null, finalWimBrief: null };
  }
}

function buildStageRecord(stage, extras = {}) {
  return {
    stage,
    status: extras.status || "not_started",
    attemptCount: Number(extras.attemptCount || 0),
    formattingRetryUsed: extras.formattingRetryUsed === true,
    parseFailureType: extras.parseFailureType || null,
    validatorReasons: Array.isArray(extras.validatorReasons) ? extras.validatorReasons.slice() : [],
    output: extras.output || null,
    rawText: extras.rawText || null,
    generatedAt: extras.generatedAt || null,
  };
}

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

async function runGeneratePhase(opts) {
  const { runDir, promptDir, variants, inputModes, model, limit, overwrite, apiKey } = opts;

  const generatedPath = path.join(runDir, "generated.json");
  if (!overwrite && fs.existsSync(generatedPath)) {
    throw new Error(`generated.json already exists in ${runDir}. Use --overwrite=true to overwrite.`);
  }

  const goldSet = readJson(path.join(runDir, "gold-set.json"));
  if (!goldSet.goldSetApproved) {
    throw new Error(`gold-set.json has goldSetApproved=false. Edit the file and set it to true before running generate.`);
  }

  const dataset = readJson(path.join(runDir, "dataset.json"));
  const items = limit ? dataset.items.slice(0, limit) : dataset.items;
  const promptFiles = loadPromptFiles(promptDir, variants);
  const variantNames = Object.keys(promptFiles);
  const modes = inputModes && inputModes.length > 0 ? inputModes : ["minimal", "enhanced"];
  const defaultModel = model || "claude-sonnet-4-6";

  const rows = [];

  for (const item of items) {
    for (const variantName of variantNames) {
      const pf = promptFiles[variantName];
      const effectiveModel = pf.model || defaultModel;
      const temperature = pf.temperature != null ? pf.temperature : 0.3;
      const maxTokens = pf.maxTokens || 600;
      const supportedModes = pf.supportedInputModes || ["minimal", "enhanced"];

      for (const inputMode of modes) {
        const effectiveMode = supportedModes.includes(inputMode) ? inputMode : "minimal";
        const prompt = assemblePrompt(pf, item, effectiveMode);
        const hash = crypto.createHash("sha256").update(prompt).digest("hex").slice(0, 16);

        let generatedWim = null;
        let generatedWimBrief = null;
        let tokensUsed = 0;
        let generationStage = buildStageRecord("generation");

        try {
          const response = await callClaude(apiKey, effectiveModel, prompt, maxTokens, temperature);
          const text = (response && response.content && response.content[0] && response.content[0].text) || "";
          const parsedWim = parseWimResponse(text);
          generatedWim = parsedWim.finalWim || parsedWim.wim;
          generatedWimBrief = parsedWim.finalWimBrief || parsedWim.wim_brief;
          generationStage = buildStageRecord("generation", {
            status: generatedWim ? "model_pass" : "failed",
            attemptCount: 1,
            formattingRetryUsed: false,
            parseFailureType: generatedWim ? null : "validator_mismatch",
            output: {
              finalWim: generatedWim,
              finalWimBrief: generatedWimBrief,
              generatedWim,
              generatedWimBrief,
            },
            rawText: text,
            generatedAt: new Date().toISOString(),
          });
          tokensUsed = ((response.usage && response.usage.input_tokens) || 0) +
                       ((response.usage && response.usage.output_tokens) || 0);
        } catch (err) {
          process.stderr.write(`[wim-eval] generate error ${item.id} ${variantName} ${inputMode}: ${err.message}\n`);
          generationStage = buildStageRecord("generation", {
            status: "failed",
            attemptCount: 1,
            parseFailureType: "malformed_json",
            output: null,
            rawText: "",
            generatedAt: new Date().toISOString(),
          });
        }

        rows.push({
          id: item.id,
          variant: variantName,
          promptVersion: pf.version,
          promptFile: path.join(promptDir, `${variantName}.json`),
          inputMode: effectiveMode,
          model: effectiveModel,
          temperature,
          maxTokens,
          inputPayloadHash: hash,
          finalWim: generatedWim,
          finalWimBrief: generatedWimBrief,
          generatedWim,
          generatedWimBrief,
          stages: {
            extraction: buildStageRecord("extraction"),
            generation: generationStage,
            repair: buildStageRecord("repair"),
          },
          generatedAt: new Date().toISOString(),
          tokensUsed,
        });

        await sleep(150);
      }
    }
  }

  writeJsonAtomic(generatedPath, { rows });
  updateManifest(runDir, {
    promptVersions: variantNames.map(n => promptFiles[n].version),
    generationModel: defaultModel,
    inputModes: modes,
  });
  markPhaseComplete(runDir, "generate");

  return { rows };
}

module.exports = {
  loadPromptFiles,
  assemblePrompt,
  callClaude,
  parseWimResponse,
  buildStageRecord,
  runGeneratePhase,
};
