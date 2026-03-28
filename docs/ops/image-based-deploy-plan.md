# Image-Based Deploy Plan

## Goal

Move SignalBrief away from local tarball upload plus remote source builds and toward CI-built container images promoted by SHA.

## Current State

- CI already runs tests and production deploys from [`.github/workflows/ci.yml`](/.github/workflows/ci.yml).
- Normal production deploys now resolve to a CI-built GHCR image by commit SHA in [`scripts/deploy-production.js`](/scripts/deploy-production.js).
- The tarball upload plus remote source-build path still exists, but only behind the explicit emergency fallback switch `--emergency-source-build`.
- All three runtime services share the same Dockerfile in [`Dockerfile`](/Dockerfile), so rebuilding `web`, `bot`, and `worker` separately is no longer the default path.

## Ideal State

- CI builds one immutable app image per commit.
- The image is pushed to GHCR tagged by full git SHA.
- Production deploy authenticates the VM to GHCR, pulls that exact image, and runs `docker compose up -d --no-build`.
- Public verification remains unchanged.

## Phase 1

- [x] Add `SIGNALBRIEF_APP_IMAGE` support to [`docker-compose.yml`](/docker-compose.yml)
- [x] Add image deploy mode to [`scripts/deploy-production.js`](/scripts/deploy-production.js)
- [x] Build and push a single image in CI
- [x] Switch CI production deploy to image mode
- [x] Validate a full CI-driven image deploy on the next `main` push

## Phase 2

- [x] Make image deploy the default production path, including local/operator `ops:deploy:prod`
- [x] Keep source-build deploy as an explicit emergency fallback only
- [x] Update rollback-by-SHA to deploy commit-tagged images by default
- [x] Add explicit emergency fallback scripts in [`package.json`](/package.json)

## Follow-ups

- Add a staging image promotion path so the staging gate is based on the same image digest promoted to production.
- Replace the local `latest-staging-deploy.json` artifact with a CI-produced promotion artifact.
- Consider pinning production to image digests rather than tags for even stricter immutability.
