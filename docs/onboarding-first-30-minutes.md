# First 30 Minutes

1. Install dependencies and config.

```bash
npm install
cp config.example.json config.json
```

2. Start core services.

```bash
npm run web
npm run bot
npm run worker
```

3. Run the baseline regression suite.

```bash
npm test
```

4. Trace one request end-to-end.

- Start in `web/server-runtime.js` request routing
- Follow into `web/api/core`
- Follow persistence and delivery via `src/platform/*`
- Follow digest/topic logic via `src/domains/digest`

5. Run quality harnesses when touching ranking/output behavior.

```bash
npm run qa:harness
npm run qa:matrix
```
