# Change-to-Test Map

- `src/domains/digest/*`, `src/digest/*`:
  - `npm test`
  - `npm run qa:harness`
  - `npm run qa:matrix` (for ranking/selection changes)

- `src/domains/reply/*`, `src/runtime/reply/*`, bot flow:
  - `npm test`
  - `npm run smoke:worker` (if scheduler trigger behavior changed)

- `web/api/*`, `web/server*`, `web/services/*`:
  - `npm test`
  - `npm run smoke:admin-scheduler`

- `src/platform/store/*`, `src/runtime/store*`:
  - `npm test`

- `src/platform/mailer/*`, `src/runtime/mailer*`:
  - `npm test`

- `test-harness/*`:
  - `npm test`
  - `npm run qa:matrix`
