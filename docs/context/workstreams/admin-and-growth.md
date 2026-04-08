# Admin And Growth

*Last reviewed: April 8, 2026*

Use this capsule when the task touches admin surfaces, signup, archive UX, referral/growth flows, or public web presentation.

## Goal

Give operators enough visibility to diagnose the product quickly while keeping the public and subscriber surfaces simple and credible.

## Current Status

Admin diagnostics improved substantially in recent work, especially around funnel visibility and audit detail.

Current shape:

- admin is primarily an operator and diagnostic surface
- the funnel explorer is the main inspection path for candidate flow and drop reasons
- growth loops exist, but they are not the current top priority

Open posture:

- prioritize operator clarity over new dashboard breadth
- keep public/product messaging aligned with the reduced-scope MVP
- avoid letting growth work dilute retrieval-quality focus

## Code Surfaces

Start in these areas:

- `web/client/`
- `web/api/`
- `web/services/`
- `web/*.html`
- `web/style.css`

Older route wiring may still exist in `web/routes/`.

## Source Of Truth

- product contract: [`../../reduced-scope-mvp.md`](../../reduced-scope-mvp.md)
- features/backlog: [`../../features.md`](../../features.md)
- admin funnel spec: [`../../specs/admin-funnel-page.md`](../../specs/admin-funnel-page.md)
- docs index: [`../../INDEX.md`](../../INDEX.md)

## Context Guardrails

- use archived admin history only when a task depends on provenance
- prefer the current product contract over older experimentation docs
- keep UI and copy changes consistent with the email-first, 7-sector MVP
