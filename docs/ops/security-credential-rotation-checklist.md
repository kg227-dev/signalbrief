# Security Credential Rotation Checklist

*Last reviewed: March 20, 2026*

Date: **March 13, 2026**

## Why This Exists

Secrets were previously present in tracked config. Runtime now loads secrets from environment variables first, but exposed credentials still need real rotation at providers/admin auth.

## Required Rotations

1. Rotate Anthropic API key and update `SIGNALBRIEF_ANTHROPIC_API_KEY`.
2. Rotate Perplexity API key and update `SIGNALBRIEF_PERPLEXITY_API_KEY`.
3. Rotate Resend API key and update `SIGNALBRIEF_RESEND_API_KEY`.
4. Rotate Telegram bot token(s) and update `SIGNALBRIEF_SIGNALBRIEF_BOT_TOKEN` (and `SIGNALBRIEF_TELEGRAM_BOT_TOKEN` if used).
5. Rotate admin auth credentials:
   - generate a new salt
   - generate a new password hash from the new password + salt
   - update `SIGNALBRIEF_ADMIN_EMAIL`, `SIGNALBRIEF_ADMIN_SALT`, `SIGNALBRIEF_ADMIN_PASSWORD_HASH`
6. Set a dedicated unsubscribe signing secret:
   - update `SIGNALBRIEF_UNSUBSCRIBE_SIGNING_SECRET`
   - set retirement window for legacy links via `UNSUBSCRIBE_LEGACY_RETIRE_AFTER_UTC`

## Verification Steps

1. Run `npm test`.
2. Run `npm run smoke:worker`.
3. Run `npm run smoke:admin-scheduler`.
4. Run `npm run ops:deploy:prod`.
5. Confirm:
   - `GET /` returns `200`
   - landing HTML renders cache-busted `index.js?v=...` (no raw `__ASSET_VERSION__`)
   - `GET /api/health/scheduler` returns `{"ok":true}`

## Completion Criteria

- All provider/admin credentials above rotated and deployed from environment-backed secret storage.
- No plaintext credentials remain in tracked repository files.
