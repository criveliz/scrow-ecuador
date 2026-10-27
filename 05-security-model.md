# 05 — Security Model

## Authentication

- Email/phone authentication
- Secure password hashing if passwords are used
- Refresh token rotation
- MFA for admins

## Authorization

RBAC:

- BUYER
- SELLER
- SUPPORT
- ADMIN
- SUPER_ADMIN

## Data protection

- TLS
- Secrets outside source control
- Encryption for sensitive fields where appropriate
- Data minimization
- Retention policy
- Access logging

## Webhooks

For every provider webhook:

1. Receive request.
2. Verify signature.
3. Validate timestamp/replay window if supported.
4. Persist event ID.
5. Reject duplicates.
6. Process asynchronously.
7. Reconcile provider state with internal state.
8. Audit result.

## Financial integrity

- Decimal money representation
- Immutable ledger entries
- Database transactions
- Idempotency keys
- Concurrency controls
- Reconciliation jobs

## Incident response

Log:

- request ID
- actor
- operation ID
- provider reference
- event ID
- timestamp
- result
- failure reason
