import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { KushkiClient } from "../src/client.js";
import { KushkiPaymentService } from "../src/service.js";
import { PgMemDbClient, runMigrations } from "@escrow-ecuador/database";

const fetchMock = vi.fn();
global.fetch = fetchMock;

describe("Kushki Adapter", () => {
  let db: PgMemDbClient;
  let client: KushkiClient;
  let service: KushkiPaymentService;

  beforeAll(async () => {
    db = new PgMemDbClient();
    await runMigrations(db);
  });

  beforeEach(async () => {
    fetchMock.mockReset();
    client = new KushkiClient({ merchantId: "test-merchant" });
    service = new KushkiPaymentService(client, db);

    await db.query(`DELETE FROM payment_transactions`);
    await db.query(`DELETE FROM escrow_transactions`);
    await db.query(`DELETE FROM users`);

    await db.query(`INSERT INTO users (id, email, password_hash) VALUES ('00000000-0000-0000-0000-000000000001', 'buyer@test.com', 'hash')`);
    await db.query(`INSERT INTO users (id, email, password_hash) VALUES ('00000000-0000-0000-0000-000000000002', 'seller@test.com', 'hash')`);

    await db.query(`INSERT INTO escrow_transactions (id, external_reference, buyer_id, seller_id, amount, status) VALUES ($1, $2, $3, $4, $5, $6)`, [
      "11111111-1111-1111-1111-111111111111",
      "ext-ref-1",
      "00000000-0000-0000-0000-000000000001",
      "00000000-0000-0000-0000-000000000002",
      "100.00",
      "AWAITING_PAYMENT",
    ]);

    await db.query(`INSERT INTO escrow_transactions (id, external_reference, buyer_id, seller_id, amount, status) VALUES ($1, $2, $3, $4, $5, $6)`, [
      "22222222-2222-2222-2222-222222222222",
      "ext-ref-2",
      "00000000-0000-0000-0000-000000000001",
      "00000000-0000-0000-0000-000000000002",
      "50.00",
      "PAYMENT_RECEIVED",
    ]);
  });

  it("should process successful card charge", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ticketNumber: "ticket-123",
        status: "APPROVAL",
        details: { responseCode: "000" }
      })
    });

    const result = await service.processCardCharge("11111111-1111-1111-1111-111111111111", "00000000-0000-0000-0000-000000000001", "token-xyz", "idemp-1");
    expect(result.status).toBe("AUTHORIZED");
    expect(result.ticketNumber).toBe("ticket-123");
    expect(result.actionUrl).toBeNull();
  });

  it("should handle 3DS REQUIRES_ACTION", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ticketNumber: "ticket-124",
        secureValidation: { type: "REQUIRES_ACTION", acsURL: "https://3ds.example.com" }
      })
    });

    const result = await service.processCardCharge("11111111-1111-1111-1111-111111111111", "00000000-0000-0000-0000-000000000001", "token-xyz", "idemp-2");
    expect(result.status).toBe("PENDING_CHALLENGE");
    expect(result.ticketNumber).toBe("ticket-124");
    expect(result.actionUrl).toBe("https://3ds.example.com");
  });

  it("should return idempotent result on repeated executions", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ticketNumber: "ticket-125",
        status: "APPROVAL"
      })
    });

    const result1 = await service.processCardCharge("11111111-1111-1111-1111-111111111111", "00000000-0000-0000-0000-000000000001", "token-xyz", "idemp-3");
    expect(result1.status).toBe("AUTHORIZED");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const result2 = await service.processCardCharge("11111111-1111-1111-1111-111111111111", "00000000-0000-0000-0000-000000000001", "token-xyz", "idemp-3");
    expect(result2).toEqual(result1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("should fail immediately if escrow is already funded", async () => {
    await expect(service.processCardCharge("22222222-2222-2222-2222-222222222222", "00000000-0000-0000-0000-000000000001", "token-xyz", "idemp-4"))
      .rejects.toThrow("Invalid escrow state for payment");
  });

  it("should fail if caller is not the buyer", async () => {
    await expect(service.processCardCharge("11111111-1111-1111-1111-111111111111", "00000000-0000-0000-0000-000000000002", "token-xyz", "idemp-5"))
      .rejects.toThrow("Unauthorized caller");
  });

  it("should keep FAILED state in db if Kushki API fails (error rollback check)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network Error"));
    await expect(service.processCardCharge("11111111-1111-1111-1111-111111111111", "00000000-0000-0000-0000-000000000001", "token-xyz", "idemp-6"))
      .rejects.toThrow("Network Error");

    // verify db has it as FAILED
    const res = await db.query(`SELECT * FROM payment_transactions WHERE idempotency_key = 'idemp-6'`);
    expect(res.rows[0].status).toBe("FAILED");
  });
});
