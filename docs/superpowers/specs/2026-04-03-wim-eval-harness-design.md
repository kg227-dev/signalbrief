# WIM Evaluation Harness — Design Spec
**Date:** 2026-04-03
**Status:** Approved, pending implementation
**Scope:** Build a repeatable, phased evaluation system to determine whether a WIM generation system is good enough to ship.

---

## 1. Overview

SignalBrief's "Why It Matters" (WIM) is the core value layer of each digest item. Quality is currently inconsistent — sometimes generic, sometimes restating the headline, sometimes missing the strategic implication. This harness provides a repeatable, data-driven way to answer: *is this prompt/system safe to ship?*

The harness follows the same architecture as the existing retrieval eval system (`src/eval/retrieval/`) and is a permanent fixture, not a one-off script.

---

## 2. Module Structure

```
src/eval/wim/
  dataset-builder.js      # Archive loader, gold set proposer
  generator-runtime.js    # WIM generation per variant × input_mode
  judge-runtime.js        # Model judge: pass/fail, scores, failure tags
  report-runtime.js       # CSV + markdown summary builder
  manifest-runtime.js     # Run manifest read/write

src/entrypoints/
  wim-eval.js             # CLI entrypoint

evals/prompts/
  baseline.json           # Production prompt snapshot (auto-copied, not edited)
  variant-a.json          # Candidate prompt A
  variant-b.json          # Candidate prompt B
  (additional variants as needed)

evals/config/
  judge-rubric.json       # Versioned rubric: pass/fail criteria, score dims, failure tags, ship gate

data/wim-evals/
  YYYY-MM-DD-HH/
    manifest.json
    dataset.json
    gold-set.json         # Auto-proposed, user edits and approves before generate phase
    generated.json
    judged.json
    human-review.csv      # Pre-populated template, filled manually
    report.csv
    summary.md
```

---

## 3. Prompt File Format

Each file in `evals/prompts/` follows this schema:

```json
{
  "version": "variant-a-v1",
  "description": "Implication-first framing, forced business lever",
  "createdFrom": null,
  "notes": "",
  "prompt": "...",
  "model": null,
  "temperature": 0.3,
  "maxTokens": 600,
  "supportedInputModes": ["minimal", "enhanced"]
}
```

- `model`: null means use the `--model` flag default
- `createdFrom`: for `baseline.json`, records the production prompt snapshot date (e.g. `"production prompt snapshot 2026-04-03"`)
- `supportedInputModes`: documents which input conditions this prompt was designed for

---

## 4. CLI Interface

**Entrypoint:** `node src/entrypoints/wim-eval.js`

```
Flags:
  --phase=dataset|generate|judge|report   (required)
  --run=YYYY-MM-DD-HH                     (required for generate/judge/report)
  --dates=YYYY-MM-DD,...                   (dataset: which archive days, default: last 7 available)
  --variants=baseline,variant-a,...        (generate: which prompt files, default: all in --prompt-dir)
  --model=claude-sonnet-4-6               (generate + judge, default: claude-sonnet-4-6)
  --judge-model=claude-sonnet-4-6         (judge only, overrides --model for judge)
  --input-modes=minimal,enhanced          (generate, default: both)
  --gold-set-only                         (judge/report: restrict to gold set items)
  --prompt-dir=evals/prompts              (default)
  --output-dir=data/wim-evals             (default)
  --gold-set-path=...                     (override default gold-set.json path)
  --limit=N                               (smoke test: first N items only)
  --overwrite=false|true                  (default: false — exits with error if phase artifact exists; use true to overwrite)
  --help
```

**Phase behavior:**

| Phase | Reads | Writes | Blocks on |
|---|---|---|---|
| `dataset` | `/archive/*.json` | `dataset.json`, `gold-set.json`, `manifest.json` | nothing |
| `generate` | `dataset.json`, `gold-set.json`, prompt files, `manifest.json` | `generated.json`, updates manifest | `goldSetApproved: true` in `gold-set.json` |
| `judge` | `generated.json`, `judge-rubric.json`, `manifest.json` | `judged.json`, updates manifest | nothing |
| `report` | `judged.json`, `manifest.json` | `report.csv`, `summary.md`, `human-review.csv` | nothing |

