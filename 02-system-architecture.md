# 02 — System Architecture

## Logical architecture

```text
Buyer/Seller Web
       |
       v
API / Domain Layer
       |
  +----+----+----------------+
  |         |                |
Postgres   Redis        Provider Adapters
  |         |          /      |       \
  |         |      Payment  Fiduciary WhatsApp
  |         |
  +---------+---- Audit/Event/Queue
```

## Initial deployment
Use a modular monolith. Separate services only when operational scale requires it.

## Modules
- auth
- users
- kyc
- escrow
- payments
- releases
- refunds
- disputes
- evidence
- ledger
- notifications
- webhooks
- providers
- risk
- audit
- admin

## Trust boundaries
1. Browser is untrusted.
2. Provider webhook is untrusted until verified.
3. Provider API responses must be validated.
4. Admin actions require authorization and audit logging.
5. Financial state is controlled by the backend/domain layer.

## Provider adapter principle
Use interfaces such as:

```ts
interface PaymentProvider {
  createPaymentIntent(input: CreatePaymentInput): Promise<PaymentIntent>;
  verifyWebhook(input: VerifyWebhookInput): Promise<VerifiedWebhook>;
}

interface FiduciaryProvider {
  verifyIncomingFunds(input: VerifyFundsInput): Promise<FundsVerification>;
  requestRelease(input: ReleaseInput): Promise<ProviderOperation>;
  requestRefund(input: RefundInput): Promise<ProviderOperation>;
  getOperationStatus(providerReference: string): Promise<ProviderOperation>;
}
```

The real implementation must be added only after provider documentation and contract details are verified.
