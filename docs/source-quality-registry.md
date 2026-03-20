# Source Quality Registry

## Goal

Build a global, admin-editable source-quality registry that becomes the canonical override layer for domain quality, hard blocking, and explainability.

## Scope

### V1

- [x] Add a file-backed global source registry under the runtime data root
- [x] Add a shared effective-policy resolver with clear precedence
- [x] Enforce global hard blocks in digest selection
- [x] Add admin APIs for inspect, list, update, and reset
- [x] Add admin UI for search/edit plus suggested source review
- [x] Add audit logging for source-policy changes
- [x] Add tests for resolver precedence, enforcement, and admin endpoints
- [x] Deploy and verify in production

### V2

- Topic-specific admin overrides
- Historical what-if simulation against old digests
- Bulk import/export
- Approval workflow for risky policy changes

## Precedence

1. Per-user block/trust
2. Admin global override
3. Topic-specific override
4. Learned adjustment
5. Hardcoded default / heuristics

## Progress Notes

- Started implementation on March 20, 2026.
- Runtime source-of-truth should remain file-backed and aligned under the canonical data root.
- Runtime path resolver now includes `sourceRegistryPath`.
- Digest source classification now applies admin overrides and global hard blocks.
- Admin has a source registry inspector plus a suggested-source review table based on the last 7 days of live digest export data.
- Production deploy completed on March 20, 2026 with commit `43bd6c2`.
- Verification passed: `/` returned `200`, the landing page served `index.js?v=43bd6c2` with no raw `__ASSET_VERSION__`, and `/api/health/scheduler` returned `{"ok":true}`.