**Example workflow:**
```bash
# 1. Build dataset from last 7 available archive dates
node src/entrypoints/wim-eval.js --phase=dataset

# 2. Review/edit data/wim-evals/YYYY-MM-DD-HH/gold-set.json
#    Set "goldSetApproved": true when ready

# 3. Generate WIMs (minimal smoke test first)
node src/entrypoints/wim-eval.js --phase=generate --run=YYYY-MM-DD-HH --variants=baseline,variant-a --limit=5

# 4. Full generate run
node src/entrypoints/wim-eval.js --phase=generate --run=YYYY-MM-DD-HH --variants=baseline,variant-a

# 5. Judge with Sonnet (default)
node src/entrypoints/wim-eval.js --phase=judge --run=YYYY-MM-DD-HH

# 6. Re-judge with Haiku for cost comparison
node src/entrypoints/wim-eval.js --phase=judge --run=YYYY-MM-DD-HH --judge-model=claude-haiku-4-5 --overwrite=true

# 7. Report
node src/entrypoints/wim-eval.js --phase=report --run=YYYY-MM-DD-HH
```

---

## 5. Data Structures

### `dataset.json`
```json
{
  "items": [
    {
      "id": "2026-04-01:HEALTHCARE:0",
      "date": "2026-04-01",
      "topic": "HEALTHCARE",
      "headline": "...",
      "summary": "...",
      "source": "...",
      "source_domain": "...",
      "url": "...",
      "publishedAt": "...",
      "existing_wim": "...",
      "baselinePromptVersion": "baseline-v1",
      "excerpt": "...",
      "baseScore": 8.2,
      "strategic_value": 0.87,
      "writeup_status": "model_pass",
      "writeup_rejection_reasons": [],
      "inGoldSet": false
    }
  ],
  "meta": {
    "dates": ["2026-03-28", "..."],
    "totalItems": 47,
    "topics": ["HEALTHCARE", "TECHNOLOGY", "..."]
  }
}
```

### `gold-set.json`
```json
{
  "goldSetApproved": false,
  "proposedAt": "2026-04-03T10:00:00Z",
  "targetSize": 25,
  "items": [
    {
      "id": "2026-04-01:HEALTHCARE:0",
      "topic": "HEALTHCARE",
      "headline": "...",
      "selectionReason": "top-per-topic",
      "notes": ""
    }
  ]
}
```

`goldSetApproved` must be `true` before the generate phase will proceed. User edits the file directly, can remove/add items and add `notes` per item.

### `generated.json`
```json
{
  "rows": [
    {
      "id": "2026-04-01:HEALTHCARE:0",
      "variant": "variant-a",
      "promptVersion": "variant-a-v1",
      "promptFile": "evals/prompts/variant-a.json",
      "inputMode": "minimal",
      "model": "claude-haiku-4-5",
      "temperature": 0.3,
      "maxTokens": 600,
      "inputPayloadHash": "sha256:...",
      "generatedWim": "...",
      "generatedAt": "2026-04-03T10:00:00Z",
      "tokensUsed": 312
    }
  ]
}
```

### `judged.json`
```json
{
  "rows": [
    {
      "id": "2026-04-01:HEALTHCARE:0",
      "variant": "variant-a",
      "inputMode": "minimal",
      "judgeModel": "claude-sonnet-4-6",
      "rubricVersion": "v1",
      "passFail": "pass",
      "overallScore": 3.8,
      "scores": {
        "specificity": 4,
        "insightDepth": 4,
        "strategicRelevance": 5,
        "nonRedundancy": 4,
        "clarityTightness": 3
      },
      "failureTags": [],
      "isCatastrophicFailure": false,
      "primaryFailureReason": null,
      "judgeRationale": "Identifies a named pricing lever specific to this merger announcement.",
      "judgedAt": "2026-04-03T10:05:00Z"
    }
  ]
}
```

### `manifest.json`
```json
{
  "runId": "2026-04-03-10",
  "archiveDates": ["2026-03-28", "..."],
  "itemCount": 47,
  "goldSetSize": 24,
  "promptVersions": ["baseline-v1", "variant-a-v1"],
  "generationModel": "claude-haiku-4-5",
  "judgeModel": "claude-sonnet-4-6",
  "rubricVersion": "v1",
  "inputModes": ["minimal", "enhanced"],
  "compareAgainst": "baseline",
  "promptDir": "evals/prompts",
  "outputDir": "data/wim-evals",
  "goldSetApproved": false,
  "phases": {
    "dataset":  { "completedAt": "2026-04-03T10:00:00Z", "done": true },
    "generate": { "completedAt": null, "done": false },
    "judge":    { "completedAt": null, "done": false },
    "report":   { "completedAt": null, "done": false }
  }
}
```

