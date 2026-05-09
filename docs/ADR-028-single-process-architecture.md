# ADR-028: Single Process Architecture

**Status:** PLANNED
**Date:** 2026-05-08
**Context:** Trade engine runs as a child process forked by the orchestrator. When the child crashes, the orchestrator may not restart it (max restart limit). When the orchestrator dies, everything dies. This caused missed pre-market scans on 8+ trading days.

## Decision

Flatten the architecture: trade engine, research worker, and Ops run in the same process as the gateway. No more `fork()`. Docker Compose handles process restart at the container level.

## Consequences

- **Positive:** One process to monitor, one thing to restart, no child-parent communication failures
- **Positive:** DO systemd/Docker restart handles crash recovery
- **Negative:** A crash in any component takes down the whole process (acceptable — Docker restarts it)
- **Negative:** Requires refactoring the worker spawn code in index.ts
