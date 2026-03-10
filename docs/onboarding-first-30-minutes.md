# First 30 Minutes

Goal: run the app, run core tests, and trace one request end-to-end.

## 0-10 Minutes: Boot the System

1. Install dependencies and create config.

```bash
npm install
cp config.example.json config.json
```

2. Start services (3 terminals), or use `./start.sh`.

```bash
npm run web
npm run bot
npm run worker
```

3. Check that the web process starts cleanly.

- Open `http://localhost:3003/`
- Open `http://localhost:3003/admin`

## 10-20 Minutes: Run Baseline Verification

Run the critical regression suite:

```bash
npm test
```

Run operational smokes:

```bash
npm run smoke:worker
npm run smoke:admin-scheduler
```

## 20-30 Minutes: Trace One Request

Trace this path for a core API request:

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

## When You Touch Ranking/Selection/Output

Run quality checks after code changes in digest selection, scoring, or output formatting:

```bash
npm run qa:harness
npm run qa:matrix
```

## What to Read Next

- [Repository Map](./repository-map.md)
- [Change-to-Test Map](./change-to-test-map.md)
- [Path and Import Rules](./contributing-path-rules.md)