---

## 6. Gold Set Selection Algorithm

The `dataset` phase auto-proposes the gold set. Topic balance is a hard constraint applied first.

**Hard constraint — topic coverage:**
Guarantee at least 1 item per topic; aim for 2 where item count allows. Applied before all other tiers.

**Tier 1 — Importance (~35% of remaining slots):**
Items where `baseScore >= 7.5 OR strategic_value >= 0.75`, preferring items satisfying both. These are high-importance stories.

**Tier 2 — Borderline / tricky (~40% of remaining slots):**
Items where `writeup_status === "repair_pass"` OR `writeup_rejection_reasons.length > 0`. These are items the production system already found difficult. Labeled `selectionReason: "borderline-tricky"`.

**Tier 3 — Generic-risk (~10–15% of remaining slots):**
Items that are especially likely to trigger cliché outputs — topic-level stories, broad sector summaries, items with vague `signal_shift`. Labeled `selectionReason: "generic-risk"`.

**Tier 4 — Diversity fill (remaining slots):**
Fill by spreading across dates. Prefer items with `cross_source_count >= 2` as a weak signal, but do not over-weight it — single-source items with high `strategic_value` belong too.

**Exclusion rule:**
Avoid filling the gold set with items that are "too easy and too clean" — items with high score, no rejection reasons, and a current WIM that already reads as strong. A few are fine for calibration; they should not dominate.

**Final step:**
Cap at 30. Shuffle order to avoid anchoring during human review.

---

## 7. Judge Rubric (`evals/config/judge-rubric.json`)

```json
{
  "rubricVersion": "v1",
  "passFail": {
    "criteria": [
      "Clearly states implication (not just summary)",
      "Specific to this article (not reusable across articles)",
      "Adds information not already in the headline",
      "Factually grounded — not hallucinated or unsupported by the article",
      "Concise: target 1–2 sentences; up to 3 acceptable; hard fail if >3 or obviously bloated"
    ],
    "rule": "ALL must pass for overall pass"
  },
  "scoreDimensions": [
    { "key": "specificity",        "label": "Specificity",         "min": 1, "max": 5 },
    { "key": "insightDepth",       "label": "Insight Depth",       "min": 1, "max": 5 },
    { "key": "strategicRelevance", "label": "Strategic Relevance", "min": 1, "max": 5 },
    { "key": "nonRedundancy",      "label": "Non-Redundancy",      "min": 1, "max": 5 },
    { "key": "clarityTightness",   "label": "Clarity / Tightness", "min": 1, "max": 5 }
  ],
  "failureTags": [
    "GENERIC",
    "RESTATES_HEADLINE",
    "VAGUE_IMPLICATION",
    "WRONG_IMPLICATION",
    "OVERCONFIDENT",
    "NOT_GROUNDED_IN_ARTICLE",
    "TOO_BROAD",
    "CATEGORY_CLICHE",
    "TOO_LONG",
    "WEAK_LEAD"
  ],
  "catastrophicCriteria": {
    "tags": ["WRONG_IMPLICATION", "OVERCONFIDENT", "NOT_GROUNDED_IN_ARTICLE"],
    "note": "Any catastrophic tag fires isCatastrophicFailure. Low score alone is not sufficient."
  },
  "shipGate": {
    "minPassRate": 0.75,
    "humanPreferenceMinRate": 0.60,
    "catastrophicFailMaxCount": 0,
    "genericClicheMaxRate": 0.10,
    "noMaterialTopicRegression": {
      "definition": "Material regression = pass rate drop beyond 10 points, or any new catastrophic failure, or human preference loss on gold-set items for a topic"
    }
  }
}
```

**Judge model input:** headline, summary, and (if enhanced mode) excerpt, plus the generated WIM and structured rubric criteria.

**Judge model output fields (structured JSON):**
- `passFail`, `overallScore`, `scores` (5 dimensions), `failureTags`, `isCatastrophicFailure`, `primaryFailureReason`, `judgeRationale`

