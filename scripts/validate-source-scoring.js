#!/usr/bin/env node
"use strict";

/**
 * validate-source-scoring.js
 *
 * Validates that source scoring changes are live in the current runtime:
 * - cloudcomputing-news.net  → demoted (suspect tier, score ~0.15)
 * - ciodive.com              → promoted (strong tier, score ~0.80)
 * - lawrenceevans.com        → unreviewed review-state (not auto-weak)
 * - benzinga.com             → weak tier (score ~0.22)
 * - reuters.com              → premium tier (score ~0.95)
 *
 * Also validates source_preferences scoring spread in annotateEditorialSignals.
 *
 * Usage: node scripts/validate-source-scoring.js
 */

const { classifySourceTier, annotateEditorialSignals } = require("../src/digest/domain/storyline-domain-runtime");

// ── helpers ──────────────────────────────────────────────────────────────────

function pass(label) { process.stdout.write(`  ✅  ${label}\n`); }
function fail(label, extra) { process.stdout.write(`  ❌  ${label}${extra ? ` (${extra})` : ""}\n`); }

let failures = 0;
function assert(condition, label, extra) {
  if (condition) { pass(label); } else { fail(label, extra); failures++; }
}

// ── 1. Tier and authority score checks ───────────────────────────────────────

console.log("\n── Source tier classification ──────────────────────────────────");

const cases = [
  {
    domain: "cloudcomputing-news.net",
    tag: "TECHNOLOGY",
    expectedTier: "suspect",
    maxAuthority: 0.20,
    label: "cloudcomputing-news.net → suspect tier, authority ≤ 0.20",
  },
  {
    domain: "ciodive.com",
    tag: "TECHNOLOGY",
    expectedTier: "strong",
    minAuthority: 0.75,
    label: "ciodive.com → strong tier, authority ≥ 0.75",
  },
  {
    domain: "lawrenceevans.com",
    tag: "STRATEGY",
    // Not a suspect domain by heuristic (no hyphens, .com TLD) — remains
    // unreviewed/review-state and drops via content quality gate.
    expectedTier: "unknown",
    minAuthority: 0.38,
    maxAuthority: 0.45,
    label: "lawrenceevans.com → unknown tier, authority in review-state band",
  },
  {
    domain: "benzinga.com",
    tag: "HEALTHCARE",
    expectedTier: "weak",
    maxAuthority: 0.26,
    label: "benzinga.com → weak tier, authority ≤ 0.26",
  },
  {
    domain: "reuters.com",
    tag: "HEALTHCARE",
    expectedTier: "premium",
    minAuthority: 0.90,
    label: "reuters.com → premium tier, authority ≥ 0.90",
  },
  {
    domain: "esgtoday.com",
    tag: "SUSTAINABILITY",
    expectedTier: "strong",
    minAuthority: 0.75,
    label: "esgtoday.com → strong tier, authority ≥ 0.75",
  },
];

for (const { domain, tag, expectedTier, minAuthority, maxAuthority, label } of cases) {
  const result = classifySourceTier(domain, tag);
  const tierOk = result.source_tier === expectedTier;
  const authOk = (minAuthority == null || result.source_authority >= minAuthority)
    && (maxAuthority == null || result.source_authority <= maxAuthority);
  assert(
    tierOk && authOk,
    label,
    tierOk && authOk ? null : `tier=${result.source_tier}, authority=${result.source_authority.toFixed(3)}`
  );
}

// ── 2. Score spread: premium vs unknown vs suspect ────────────────────────────

console.log("\n── Authority score spread ──────────────────────────────────────");

const premiumScore = classifySourceTier("reuters.com", "HEALTHCARE").source_authority;
const strongScore = classifySourceTier("ciodive.com", "TECHNOLOGY").source_authority;
const unknownScore = classifySourceTier("somenewssite.com", "TECHNOLOGY").source_authority;
const suspectScore = classifySourceTier("cloudcomputing-news.net", "TECHNOLOGY").source_authority;

console.log(`  premium (reuters.com):              ${premiumScore.toFixed(3)}`);
console.log(`  strong  (ciodive.com):              ${strongScore.toFixed(3)}`);
console.log(`  unknown (somenewssite.com):         ${unknownScore.toFixed(3)}`);
console.log(`  suspect (cloudcomputing-news.net):  ${suspectScore.toFixed(3)}`);
console.log(`  spread premium→suspect:             ${(premiumScore - suspectScore).toFixed(3)}`);

