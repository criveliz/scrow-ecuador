1. **Database Migration (`packages/database/schema/006_kushki_payments.sql`)**
   - Create enums `payment_gateway` ('KUSHKI'), `payment_status` ('INITIALIZED', 'PENDING_CHALLENGE', 'PROCESSING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'VOIDED'), `payment_method_type` ('CREDIT_CARD', 'DEBIT_CARD', 'TRANSFER').
   - Create `payment_transactions` table referencing `escrow_transactions(id)` with `amount_cents` (BIGINT), `kushki_ticket_number` (VARCHAR UNIQUE), `idempotency_key` (VARCHAR UNIQUE), 3DS tracking columns, and `raw_response` (JSONB).
   - Read the newly created `packages/database/schema/006_kushki_payments.sql` file to confirm it is formatted correctly.

2. **Kushki Adapter Package Setup - Scaffold files (`packages/kushki-adapter`)**
   - Create package directories.
   - Initialize `package.json`, `tsconfig.json`, `index.ts`.

3. **Kushki Adapter Package Setup - `KushkiClient`**
   - Create and implement `packages/kushki-adapter/src/client.ts`.
   - Supports UAT (`https://api-uat.kushkipagos.com`) and Production (`https://api.kushkipagos.com`) environments.
   - Injects `Private-Merchant-Id` and `X-Idempotency-Key` headers.
   - Implement `AbortController` for a 15-second timeout.
   - Support methods for `POST /card/v1/charges` and `POST /transfer/v1/init`.

4. **Kushki Adapter Package Setup - `KushkiPaymentService`**
   - Create and implement `packages/kushki-adapter/src/service.ts`.
   - Validates escrow state (`AWAITING_PAYMENT`).
   - Verifies amount matching (converting from NUMERIC(20,2) to BIGINT cents correctly).
   - Safely converts `BigInt` cents into Kushki format without precision loss.
   - Inserts record into `payment_transactions` (requires writing a quick query using db.ts).
   - Detects 3DS redirect requirements (`REQUIRES_ACTION` / `acsURL`) and flags transaction as `PENDING_CHALLENGE`.

5. **Expose Payment Route (`apps/api/src/routes/payment.ts`)**
   - Since `apps/api` is currently empty/scaffolded, create `apps/api/src/routes/payment.ts`.
   - Add endpoint `POST /api/v1/escrows/:id/pay/card`.
   - Stub/mock `authenticateJwt` middleware (e.g. `req.user = { id: ... }`).
   - Verify caller is `buyer_id`.
   - Use `KushkiPaymentService.processCardCharge`.
   - Return `{ paymentId, ticketNumber, status, actionUrl }`.

6. **Test Suite (`packages/kushki-adapter/test/kushki.spec.ts`)**
   - Create and write tests in `packages/kushki-adapter/test/kushki.spec.ts`.
   - Mock fetch calls to simulate success (`APPROVAL`), rejection (`REJECT`), and 3DS challenge (`REQUIRES_ACTION`).
   - Test idempotency (repeated executions with same key).
   - Test invariant protection (already funded, etc. return 409).
   - Run tests (`npm test`) to ensure everything passes and no regressions occur.

7. **Pre Commit Steps**
   - Ensure proper testing, verification, review, and reflection are done.
