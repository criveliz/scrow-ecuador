# 04 — Financial Integrations

## Payment provider

Kushki is the planned payment provider for the first implementation, subject to final technical and commercial confirmation.

Required integration capabilities:

- payment initiation
- transaction lookup
- webhook reception
- webhook signature verification
- idempotency/reconciliation
- error handling

## Fiduciary/bank provider

The fiduciary adapter is intentionally abstract.

Required capabilities to validate with the chosen provider:

- incoming credit notification
- reconciliation/reference matching
- balance/operation status
- release instruction
- refund instruction
- confirmation callback/webhook or equivalent
- authentication and authorization
- limits and settlement windows

## Development

Use mock providers. Never simulate real custody by pretending that a local database balance is actual customer money.
