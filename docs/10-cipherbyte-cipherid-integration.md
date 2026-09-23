# 10 — CipherByte & CipherID Verification Integration Documentation

## Architecture Overview

The verification module in Escrow Ecuador provides a fully decoupled identity, person, vehicle, and company verification layer. The Escrow Core interacts exclusively with the generic `VerificationProvider` interface, ensuring that the platform's core financial and transaction state machine remains independent of CipherByte or any specific third-party provider.

```
+-----------------------------------------------------------------------+
|                              Escrow Core                              |
|                    (CoreVerificationService)                          |
+-----------------------------------------------------------------------+
                                   |
                                   v
+-----------------------------------------------------------------------+
|                         VerificationProvider                          |
|                       (Abstract Domain Interface)                     |
+-----------------------------------------------------------------------+
                                   |
                  +----------------+----------------+
                  |                                 |
                  v                                 v
+-----------------------------------+   +-------------------------------+
|  CipherByteVerificationProvider   |   |   MockVerificationProvider    |
| (packages/integrations/cipherbyte)|   |   (packages/providers/mock)   |
+-----------------------------------+   +-------------------------------+
                  |
         +--------+--------+
         |                 |
         v                 v
+-----------------+ +-----------------+
| CipherByte API  | | CipherID Webhook|
| (gateway.ec)    | | (Biometrics)    |
+-----------------+ +-----------------+
```

---

## Configuration & Secret Management

The integration uses environment variables for configuration. **Secrets, credentials, and API keys are strictly forbidden from being committed into source code or outputted in application logs.**

| Environment Variable      | Default Value                   | Description                                                    |
| ------------------------- | ------------------------------- | -------------------------------------------------------------- |
| `CIPHERBYTE_BASE_URL`     | `https://gateway.cipherbyte.ec` | Base gateway URL for CipherByte REST API                       |
| `CIPHERBYTE_API_KEY`      | _(Empty / Mock)_                | API key passed via `X-Api-Key` HTTP header                     |
| `CIPHERID_BASE_URL`       | `https://verify.cipherid.ec`    | Base URL for CipherID biometric session web view               |
| `CIPHERID_WEBHOOK_SECRET` | _(Empty / Mock)_                | Shared secret for verifying HMAC-SHA256 signatures on webhooks |

---

## Documented CipherByte Endpoints

The `CipherByteClient` strictly adheres to the officially documented endpoints provided by CipherByte:

1. `GET /api/saldo` — Queries account balance / token balance.
2. `GET /api/cedula/{cedula}` — Queries natural person identity details by Cédula (10 digits).
3. `GET /api/licencia/{cedula}` — Queries driver's license details and points by Cédula.
4. `GET /api/vehiculo/{placa}` — Queries vehicle specifications and registration status by Plate (e.g. `PBA1234`).
5. `GET /api/companias/buscar?query={query}` — Searches companies by business name or trade name.
6. `GET /api/ruc/{ruc}` — Queries company details by RUC (13 digits).

---

## Internal Domain Models

### Person Verification Result

```typescript
interface PersonVerificationResult {
  status: "VERIFIED" | "NOT_FOUND" | "FAILED";
  identification: string;
  name?: string;
  birthDate?: string;
  provider: string;
  verifiedAt: Date;
  providerReference?: string;
  rawData?: Record<string, unknown>;
}
```

### Vehicle Verification Result

```typescript
interface VehicleVerificationResult {
  status: "VERIFIED" | "NOT_FOUND" | "FAILED";
  plate: string;
  brand?: string;
  model?: string;
  color?: string;
  vehicleClass?: string;
  year?: number;
  service?: string;
  registrationDates?: Record<string, unknown>;
  tintedWindows?: boolean | string;
  provider: string;
  verifiedAt: Date;
  providerReference?: string;
  rawData?: Record<string, unknown>;
}
```

### Company Verification Result

```typescript
interface CompanyVerificationResult {
  status: "VERIFIED" | "NOT_FOUND" | "FAILED";
  ruc: string;
  companyName?: string;
  tradeName?: string;
  companyStatus?: string;
  companyType?: string;
  provider: string;
  verifiedAt: Date;
  providerReference?: string;
  rawData?: Record<string, unknown>;
}
```

### Identity Verification Session (CipherID)

```typescript
interface IdentityVerificationSession {
  verificationId?: string;
  status: "PENDING" | "COMPLETED" | "FAILED" | "EXPIRED";
  verificationUrl: string;
  expiresAt?: Date;
  providerReference?: string;
}
```

---

## Webhook Processing & Idempotency

1. **Signature Verification**: Every incoming webhook payload from CipherID is verified against `CIPHERID_WEBHOOK_SECRET` using HMAC-SHA256 signature validation. Unauthenticated requests are rejected immediately with HTTP 401.
2. **Idempotency**: Webhook events are recorded in the `webhook_events` table using the `(provider, event_id)` unique constraint. Replayed or duplicate webhooks return an idempotent `IDEMPOTENT_IGNORE` status without reprocessing or mutating database state.
3. **State Transition & Event Emission**: Once authenticated and verified as unique, the corresponding record in `verifications` is updated (`VERIFIED` or `FAILED`), and internal domain events (`IDENTITY_VERIFICATION_COMPLETED` or `IDENTITY_VERIFICATION_FAILED`) are published.

---

## Security Practices

- **API Key Redaction**: `redactSecrets()` strips API keys from log strings and error messages before writing to application logs.
- **HTTPS Enforced**: Base URLs must use HTTPS in production environments to prevent SSRF and clear-text credential transmission.
- **Timeouts & Retries**: Requests use a default 5-second timeout via `AbortController`. Automatic retries are only attempted on transient network timeouts or HTTP 5xx errors; 4xx errors (401, 403, 404) fail immediately.
- **No Biometric Storage**: Biometric documents, face scans, or raw identity images are **never stored locally** in the platform database. Only cryptographic hashes, status, and provider references are retained.
- **Input Sanitization**: Cédulas (10 numeric digits), RUCs (13 numeric digits), and Plates (3 letters + 3-4 digits, converted to uppercase) are sanitized and validated prior to external invocation.

---

## How to Swap CipherByte with Another Provider

To replace CipherByte with another verification provider (e.g. direct Civil Registry or alternative KYC vendor):

1. Create a new provider class implementing `VerificationProvider` (e.g., `NewVendorVerificationProvider`).
2. Implement `verifyPerson`, `verifyVehicle`, `verifyCompany`, and `createIdentityVerification` returning internal domain models.
3. Pass the new provider instance into `CoreVerificationService`:
   ```typescript
   const coreVerification = new CoreVerificationService(
     new NewVendorVerificationProvider(),
     verificationRepo,
     eventEmitter,
   );
   ```
   No changes to `CoreVerificationService`, domain state machine, or escrow controllers are necessary.

---

## Production Onboarding Checklist for CipherByte / CipherID

To activate live CipherID production biometrics with CipherByte, request the following details from CipherByte support:

1. **Production Gateway Credentials**: Live `X-Api-Key` and base gateway endpoint URL.
2. **CipherID Session Creation Endpoint**: Production REST endpoint URL and request payload schema for initializing biometric sessions.
3. **Webhook Signing Key**: The shared secret key (`CIPHERID_WEBHOOK_SECRET`) for HMAC-SHA256 signature verification on callbacks.
4. **Token Cost / Pricing Matrix**: Per-lookup token cost structure for credit deduction tracking in `verifications.cost_tokens`.
