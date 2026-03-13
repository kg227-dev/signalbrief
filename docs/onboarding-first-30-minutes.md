# First 30 Minutes

Goal: boot the app, run the baseline checks, and trace one request end-to-end.

## 0-10 Minutes: Boot The System

1. Install dependencies and create local config.

```bash
npm install
cp config.example.json config.json
```

2. Start the local stack.

```bash
./start.sh
```

If you want individual processes instead:

```bash
npm run web
npm run bot
npm run worker
```

3. Sanity-check the web surface.

- Open `http://localhost:3003/`
- Open `http://localhost:3003/admin`

## 10-20 Minutes: Run Baseline Verification

```bash
npm test
npm run smoke:worker
npm run smoke:admin-scheduler
```

## 20-30 Minutes: Trace One Request

Follow this path for a typical user-facing API request:

1. Request entry:
   - `web/server.js`
   - `web/server-runtime.js`
2. Route registration:
   - `web/api/core/index.js`
3. Route handler implementation:
   - `web/routes/core-api.js`
4. Service layer:
   - `web/services/web-user-handlers.js`
   - `web/services/request-metadata.js`
5. Domain and platform boundaries:
   - `src/domains/digest/index.js`
   - `src/platform/store/index.js`
   - `src/platform/mailer/index.js`

## When You Touch Ranking, Selection, Or Output

```bash
npm run qa:harness
npm run qa:matrix
```

## Read Next

- [Documentation Index](./INDEX.md)
- [Repository Map](./repository-map.md)
- [Change-to-Test Map](./change-to-test-map.md)
- [Path and Import Rules](./contributing-path-rules.md)
