import {
  EscrowRepository,
  PgMemDbClient,
  runMigrations,
  UserRepository,
  VerificationRepository,
  WebhookEventRepository,
} from "@escrow-ecuador/database";
import {
  ActorRole,
  CoreVerificationService,
  EscrowStatus,
  VerificationEventEmitter,
  VerificationEventType,
  VerificationStatus,
} from "@escrow-ecuador/domain";
import { MockVerificationProvider } from "@escrow-ecuador/providers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { CipherByteCache } from "./cache.js";
import { CipherByteClient, redactSecrets, sanitizeCedula } from "./client.js";
import { CipherIdService } from "./cipherid.service.js";
import {
  CipherByteAuthError,
  CipherByteInvalidResponseError,
  CipherByteNotFoundError,
  CipherByteRateLimitError,
  CipherByteServerError,
  CipherByteTimeoutError,
  InvalidInputValidationError,
} from "./errors.js";
import { CipherByteVerificationProvider } from "./verification.service.js";
import { CipherIdWebhookController } from "./webhook.controller.js";

describe("CipherByte & CipherID Verification Integration Suite", () => {
  const db = new PgMemDbClient();
  const userRepo = new UserRepository(db);
  const escrowRepo = new EscrowRepository(db);
  const verificationRepo = new VerificationRepository(db);
  const webhookRepo = new WebhookEventRepository(db);

  beforeAll(async () => {
    await runMigrations(db);
  });

  it("1. Persona verificada: retrieves person by valid Cédula", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        cedula: "1712345678",
        nombre: "MARIA FERNANDA LOPEZ",
        fechaNacimiento: "1992-10-20",
      }),
    });

    const client = new CipherByteClient(
      { apiKey: "test-key" },
      mockFetch as unknown as typeof fetch,
    );
    const provider = new CipherByteVerificationProvider(client);

    const result = await provider.verifyPerson({ cedula: "1712345678" });
    expect(result.status).toBe(VerificationStatus.VERIFIED);
    expect(result.identification).toBe("1712345678");
    expect(result.name).toBe("MARIA FERNANDA LOPEZ");
    expect(result.provider).toBe("CIPHERBYTE");
  });

  it("2. Persona no encontrada: handles 404 response gracefully", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "Not found" }),
    });

    const client = new CipherByteClient(
      { apiKey: "test-key" },
      mockFetch as unknown as typeof fetch,
    );
    const provider = new CipherByteVerificationProvider(client);

    const result = await provider.verifyPerson({ cedula: "0000000000" });
    expect(result.status).toBe(VerificationStatus.NOT_FOUND);
    expect(result.identification).toBe("0000000000");
  });

  it("3. Cédula inválida: rejects invalid Cédula inputs before network call", async () => {
    const mockFetch = vi.fn();
    const client = new CipherByteClient(
      { apiKey: "test-key" },
      mockFetch as unknown as typeof fetch,
    );

    await expect(client.getCedula("12345")).rejects.toThrow(
      InvalidInputValidationError,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("4. Vehículo encontrado: retrieves vehicle specs by plate", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        placa: "PBA1234",
        marca: "CHEVROLET",
        modelo: "SAIL",
        color: "ROJO",
        anio: 2021,
      }),
    });

    const client = new CipherByteClient(
      { apiKey: "test-key" },
      mockFetch as unknown as typeof fetch,
    );
    const provider = new CipherByteVerificationProvider(client);

    const result = await provider.verifyVehicle({ plate: "PBA1234" });
    expect(result.status).toBe(VerificationStatus.VERIFIED);
    expect(result.plate).toBe("PBA1234");
    expect(result.brand).toBe("CHEVROLET");
    expect(result.year).toBe(2021);
  });

  it("5. Vehículo no encontrado: handles non-existent vehicle plate", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    const client = new CipherByteClient(
      { apiKey: "test-key" },
      mockFetch as unknown as typeof fetch,
    );
    const provider = new CipherByteVerificationProvider(client);

    const result = await provider.verifyVehicle({ plate: "ZZZ0000" });
    expect(result.status).toBe(VerificationStatus.NOT_FOUND);
    expect(result.plate).toBe("ZZZ0000");
  });

  it("6. RUC encontrado: retrieves company profile by RUC", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ruc: "1792345678001",
        razonsocial: "EMPRESA DE PRUEBA C.A.",
        estado: "ACTIVO",
      }),
    });

    const client = new CipherByteClient(
      { apiKey: "test-key" },
      mockFetch as unknown as typeof fetch,
    );
    const provider = new CipherByteVerificationProvider(client);

    const result = await provider.verifyCompany({ ruc: "1792345678001" });
    expect(result.status).toBe(VerificationStatus.VERIFIED);
    expect(result.ruc).toBe("1792345678001");
    expect(result.companyName).toBe("EMPRESA DE PRUEBA C.A.");
  });

  it("7. Error 401: handles unauthorized API key response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    });

    const client = new CipherByteClient(
      { apiKey: "bad-key", maxRetries: 0 },
      mockFetch as unknown as typeof fetch,
    );
    await expect(client.getSaldo()).rejects.toThrow(CipherByteAuthError);
  });

  it("8. Error 403: handles forbidden access response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
    });

    const client = new CipherByteClient(
      { apiKey: "forbidden-key", maxRetries: 0 },
      mockFetch as unknown as typeof fetch,
    );
    await expect(client.getCedula("1712345678")).rejects.toThrow(
      CipherByteAuthError,
    );
  });

  it("9. Error 429: handles rate limiting response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
    });

    const client = new CipherByteClient(
      { apiKey: "test-key", maxRetries: 0 },
      mockFetch as unknown as typeof fetch,
    );
    await expect(client.getCedula("1712345678")).rejects.toThrow(
      CipherByteRateLimitError,
    );
  });

  it("10. Timeout: handles request timeout with AbortController", async () => {
    const mockFetch = vi.fn().mockImplementation(() => {
      return new Promise((_, reject) => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        setTimeout(() => reject(err), 10);
      });
    });

    const client = new CipherByteClient(
      { apiKey: "test-key", timeoutMs: 5, maxRetries: 0 },
      mockFetch as unknown as typeof fetch,
    );
    await expect(client.getCedula("1712345678")).rejects.toThrow(
      CipherByteTimeoutError,
    );
  });

  it("11. Error 5xx: retries safe GET requests on server error", async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, status: 500 };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ cedula: "1712345678", nombre: "RETRY SUCCESS" }),
      };
    });

    const client = new CipherByteClient(
      { apiKey: "test-key", maxRetries: 1 },
      mockFetch as unknown as typeof fetch,
    );
    const data = await client.getCedula("1712345678");

    expect(callCount).toBe(2);
    expect(data.nombre).toBe("RETRY SUCCESS");
  });

  it("12. Respuesta inválida: throws CipherByteInvalidResponseError on malformed JSON", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("Invalid JSON");
      },
    });

    const client = new CipherByteClient(
      { apiKey: "test-key", maxRetries: 0 },
      mockFetch as unknown as typeof fetch,
    );
    await expect(client.getCedula("1712345678")).rejects.toThrow(
      CipherByteInvalidResponseError,
    );
  });

  it("13. API key nunca aparece en logs: redacts secrets from log output", () => {
    const apiKey = "secret_cb_key_999";
    const logMessage = `Sending request with X-Api-Key: ${apiKey} to https://gateway.cipherbyte.ec`;

    const redacted = redactSecrets(logMessage, [apiKey]);
    expect(redacted).not.toContain("secret_cb_key_999");
    expect(redacted).toContain("[REDACTED]");
  });

  it("14 & 16. Webhook duplicado & Cambio correcto del estado de verificación: handles CipherID webhook idempotency and status transitions", async () => {
    const user = await userRepo.create({
      email: "buyer_vh@example.com",
      password_hash: "hash",
      role: ActorRole.BUYER,
      status: "ACTIVE",
    });

    const escrow = await escrowRepo.create({
      external_reference: "ESC-VH-001",
      buyer_id: user.id,
      seller_id: user.id,
      amount: "100.00",
      currency: "USD",
      status: EscrowStatus.CREATED,
    });

    const verificationRecord = await verificationRepo.create({
      escrow_id: escrow.id,
      party_id: user.id,
      provider: "CIPHERID",
      verification_type: "IDENTITY",
      status: VerificationStatus.PENDING,
      provider_reference: "cid_sess_test_100",
    });

    const eventEmitter = new VerificationEventEmitter();
    let emittedEvent: any = null;
    eventEmitter.on(
      VerificationEventType.IDENTITY_VERIFICATION_COMPLETED,
      (evt) => {
        emittedEvent = evt;
      },
    );

    const cipherIdService = new CipherIdService({
      webhookSecret: "secret-key",
    });
    const webhookController = new CipherIdWebhookController(
      cipherIdService,
      verificationRepo,
      webhookRepo,
      eventEmitter,
    );

    const payload = {
      eventId: "evt_cid_001",
      eventType: "identity.verification.updated",
      providerReference: "cid_sess_test_100",
      status: "VERIFIED" as const,
      verifiedAt: new Date().toISOString(),
    };

    // Calculate valid HMAC-SHA256 signature
    const crypto = await import("crypto");
    const rawBody = JSON.stringify(payload);
    const signature = crypto
      .createHmac("sha256", "secret-key")
      .update(rawBody)
      .digest("hex");

    // First processing
    const firstResult = await webhookController.handleWebhook({
      rawBody,
      signatureHeader: signature,
      payload,
    });

    expect(firstResult.status).toBe("PROCESSED");
    expect(firstResult.processed).toBe(true);
    expect(emittedEvent).not.toBeNull();
    expect(emittedEvent.verificationId).toBe(verificationRecord.id);

    // Verify DB updated
    const updated = await verificationRepo.findById(verificationRecord.id);
    expect(updated?.status).toBe(VerificationStatus.VERIFIED);

    // Duplicate processing (Idempotent)
    const secondResult = await webhookController.handleWebhook({
      rawBody,
      signatureHeader: signature,
      payload,
    });

    expect(secondResult.status).toBe("IDEMPOTENT_IGNORE");
    expect(secondResult.processed).toBe(false);
  });

  it("15. Webhook no autenticado: rejects webhooks with invalid HMAC signatures", async () => {
    const cipherIdService = new CipherIdService({
      webhookSecret: "secret-key",
    });
    const webhookController = new CipherIdWebhookController(
      cipherIdService,
      verificationRepo,
      webhookRepo,
      new VerificationEventEmitter(),
    );

    const payload = {
      eventId: "evt_bad_sig",
      eventType: "identity.verification.updated",
      providerReference: "cid_sess_999",
      status: "VERIFIED" as const,
    };

    await expect(
      webhookController.handleWebhook({
        rawBody: JSON.stringify(payload),
        signatureHeader: "invalid_signature_hash",
        payload,
      }),
    ).rejects.toThrow(CipherByteAuthError);
  });

  it("17 & 18. Provider abstraction & Mock provider: CoreVerificationService works decoupled with MockVerificationProvider without real credentials", async () => {
    const user = await userRepo.create({
      email: "mock_user@example.com",
      password_hash: "hash",
      role: ActorRole.BUYER,
      status: "ACTIVE",
    });

    const escrow = await escrowRepo.create({
      external_reference: "ESC-MOCK-001",
      buyer_id: user.id,
      seller_id: user.id,
      amount: "500.00",
      currency: "USD",
      status: EscrowStatus.CREATED,
    });

    const mockProvider = new MockVerificationProvider();
    const coreService = new CoreVerificationService(
      mockProvider,
      verificationRepo,
    );

    // Verify person
    const personRes = await coreService.verifyPerson(
      escrow.id,
      user.id,
      "1712345678",
    );
    expect(personRes.result.status).toBe(VerificationStatus.VERIFIED);
    expect(personRes.result.name).toBe("JUAN CARLOS PEREZ LOPEZ");

    // Verify vehicle
    const vehicleRes = await coreService.verifyVehicle(
      escrow.id,
      user.id,
      "PBA1234",
    );
    expect(vehicleRes.result.status).toBe(VerificationStatus.VERIFIED);
    expect(vehicleRes.result.brand).toBe("CHEVROLET");

    // Verify company
    const companyRes = await coreService.verifyCompany(
      escrow.id,
      user.id,
      "1792345678001",
    );
    expect(companyRes.result.status).toBe(VerificationStatus.VERIFIED);
    expect(companyRes.result.companyName).toBe(
      "COMPANIA DE PRUEBA ECUADOR S.A.",
    );

    // Create identity verification session
    const identityRes = await coreService.createIdentityVerification({
      escrowId: escrow.id,
      partyId: user.id,
    });
    expect(identityRes.session.status).toBe(VerificationStatus.PENDING);
    expect(identityRes.session.verificationUrl).toContain(
      "http://localhost:3000/verify-identity/",
    );

    // Check database records persisted
    const dbVerifications = await verificationRepo.findByEscrowId(escrow.id);
    expect(dbVerifications.length).toBe(4);
  });
});
