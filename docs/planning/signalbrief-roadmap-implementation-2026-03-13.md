# SignalBrief Roadmap Implementation Tasks

## Stage 1
- Add editorial signal enrichment fields: `strategic_value`, `content_flags`, `storyline_hints`.
- Add local source tiering, entity extraction, routine-item detection, and heuristic storyline clustering.
- Collapse repeated same-day narrative variants into a single storyline representative.

## Stage 2
- Replace item scoring with a componentized score that includes:
  - topical relevance
  - custom-keyword relevance
  - strategic importance
  - novelty vs recent history
  - source authority
  - multi-source confirmation
  - recency
  - duplication penalty
  - entity saturation penalty
- Add same-digest entity cap and recent-entity saturation logic.
- Add an early strategic-quality gate so weak custom/topic matches do not survive by default.

## Stage 3
- Persist durable per-user digest delivery records keyed by user/date/mode.
- Enforce strict scheduled idempotency and versioned manual/on-demand reruns.
- Persist full delivered item snapshots for archive correctness.
- Update archive APIs to prefer the delivered snapshot over shared run archives.

## Stage 4
- Replace misleading `Match %` copy with `Digest quality` / `Signal score`.
- Add focused regression tests for:
  - storyline collapse
  - low-value suppression
  - entity saturation
  - duplicate scheduled send prevention
  - archive snapshot preference
