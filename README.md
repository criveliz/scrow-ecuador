# Escrow Ecuador — Starter

Ecuador-first escrow orchestration platform starter for development with Jules/GitHub.

## Goal
Create a transaction workflow where a buyer and seller can use an escrow-like process while an authorized financial/fiduciary provider handles custody and movement of funds according to the final legal and commercial arrangement.

## MVP flow

1. User registration
2. Identity/KYC status
3. Create escrow transaction
4. Generate payment intent/link
5. Payment provider webhook
6. Funds confirmation
7. Seller acceptance
8. Delivery evidence
9. Buyer confirmation
10. Release request
11. Fiduciary/provider execution
12. Release confirmation
13. Receipt and audit trail

## Important
This repository intentionally uses mock payment/fiduciary providers. Replace them only after the real provider contracts, APIs, webhooks, authorization model, reconciliation process, and legal structure are confirmed.

## Suggested stack
- Next.js
- NestJS
- PostgreSQL
- Redis
- TypeScript
- Docker
- GitHub Actions

## Repository map

```text
apps/
  api/          Backend placeholder
  web/          Buyer/seller web app placeholder
  admin/        Admin panel placeholder
packages/
  domain/       Domain contracts and state machine
  database/     Database schema/migrations
  providers/    Provider interfaces and mocks
  shared/       Shared types
docs/            Business and technical specification
tests/           Cross-module test plan
infrastructure/ Docker/CI placeholders
```

## First Jules instruction

Read `AGENTS.md` and every document under `docs/` before modifying code. Start by implementing the domain state machine and tests. Do not implement real money movement.
