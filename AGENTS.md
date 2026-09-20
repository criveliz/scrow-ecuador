# Escrow Ecuador — AGENTS.md

## Mission
Build a secure Ecuador-focused escrow transaction platform. The platform orchestrates transactions, evidence, state transitions, notifications, auditability, and integrations. It must not assume that the platform itself is legally authorized to custody customer funds.

## Architecture
- Monorepo-ready structure
- Frontend: Next.js + TypeScript (planned)
- Backend: NestJS + TypeScript (planned)
- Database: PostgreSQL
- Cache/queues: Redis
- Development: Docker Compose
- Provider integrations behind typed adapters

## Critical financial rules
1. Never change balances directly from frontend input.
2. Never release funds solely because of a frontend request.
3. Never trust a payment webhook without signature verification.
4. All payment/release/refund operations must be idempotent.
5. All financial state transitions must be validated in the domain layer.
6. Financial events and privileged actions must be auditable.
7. Never store raw card data.
8. Never expose provider secrets to frontend code.
9. Never assume a fiduciary/bank API exists until confirmed by the provider.
10. Use mock providers in development and tests.

## Escrow states
CREATED
AWAITING_PAYMENT
PAYMENT_RECEIVED
FUNDS_CONFIRMED
SELLER_ACCEPTED
DELIVERY_PENDING
DELIVERED
BUYER_CONFIRMED
RELEASE_PENDING
RELEASED
DISPUTED
REFUNDED
EXPIRED
CANCELLED

## Engineering
- TypeScript strict mode.
- Prefer a modular monolith before microservices.
- Validate all external input.
- Use RBAC.
- MFA is required for privileged production access.
- Use UTC internally; display Ecuador local time at the UI layer.
- Use decimal-safe money representations; never use binary floating point for money.
- Add unit/integration tests for every financial transition.
- Do not merge code with failing tests.

## Security
- HTTPS in production.
- Secret manager in production.
- Rate limiting.
- Webhook signature verification.
- Idempotency keys.
- Immutable audit trail.
- Least-privilege database/provider credentials.
- Encrypt sensitive data at rest where appropriate.

## Product principle
The source of truth is the platform database + ledger + verified provider events, not WhatsApp, email, or browser state.
