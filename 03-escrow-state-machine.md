# 03 — Escrow State Machine

## States

```text
CREATED
  -> AWAITING_PAYMENT
  -> PAYMENT_RECEIVED
  -> FUNDS_CONFIRMED
  -> SELLER_ACCEPTED
  -> DELIVERY_PENDING
  -> DELIVERED
  -> BUYER_CONFIRMED
  -> RELEASE_PENDING
  -> RELEASED
```

Alternative paths:

- AWAITING_PAYMENT -> EXPIRED
- PAYMENT_RECEIVED -> DISPUTED
- FUNDS_CONFIRMED -> DISPUTED
- DELIVERY_PENDING -> DISPUTED
- DELIVERED -> DISPUTED
- DISPUTED -> REFUNDED
- DISPUTED -> RELEASE_PENDING
- CREATED -> CANCELLED

## Rules

- No direct arbitrary status updates.
- Every transition has an actor, event, timestamp, previous state, new state, and metadata.
- A dispute prevents automatic release until resolved.
- Release must be idempotent.
- Refund must be idempotent.
