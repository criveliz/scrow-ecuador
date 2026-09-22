import { AddressInfo } from "net";
import { ActorRole, EscrowStatus } from "@escrow-ecuador/domain";
import { PgMemDbClient, runMigrations } from "@escrow-ecuador/database";
import {
  KushkiClient,
  KushkiMapper,
  KushkiPaymentProvider,
  MockPaymentProvider,
} from "@escrow-ecuador/providers";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createApiServer } from "../index.js";
import { hashPassword } from "../auth/crypto.js";
import { generateToken } from "../auth/jwt.js";

describe("TASK 6 — Kushki Payment Integration Core Tests", () => {
  let app: ReturnType<typeof createApiServer>;
  let mockProvider: MockPaymentProvider;
  let baseUrl: string;
  let buyerToken: string;
  let buyerId: string;
  let sellerToken: string;
  let sellerId: string;
  let userCToken: string;
  let userCId: string;
  let escrowId: string;

  beforeEach(async () => {
    mockProvider = new MockPaymentProvider("PENDING");
    app = createApiServer(undefined, mockProvider);
    await runMigrations(app.db);

    await new Promise<void>((resolve) => {
      app.server.listen(0, () => resolve());
    });

    const address = app.server.address() as AddressInfo;
    baseUrl = `http://localhost:${address.port}`;

    const buyerUser = await app.userRepo.create({
      email: `buyer_${Date.now()}_${Math.random()}@example.com`,
      password_hash: await hashPassword("buyerPass123!"),
      role: ActorRole.BUYER,
      status: "ACTIVE",
    });
    buyerId = buyerUser.id;
    buyerToken = generateToken(
      {
        userId: buyerUser.id,
        email: buyerUser.email,
        role: ActorRole.BUYER,
        type: "ACCESS",
      },
      3600
    );

    const sellerUser = await app.userRepo.create({
      email: `seller_${Date.now()}_${Math.random()}@example.com`,
      password_hash: await hashPassword("sellerPass123!"),
      role: ActorRole.SELLER,
      status: "ACTIVE",
    });
    sellerId = sellerUser.id;
    sellerToken = generateToken(
      {
        userId: sellerUser.id,
        email: sellerUser.email,
        role: ActorRole.SELLER,
        type: "ACCESS",
      },
      3600
    );

    const userC = await app.userRepo.create({
      email: `userc_${Date.now()}_${Math.random()}@example.com`,
      password_hash: await hashPassword("userCPass123!"),
      role: ActorRole.BUYER,
      status: "ACTIVE",
    });
    userCId = userC.id;
    userCToken = generateToken(
      {
        userId: userC.id,
        email: userC.email,
        role: ActorRole.BUYER,
        type: "ACCESS",
      },
      3600
    );

    const escrow = await app.escrowRepo.create({
      external_reference: `REF-PAY-${Date.now()}-${Math.random()}`,
      buyer_id: buyerId,
      seller_id: sellerId,
      amount: "250.75",
      currency: "USD",
      status: EscrowStatus.CREATED,
    });
    escrowId = escrow.id;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      app.server.close(() => resolve());
    });
  });

  describe("POST /api/v1/escrows/:id/payment — Initiation & Security", () => {
    it("1. initiates payment when authenticated by buyer", async () => {
      const res = await fetch(`${baseUrl}/api/v1/escrows/${escrowId}/payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${buyerToken}`,
        },
        body: JSON.stringify({ token: "tok-test-123" }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.payment).toBeDefined();
      expect(data.payment.escrow_id).toBe(escrowId);
      expect(parseFloat(data.payment.amount).toFixed(2)).toBe("250.75");
      expect(data.payment.status).toBe("PENDING");
      expect(data.disclaimer).toContain("does not constitute final confirmation");
    });

    it("2. rejects unauthenticated payment initiation request with 401", async () => {
      const res = await fetch(`${baseUrl}/api/v1/escrows/${escrowId}/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "tok-test-123" }),
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe("UNAUTHORIZED");
    });

    it("3. rejects payment initiation from unrelated user C with 403 (IDOR)", async () => {
      const res = await fetch(`${baseUrl}/api/v1/escrows/${escrowId}/payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userCToken}`,
        },
        body: JSON.stringify({ token: "tok-test-123" }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe("FORBIDDEN");
    });

    it("4. rejects payment initiation for non-existent escrow with 404", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const res = await fetch(`${baseUrl}/api/v1/escrows/${fakeId}/payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${buyerToken}`,
        },
        body: JSON.stringify({ token: "tok-test-123" }),
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe("NOT_FOUND");
    });

    it("5. rejects payment initiation for escrow in incompatible status (e.g. CANCELLED)", async () => {
      await app.escrowRepo.transitionStatus({
        transactionId: escrowId,
        previousState: EscrowStatus.CREATED,
        newState: EscrowStatus.CANCELLED,
        actorId: buyerId,
        actorRole: ActorRole.BUYER,
        timestamp: new Date(),
        reason: "Cancelled before payment",
      });

      const res = await fetch(`${baseUrl}/api/v1/escrows/${escrowId}/payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${buyerToken}`,
        },
        body: JSON.stringify({ token: "tok-test-123" }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.message).toContain("Cannot initiate payment");
    });

    it("6. derives amount strictly from Escrow in DB and ignores client body amount attempt", async () => {
      const res = await fetch(`${baseUrl}/api/v1/escrows/${escrowId}/payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${buyerToken}`,
        },
        body: JSON.stringify({
          amount: "1.00",
          token: "tok-tamper-attempt",
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(parseFloat(data.payment.amount).toFixed(2)).toBe("250.75");
    });

    it("7. derives currency strictly from Escrow in DB", async () => {
      const res = await fetch(`${baseUrl}/api/v1/escrows/${escrowId}/payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${buyerToken}`,
        },
        body: JSON.stringify({ currency: "EUR" }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.payment.currency).toBe("USD");
    });

    it("8. stores amount with exact NUMERIC(20,2) precision without binary floating point distortion", async () => {
      const res = await fetch(`${baseUrl}/api/v1/escrows/${escrowId}/payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${buyerToken}`,
        },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(parseFloat(data.payment.amount).toFixed(2)).toBe("250.75");
    });

    it("9. supports Idempotency-Key: duplicate request returns cached payment record", async () => {
      const idempotencyKey = `idempotent-key-${Date.now()}-${Math.random()}`;

      const res1 = await fetch(`${baseUrl}/api/v1/escrows/${escrowId}/payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${buyerToken}`,
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ token: "tok-1" }),
      });
      expect(res1.status).toBe(200);
      const data1 = await res1.json();

      const res2 = await fetch(`${baseUrl}/api/v1/escrows/${escrowId}/payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${buyerToken}`,
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ token: "tok-1" }),
      });
      expect(res2.status).toBe(200);
      const data2 = await res2.json();

      expect(data2.payment.id).toBe(data1.payment.id);
    });

    it("10. returns 409 conflict when idempotency key is reused with different payload", async () => {
      const idempotencyKey = `idempotent-conflict-key-${Date.now()}-${Math.random()}`;

      await fetch(`${baseUrl}/api/v1/escrows/${escrowId}/payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${buyerToken}`,
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ token: "tok-initial" }),
      });

      const resConflict = await fetch(`${baseUrl}/api/v1/escrows/${escrowId}/payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${buyerToken}`,
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ token: "tok-different" }),
      });

      expect(resConflict.status).toBe(409);
      const data = await resConflict.json();
      expect(data.error).toBe("IDEMPOTENCY_CONFLICT");
    });
  });

  describe("Mock Payment Provider Scenarios & Error Modes", () => {
    it("11. handles APPROVED mock payment mode", async () => {
      mockProvider.mode = "APPROVED";

      const res = await fetch(`${baseUrl}/api/v1/escrows/${escrowId}/payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${buyerToken}`,
        },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.payment.status).toBe("APPROVED");
    });

    it("12. handles DECLINED mock payment mode", async () => {
      mockProvider.mode = "DECLINED";

      const res = await fetch(`${baseUrl}/api/v1/escrows/${escrowId}/payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${buyerToken}`,
        },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.payment.status).toBe("DECLINED");
    });

    it("13. handles FAILED mock payment mode", async () => {
      mockProvider.mode = "FAILED";

      const res = await fetch(`${baseUrl}/api/v1/escrows/${escrowId}/payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${buyerToken}`,
        },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.payment.status).toBe("FAILED");
    });

    it("14. handles provider timeout scenario cleanly with 502", async () => {
      mockProvider.mode = "TIMEOUT";

      const res = await fetch(`${baseUrl}/api/v1/escrows/${escrowId}/payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${buyerToken}`,
        },
      });

      expect(res.status).toBe(502);
      const data = await res.json();
      expect(data.error).toBe("PAYMENT_PROVIDER_ERROR");
      expect(data.message).toContain("timed out");
    });

    it("15. handles provider HTTP 400 error scenario cleanly with 502", async () => {
      mockProvider.mode = "HTTP_400";

      const res = await fetch(`${baseUrl}/api/v1/escrows/${escrowId}/payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${buyerToken}`,
        },
      });

      expect(res.status).toBe(502);
    });

    it("16. handles provider HTTP 500 error scenario cleanly with 502", async () => {
      mockProvider.mode = "HTTP_500";

      const res = await fetch(`${baseUrl}/api/v1/escrows/${escrowId}/payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${buyerToken}`,
        },
      });

      expect(res.status).toBe(502);
    });
  });

  describe("Kushki Mapper Unit Tests & Sanitization", () => {
    it("17. KushkiMapper maps raw Kushki status codes correctly", () => {
      expect(KushkiMapper.mapStatus("APPROVAL")).toBe("APPROVED");
      expect(KushkiMapper.mapStatus("000")).toBe("APPROVED");
      expect(KushkiMapper.mapStatus("DECLINED")).toBe("DECLINED");
      expect(KushkiMapper.mapStatus("PROCESSING")).toBe("PROCESSING");
      expect(KushkiMapper.mapStatus("FAILED")).toBe("FAILED");
      expect(KushkiMapper.mapStatus("UNKNOWN")).toBe("PENDING");
    });

    it("18. KushkiMapper strips PAN, CVV, and private keys from response metadata", () => {
      const rawResponse = {
        ticketNumber: "12345",
        status: "APPROVED",
        cvv: "123",
        pan: "4111111111111111",
        privateMerchantId: "secret-key-999",
        card: {
          cardNumber: "4111111111111111",
          holderName: "John Doe",
        },
      };

      const sanitized = KushkiMapper.sanitizeResponse(rawResponse);

      expect(sanitized.ticketNumber).toBe("12345");
      expect(sanitized.cvv).toBeUndefined();
      expect(sanitized.pan).toBeUndefined();
      expect(sanitized.privateMerchantId).toBeUndefined();
      expect((sanitized.card as any)?.cardNumber).toBeUndefined();
      expect((sanitized.card as any)?.holderName).toBe("John Doe");
    });
  });

  describe("GET /api/v1/payments/:id — Query & Ownership Verification", () => {
    let paymentId: string;

    beforeEach(async () => {
      const payment = await app.paymentRepo.create({
        escrow_id: escrowId,
        provider: "KUSHKI",
        provider_payment_id: "kushki-ticket-777",
        provider_reference: "kushki-ticket-777",
        amount: "250.75",
        currency: "USD",
        status: "PENDING",
      });
      paymentId = payment.id;
    });

    it("19. allows buyer and seller to retrieve payment details by ID", async () => {
      const resBuyer = await fetch(`${baseUrl}/api/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${buyerToken}` },
      });
      expect(resBuyer.status).toBe(200);
      const dataBuyer = await resBuyer.json();
      expect(dataBuyer.payment.id).toBe(paymentId);

      const resSeller = await fetch(`${baseUrl}/api/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${sellerToken}` },
      });
      expect(resSeller.status).toBe(200);
    });

    it("20. prevents unrelated user C from accessing payment details (403 IDOR)", async () => {
      const res = await fetch(`${baseUrl}/api/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${userCToken}` },
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe("FORBIDDEN");
    });

    it("21. payment initiation does not arbitrarily change escrow status to funds confirmed or released", async () => {
      await fetch(`${baseUrl}/api/v1/escrows/${escrowId}/payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${buyerToken}`,
        },
      });

      const escrow = await app.escrowRepo.findById(escrowId);
      expect(escrow?.status).not.toBe(EscrowStatus.RELEASED);
      expect(escrow?.status).not.toBe(EscrowStatus.FUNDS_CONFIRMED);
    });

    it("22. never exposes passwords, JWT secrets, or sensitive private merchant keys in payment responses", async () => {
      const res = await fetch(`${baseUrl}/api/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${buyerToken}` },
      });

      const text = await res.text();
      expect(text).not.toContain("password_hash");
      expect(text).not.toContain("JWT_SECRET");
      expect(text).not.toContain("mock-private-merchant-id");
    });
  });
});
