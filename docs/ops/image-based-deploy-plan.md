# Image-Based Deploy Plan

## Goal

Move SignalBrief away from local tarball upload plus remote source builds and toward CI-built container images promoted by SHA.

## Current State

- CI already runs tests and production deploys from [`.github/workflows/ci.yml`](/Users/kushgulati/Desktop/signalbrief/.github/workflows/ci.yml).
- Production deploy still packages the repo, uploads it over `scp`, extracts it on the VM, and runs remote `docker compose build --no-cache` in [`scripts/deploy-production.js`](/Users/kushgulati/Desktop/signalbrief/scripts/deploy-production.js).
- All three runtime services share the same Dockerfile in [`Dockerfile`](/Users/kushgulati/Desktop/signalbrief/Dockerfile), so rebuilding `web`, `bot`, and `worker` separately is wasted work.

## Ideal State

- CI builds one immutable app image per commit.
- The image is pushed to GHCR tagged by full git SHA.
- Production deploy authenticates the VM to GHCR, pulls that exact image, and runs `docker compose up -d --no-build`.
- Public verification remains unchanged.

## Phase 1

- [x] Add `SIGNALBRIEF_APP_IMAGE` support to [`docker-compose.yml`](/Users/kushgulati/Desktop/signalbrief/docker-compose.yml)
- [x] Add image deploy mode to [`scripts/deploy-production.js`](/Users/kushgulati/Desktop/signalbrief/scripts/deploy-production.js)
- [x] Build and push a single image in CI
- [x] Switch CI production deploy to image mode
- [ ] Validate a full CI-driven image deploy on the next `main` push

## Follow-ups

- Add a staging image promotion path so the staging gate is based on the same image digest promoted to production.
- Replace the local `latest-staging-deploy.json` artifact with a CI-produced promotion artifact.
- Consider pinning production to image digests rather than tags for even stricter immutability.