assert(premiumScore - suspectScore >= 0.70, "Premium/suspect spread ≥ 0.70", `spread=${(premiumScore - suspectScore).toFixed(3)}`);
assert(strongScore > unknownScore, "strong > unknown", `${strongScore.toFixed(3)} vs ${unknownScore.toFixed(3)}`);
assert(unknownScore > suspectScore, "unknown > suspect", `${unknownScore.toFixed(3)} vs ${suspectScore.toFixed(3)}`);

// ── 3. annotateEditorialSignals populates source_tier + source_authority ──────

console.log("\n── annotateEditorialSignals integration ────────────────────────");

const sampleItems = [
  {
    tag: "TECHNOLOGY",
    headline: "AI demand pushes companies to invest billions in cloud infrastructure",
    summary: "Cloud providers see massive capex increases due to AI workload demand.",
    wim_brief: "Cloud capex surges on AI demand.",
    strategic_value: 0.82,
    source_domain: "cloudcomputing-news.net",
    source: "cloudcomputing-news.net",
    url: "https://cloudcomputing-news.net/ai-cloud-investment",
  },
  {
    tag: "TECHNOLOGY",
    headline: "Global sovereign cloud spend to increase 35.6% in 2026",
    summary: "Sovereign cloud market grows on geopolitical data residency requirements.",
    wim_brief: "Sovereign cloud grows 35.6%.",
    strategic_value: 0.84,
    source_domain: "ciodive.com",
    source: "ciodive.com",
    url: "https://www.ciodive.com/news/sovereign-cloud-2026",
  },
  {
    tag: "STRATEGY",
    headline: "10 strategy frameworks every CXO must know",
    summary: "Lawrence Evans shares strategy insights for modern executives.",
    wim_brief: "Strategy frameworks for executives.",
    strategic_value: 0.61,
    source_domain: "lawrenceevans.com",
    source: "lawrenceevans.com",
    url: "https://lawrenceevans.com/strategy-frameworks",
  },
];

const annotated = annotateEditorialSignals(sampleItems);

for (const item of annotated) {
  const d = item.source_domain;
  console.log(`  ${d}: tier=${item.source_tier}, authority=${item.source_authority}, strategic_value=${item.strategic_value}`);
}

const ccn = annotated.find((i) => i.source_domain === "cloudcomputing-news.net");
const cio = annotated.find((i) => i.source_domain === "ciodive.com");
const law = annotated.find((i) => i.source_domain === "lawrenceevans.com");

assert(ccn?.source_tier === "suspect", "cloudcomputing-news.net annotated as suspect", `tier=${ccn?.source_tier}`);
assert(ccn?.source_authority <= 0.20, `cloudcomputing-news.net authority ≤ 0.20`, `auth=${ccn?.source_authority}`);
assert(cio?.source_tier === "strong", "ciodive.com annotated as strong", `tier=${cio?.source_tier}`);
assert(cio?.source_authority >= 0.75, "ciodive.com authority ≥ 0.75", `auth=${cio?.source_authority}`);
// lawrenceevans.com: not suspect by heuristic (.com, no hyphens) but remains
// review-state and drops via strategic_value quality gate (< 0.34 minimum).
assert(law?.source_tier === "unknown", "lawrenceevans.com annotated as unknown tier", `tier=${law?.source_tier}`);
assert(law?.source_policy === "review", "lawrenceevans.com policy is review", `policy=${law?.source_policy}`);
const QUALITY_GATE = 0.34;
assert(
  law?.strategic_value < QUALITY_GATE,
  `lawrenceevans.com strategic_value (${law?.strategic_value}) below quality gate (${QUALITY_GATE}) → dropped`,
  `strategic_value=${law?.strategic_value}`
);
assert(cio?.source_authority > ccn?.source_authority, "ciodive authority > cloudcomputing-news authority");
assert(cio?.source_authority > law?.source_authority, "ciodive authority > lawrenceevans authority");

// ── 4. Strategic value gap after annotation ───────────────────────────────────

console.log("\n── Strategic value after annotation ────────────────────────────");
console.log(`  cloudcomputing-news.net strategic_value: ${ccn?.strategic_value}`);
console.log(`  ciodive.com         strategic_value: ${cio?.strategic_value}`);
console.log(`  lawrenceevans.com   strategic_value: ${law?.strategic_value}`);

// source_authority is 15% of strategic_value computation — verify direction
assert(
  cio?.strategic_value > ccn?.strategic_value,
  "ciodive strategic_value > cloudcomputing-news strategic_value",
  `${cio?.strategic_value} vs ${ccn?.strategic_value}`
);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n────────────────────────────────────────────────────────────────`);
if (failures === 0) {
  console.log(`✅  All checks passed — source scoring changes are live and correct.\n`);
} else {
  console.log(`❌  ${failures} check(s) failed — review output above.\n`);
  process.exit(1);
}
