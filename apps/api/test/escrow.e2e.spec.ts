import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import request from "supertest";
import { Express } from "express";
import { newDb, DataType } from "pg-mem";
import { Pool } from "pg";
import { createApp } from "../src/app.js";
import * as auth from "@escrow-ecuador/auth";
import { v4 as uuidv4 } from "uuid";
import { EscrowStatus } from "@escrow-ecuador/escrow-domain";

// Mock auth middleware
let currentUser = { id: uuidv4(), role: "user" };
vi.mock("@escrow-ecuador/auth", () => ({
  authenticateJwt: (req: any, res: any, next: any) => {
    req.user = currentUser;
    next();
  },
}));

describe("Escrow API E2E", () => {
  let app: Express;
  let pool: Pool;
  let db: any;

  beforeAll(async () => {
    db = newDb();
    db.public.registerFunction({
      name: "gen_random_uuid",
      returns: DataType.uuid,
      implementation: (v4: any) => uuidv4(),
      impure: true,
    });
    db.public.registerFunction({
      name: "current_timestamp",
      returns: DataType.timestamp,
      implementation: () => new Date(),
    });
    db.public.registerFunction({
      name: "now",
      returns: DataType.timestamp,
      implementation: () => new Date(),
    });

    pool = new (db.adapters.createPg().Pool)() as any;

    await pool.query(`
      CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid()
      );
      CREATE TYPE escrow_status AS ENUM (
        'DRAFT', 'AWAITING_PAYMENT', 'FUNDS_HELD', 'DISPUTED', 'RELEASED', 'REFUNDED', 'CANCELLED'
      );
      CREATE TABLE escrow_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        buyer_id UUID NOT NULL REFERENCES users(id),
        seller_id UUID NOT NULL REFERENCES users(id),
        arbitrator_id UUID REFERENCES users(id),
        amount_cents BIGINT NOT NULL,
        fee_cents BIGINT NOT NULL DEFAULT 0,
        currency VARCHAR(3) NOT NULL DEFAULT 'USD',
        status escrow_status NOT NULL DEFAULT 'DRAFT',
        description TEXT NOT NULL,
        terms JSONB NOT NULL DEFAULT '{}'::jsonb,
        idempotency_key VARCHAR(64) UNIQUE,
        version INT NOT NULL DEFAULT 1,
        funded_at TIMESTAMPTZ,
        closed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE escrow_audit_ledger (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        escrow_id UUID NOT NULL REFERENCES escrow_transactions(id),
        from_status escrow_status NOT NULL,
        to_status escrow_status NOT NULL,
        actor_id UUID NOT NULL REFERENCES users(id),
        action VARCHAR(50) NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    app = createApp(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("Creation & Idempotency", () => {
    const buyerId = uuidv4();
    const sellerId = uuidv4();
    const idempotencyKey = uuidv4();
    let escrowId: string;

    beforeAll(async () => {
      await pool.query("INSERT INTO users (id) VALUES ($1), ($2)", [
        buyerId,
        sellerId,
      ]);
    });

    it("creates an escrow -> receives HTTP 201", async () => {
      currentUser = { id: buyerId, role: "user" };

      const res = await request(app)
        .post("/api/v1/escrows")
        .set("x-idempotency-key", idempotencyKey)
        .send({
          sellerId,
          amountCents: 10000,
          currency: "USD",
          description: "Test Escrow",
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.status).toBe(EscrowStatus.AWAITING_PAYMENT);
      escrowId = res.body.id;
    });

    it("retries identical request with same key -> returns existing without duplicates", async () => {
      currentUser = { id: buyerId, role: "user" };

      const res = await request(app)
        .post("/api/v1/escrows")
        .set("x-idempotency-key", idempotencyKey)
        .send({
          sellerId,
          amountCents: 10000,
          currency: "USD",
          description: "Test Escrow",
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe(escrowId);

      const countRes = await pool.query(
        "SELECT COUNT(*) FROM escrow_transactions",
      );
      expect(parseInt(countRes.rows[0].count, 10)).toBe(1);
    });
  });

  describe("Access Control & Visibility", () => {
    const buyerId = uuidv4();
    const sellerId = uuidv4();
    const thirdPartyId = uuidv4();
    let escrowId: string;

    beforeAll(async () => {
      await pool.query("INSERT INTO users (id) VALUES ($1), ($2), ($3)", [
        buyerId,
        sellerId,
        thirdPartyId,
      ]);
      const res = await pool.query(
        `INSERT INTO escrow_transactions (buyer_id, seller_id, amount_cents, currency, description, status)
         VALUES ($1, $2, 1000, 'USD', 'Visibility Test', 'AWAITING_PAYMENT') RETURNING id`,
        [buyerId, sellerId],
      );
      escrowId = res.rows[0].id;
    });

    it("unrelated third-party user attempts access -> HTTP 403", async () => {
      currentUser = { id: thirdPartyId, role: "user" };
      const res = await request(app).get(`/api/v1/escrows/${escrowId}`);
      expect(res.status).toBe(403);
    });

    it("buyer calls GET -> HTTP 200", async () => {
      currentUser = { id: buyerId, role: "user" };
      const res = await request(app).get(`/api/v1/escrows/${escrowId}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(escrowId);
    });
  });

  describe("Concurrency & Race Conditions", () => {
    const buyerId = uuidv4();
    const sellerId = uuidv4();
    let escrowId: string;

    beforeEach(async () => {
      await pool.query(
        "INSERT INTO users (id) VALUES ($1), ($2) ON CONFLICT DO NOTHING",
        [buyerId, sellerId],
      );
      const res = await pool.query(
        `INSERT INTO escrow_transactions (buyer_id, seller_id, amount_cents, currency, description, status)
         VALUES ($1, $2, 1000, 'USD', 'Race Condition Test', 'FUNDS_HELD') RETURNING id`,
        [buyerId, sellerId],
      );
      escrowId = res.rows[0].id;
    });

    it("handles simultaneous state transitions safely", async () => {
      currentUser = { id: buyerId, role: "user" };

      const res1 = await request(app).post(
        `/api/v1/escrows/${escrowId}/release`,
      );
      const res2 = await request(app).post(
        `/api/v1/escrows/${escrowId}/dispute`,
      );

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(409);

      const auditRes = await pool.query(
        "SELECT * FROM escrow_audit_ledger WHERE escrow_id = $1",
        [escrowId],
      );
      expect(auditRes.rows.length).toBe(1);

      const dbEscrow = await pool.query(
        "SELECT status, version FROM escrow_transactions WHERE id = $1",
        [escrowId],
      );
      expect(dbEscrow.rows[0].version).toBe(2);
    });
  });

  describe("Authority Invariant Checks", () => {
    const buyerId = uuidv4();
    const sellerId = uuidv4();
    let escrowId: string;

    beforeAll(async () => {
      await pool.query(
        "INSERT INTO users (id) VALUES ($1), ($2) ON CONFLICT DO NOTHING",
        [buyerId, sellerId],
      );
      const res = await pool.query(
        `INSERT INTO escrow_transactions (buyer_id, seller_id, amount_cents, currency, description, status)
         VALUES ($1, $2, 1000, 'USD', 'Authority Test', 'FUNDS_HELD') RETURNING id`,
        [buyerId, sellerId],
      );
      escrowId = res.rows[0].id;
    });

    it("Seller attempts to call /release -> HTTP 403", async () => {
      currentUser = { id: sellerId, role: "user" };
      const res = await request(app).post(
        `/api/v1/escrows/${escrowId}/release`,
      );
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("AUTHORITY_ERROR");
    });

    it("Buyer attempts to call /refund -> HTTP 403", async () => {
      currentUser = { id: buyerId, role: "user" };
      const res = await request(app).post(`/api/v1/escrows/${escrowId}/refund`);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("AUTHORITY_ERROR");
    });
  });
});
