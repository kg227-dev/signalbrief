# Week 6 Day 30 - Infrastructure Decision Memo

Date: **March 13, 2026**

## Decision

**Stay on a hardened single VM for the next quarter** and defer managed-platform migration for now.

Rationale:

- current pain was mostly release safety and recovery, not compute saturation
- Day 26-29 now provide practical guardrails (release windows, canary gating, rollback-by-SHA)
- immediate ROI is higher from code quality/security fixes than infra migration work

## What This Decision Is Not

- It is **not** a claim that current architecture is ideal.
- It is **not** a long-term endorsement of single-VM ops.
- It is a short-horizon cost/benefit call while debt burn-down continues.

## Managed-Platform Migration Triggers

Any one of these sustained triggers should force migration planning immediately.

### Trigger Group A - Reliability

- 2+ Sev1/Sev2 production incidents in 30 days caused by host/process orchestration limits
- rollback-by-SHA recovery repeatedly exceeds 10 minutes
- scheduler health endpoint instability exceeds 1% failed checks over 7 days

### Trigger Group B - Scale / Throughput

- sustained digest workload where deploy/restart windows materially disrupt delivery SLA
- queueing/backlog emerges that cannot be solved without horizontal scaling
- persistent CPU/memory pressure on VM despite optimization and right-sizing

### Trigger Group C - Engineering Throughput

- >4 engineer-hours/week spent on VM/process babysitting for two consecutive weeks
- release cadence blocked by manual coordination overhead that automation cannot reduce
- inability to meet planned release windows because environment isolation is insufficient

### Trigger Group D - Compliance / Security

- required controls (secrets rotation/isolation/auditability) cannot be met on current VM model
- policy/customer requirements demand stronger environment isolation and managed controls

## Exit Conditions To Stay On VM (Quarterly Re-check)

We continue on the hardened VM only if all are true:

1. no trigger group above is breached
2. `qa:harness` reaches and sustains `>=75`
3. security carry-forward items P1-P3 are closed
4. rollback drill continues to pass with <10-minute recovery

## Planned VM-Hardening Continuation (Short Horizon)

1. complete security carry-forward fixes (secrets/CORS/unsubscribe)
2. finish digest orchestrator decomposition and reduce coupling hotspots
3. improve behavioral test coverage and recover `qa:harness` score
4. verify main-branch protection and required CI gate enforcement

## Migration Pre-Work (Do In Parallel, Low Cost)

Even while staying on VM, keep migration-ready artifacts current:

- container/runtime parity checklist
- state migration runbooks and rollback playbooks
- baseline cost/perf snapshots for objective migration ROI decisions

## Review Cadence

- Re-evaluate this decision every 30 days.
- Re-evaluate immediately if any trigger is breached.

