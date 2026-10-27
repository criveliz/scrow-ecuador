# 08 — Jules Task Prompts

Run these tasks sequentially. Jules must read AGENTS.md and docs first.

## Task 1 — Repository foundation

Create the TypeScript monorepo structure, development tooling, Docker Compose, linting, formatting and test runner. Do not implement real financial integrations.

## Task 2 — Domain state machine

Implement the escrow state machine from docs/03-escrow-state-machine.md. Add exhaustive tests for valid and invalid transitions.

## Task 3 — Database

Implement migrations/models corresponding to packages/database/schema.sql. Add repository interfaces and integration tests.

## Task 4 — Authentication

Implement registration/login/refresh and RBAC. Add authorization tests.

## Task 5 — Escrow API

Implement create/get/timeline and controlled business actions. Never expose arbitrary status updates.

## Task 6 — Payment provider

Implement provider interfaces and mock payment provider. Add idempotency support.

## Task 7 — Kushki webhook

Implement a production-ready adapter boundary for Kushki webhook verification, event persistence, duplicate detection and asynchronous processing. Use official Kushki documentation as the source of truth and do not invent fields.

## Task 8 — Fiduciary adapter

Implement the fiduciary provider interface and mock provider. Do not claim that real provider capabilities exist until verified.

## Task 9 — Ledger

Implement immutable ledger transactions and entries with database transactions and idempotency.

## Task 10 — Disputes/evidence

Implement dispute opening, evidence metadata, resolution workflow and audit logs.

## Task 11 — Web apps

Create buyer/seller screens for transaction creation, payment status, delivery evidence, confirmation and disputes.

## Task 12 — Admin

Create admin dashboard for operations, disputes, audit logs and provider events. Add RBAC and privileged-action audit logging.

## Task 13 — Notifications

Create notification abstraction for email/SMS/WhatsApp. WhatsApp is communication only, never the financial source of truth.

## Task 14 — Hardening

Run security review, concurrency tests, idempotency tests, webhook replay tests, authorization tests and failure-mode tests.