`overallScore` is the mean of the 5 score dimensions, rounded to one decimal place. It is computed by `judge-runtime.js` from the model's raw dimension scores, not requested directly from the model.

The rubric is versioned independently of prompt files. You can re-judge existing `generated.json` with a new rubric version without touching prompts.

---

## 8. Report Output

### `report.csv`
One row per item × variant × input_mode. Columns:

`id, date, topic, source_domain, url, variant, promptVersion, inputMode, judgeModel, rubricVersion, passFail, overallScore, specificity, insightDepth, strategicRelevance, nonRedundancy, clarityTightness, failureTags, isCatastrophicFailure, primaryFailureReason, inGoldSet, isBaseline, compareAgainst, scoreDeltaVsBaseline, passDeltaVsBaseline, generatedWim`

### `human-review.csv`
Pre-populated template, filled manually. Columns:

`id, topic, headline, label_a_is, wim_a, wim_b, winner, preferred_reason_tag, notes`

- `label_a_is`: which variant was shown as "A" (randomized for blind review)
- `preferred_reason_tag`: constrained vocabulary — `sharper`, `more_specific`, `more_grounded`, `less_generic`, `too_aggressive`, `too_vague`, `other`

### `summary.md` — Section Order

1. **Recommendation** (executive summary: ship / no-ship / pending; one-sentence reason; biggest improvement; biggest remaining risk)
2. **Overall** (pass rate, avg score, catastrophic failures, generic rate, cliché rate — baseline vs variants)
3. **Gold Set Results** (pass rate, avg score, catastrophic failures, human A/B preference — gold-set-only slice)
4. **By Topic** (pass rate with counts e.g. `79% (11/14)`, delta vs baseline, regression flag per topic)
5. **Failure Pattern Analysis** (top failure modes by variant; GENERIC and CATEGORY_CLICHE shown separately; by input mode)
6. **By Input Mode** (pass rate, avg score delta, catastrophic rate — minimal vs enhanced)
7. **Consistency / Variance Check** (score std dev by topic, variant, input mode; what high variance signals)
8. **Notable Wins / Notable Fails** (3–5 examples: strongest improved rewrites, worst remaining failures)
9. **Ship Gate Assessment** (split into model-only gates vs human-review-pending gates)
10. **Next Actions**

---

## 9. Input Modes

Each generated WIM is produced under two input conditions:

- **minimal**: `headline + summary` only
- **enhanced**: `headline + summary + excerpt` (where available; falls back to minimal if excerpt is null)

This isolates whether failures are prompt problems or input problems.

---

## 10. Instrumentation

Every run logs per-phase and per-row:

**Per run (manifest):** `runId`, `promptVersions`, `generationModel`, `judgeModel`, `rubricVersion`, `inputModes`, `archiveDates`, `itemCount`, `goldSetSize`, `compareAgainst`, `phase timestamps + completion flags`

**Per row (generated/judged):** `promptVersion`, `promptFile`, `inputMode`, `model`, `temperature`, `maxTokens`, `inputPayloadHash`, `generatedWim`, `tokensUsed`, `judgeModel`, `rubricVersion`, `passFail`, `overallScore`, `scores`, `failureTags`, `isCatastrophicFailure`, `primaryFailureReason`, `judgeRationale`

This enables longitudinal tracking, prompt iteration, and judge-model consistency comparisons across runs.

---

## 11. Ship Gate (Non-Negotiable)

A new WIM system ships only when:

| Gate | Threshold | Type |
|---|---|---|
| Pass rate | ≥75% | Model-only |
| Catastrophic failures | 0 | Model-only |
| Generic + cliché rate | ≤10% | Model-only |
| No material topic regression | per definition in rubric | Model-only |
| Human A/B preference on gold set | ≥60% for new variant | Human-review |

The `summary.md` Ship Gate section explicitly separates model-only gates (can be assessed immediately) from the human-review gate (requires filling `human-review.csv`).

---

## 12. Out of Scope (v1)

- Admin web UI (no UI in v1)
- Auto-resume / incremental phase orchestration (Approach C)
- Multi-WIM generation + ranking
- Consistency testing across similar articles
- Latency + cost tracking per variant (tokensUsed is captured but no rollup)
- Rejected candidate evaluation

These are Phase 2 enhancements documented in the original spec.
