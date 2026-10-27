#!/bin/bash
set -e

# 1. DB schema
mkdir -p packages/database/schema
cat << 'SQL' > packages/database/schema/006_kushki_payments.sql
-- PostgreSQL 16 Schema Migration: 006_kushki_payments.sql

-- Enums for Payment Handling
CREATE TYPE payment_gateway AS ENUM ('KUSHKI');
CREATE TYPE payment_status AS ENUM ('INITIALIZED', 'PENDING_CHALLENGE', 'PROCESSING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'VOIDED');
CREATE TYPE payment_method_type AS ENUM ('CREDIT_CARD', 'DEBIT_CARD', 'TRANSFER');

-- Payment Transactions Table
CREATE TABLE IF NOT EXISTS payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_id UUID NOT NULL REFERENCES escrow_transactions(id) ON DELETE CASCADE,
  gateway payment_gateway NOT NULL DEFAULT 'KUSHKI',
  method_type payment_method_type NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  status payment_status NOT NULL DEFAULT 'INITIALIZED',
  kushki_ticket_number VARCHAR(255) UNIQUE,
  idempotency_key VARCHAR(255) NOT NULL UNIQUE,
  requires_action BOOLEAN DEFAULT FALSE,
  action_url VARCHAR(1024),
  raw_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
SQL

# 2. Kushki Adapter Package Base
mkdir -p packages/kushki-adapter/src packages/kushki-adapter/test
cat << 'JSON' > packages/kushki-adapter/package.json
{
  "name": "@escrow-ecuador/kushki-adapter",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "@escrow-ecuador/database": "*",
    "@escrow-ecuador/domain": "*"
  },
  "devDependencies": {
    "typescript": "^5.7.3",
    "vitest": "^3.0.5"
  }
}
JSON

cat << 'JSON' > packages/kushki-adapter/tsconfig.json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.spec.ts", "test/**/*"]
}
JSON

cat << 'TS' > packages/kushki-adapter/src/index.ts
export * from "./client.js";
export * from "./service.js";
TS

# 3. Kushki Client
cat << 'TS' > packages/kushki-adapter/src/client.ts
export interface KushkiConfig {
  merchantId: string;
  isProduction?: boolean;
}

export interface KushkiChargeRequest {
  token: string;
  amount: {
    subtotalIva0: number;
    subtotalIva?: number;
    iva?: number;
    currency: string;
  };
  contactDetails?: {
    email?: string;
  };
}

export interface KushkiTransferInitRequest {
  amount: {
    subtotalIva0: number;
    subtotalIva?: number;
    iva?: number;
    currency: string;
  };
  callbackUrl: string;
  userType: "0" | "1";
  documentType: string;
  documentNumber: string;
  paymentDescription: string;
  email: string;
  currency: string;
}

export interface KushkiResponse {
  ticketNumber?: string;
  status?: string;
  details?: {
    responseCode?: string;
  };
  secureValidation?: {
    type?: string;
    acsURL?: string;
  };
}

export class KushkiClient {
  private readonly baseUrl: string;
  private readonly merchantId: string;

  constructor(config: KushkiConfig) {
    this.merchantId = config.merchantId;
    this.baseUrl = config.isProduction
      ? "https://api.kushkipagos.com"
      : "https://api-uat.kushkipagos.com";
  }

  private async request<T>(endpoint: string, method: string, payload: unknown, idempotencyKey: string): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 seconds

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Private-Merchant-Id": this.merchantId,
          "X-Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorBody = {};
        try {
          errorBody = await response.json();
        } catch {
          // Ignore
        }
        throw new Error(`Kushki API Error: ${response.status} - ${JSON.stringify(errorBody)}`);
      }

      return await response.json() as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async chargeCard(request: KushkiChargeRequest, idempotencyKey: string): Promise<KushkiResponse> {
    return this.request<KushkiResponse>("/card/v1/charges", "POST", request, idempotencyKey);
  }

  async initTransfer(request: KushkiTransferInitRequest, idempotencyKey: string): Promise<KushkiResponse> {
    return this.request<KushkiResponse>("/transfer/v1/init", "POST", request, idempotencyKey);
  }
}
TS

# 4. Kushki Service
cat << 'TS' > packages/kushki-adapter/src/service.ts
import { KushkiClient, KushkiChargeRequest, KushkiResponse } from "./client.js";
import { EscrowStatus } from "@escrow-ecuador/domain";
import { DbClient } from "@escrow-ecuador/database";

export interface ChargeResult {
  paymentId: string;
  ticketNumber: string | null;
  status: string;
  actionUrl: string | null;
}

export class KushkiPaymentService {
  constructor(
    private readonly kushkiClient: KushkiClient,
    private readonly db: DbClient
  ) {}

  async processCardCharge(
    escrowId: string,
    buyerId: string,
    token: string,
    idempotencyKey: string
  ): Promise<ChargeResult> {
    const initialResult = await this.db.transaction(async (tx: DbClient) => {
      const idempSql = `SELECT * FROM payment_transactions WHERE idempotency_key = $1`;
      const idempRes = await tx.query(idempSql, [idempotencyKey]);
      if (idempRes.rows.length > 0) {
        return { existing: idempRes.rows[0] };
      }

      const escrowSql = `SELECT * FROM escrow_transactions WHERE id = $1`;
      const escrowRes = await tx.query(escrowSql, [escrowId]);
      const escrow = escrowRes.rows[0];

      if (!escrow) {
        throw new Error("Escrow transaction not found");
      }

      if (escrow.buyer_id !== buyerId) {
        const err = new Error("Unauthorized caller");
        (err as any).status = 403;
        throw err;
      }

      if (escrow.status !== EscrowStatus.AWAITING_PAYMENT) {
        const err = new Error("Invalid escrow state for payment");
        (err as any).status = 409;
        throw err;
      }

      const numericAmount = parseFloat(escrow.amount);
      const amountCents = BigInt(Math.round(numericAmount * 100));
      const kushkiAmount = Number(amountCents) / 100;

      const paymentId = crypto.randomUUID();
      const insertSql = `
        INSERT INTO payment_transactions (
          id, escrow_id, gateway, method_type, amount_cents, currency, status, idempotency_key
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `;
      await tx.query(insertSql, [
        paymentId,
        escrowId,
        "KUSHKI",
        "CREDIT_CARD",
        amountCents.toString(),
        "USD",
        "INITIALIZED",
        idempotencyKey
      ]);

      return { paymentId, kushkiAmount };
    });

    if (initialResult.existing) {
      const existing = initialResult.existing;
      return {
        paymentId: existing.id,
        ticketNumber: existing.kushki_ticket_number,
        status: existing.status,
        actionUrl: existing.action_url,
      };
    }

    const { paymentId, kushkiAmount } = initialResult;

    let kushkiResponse: KushkiResponse | undefined;
    let error: Error | null = null;
    try {
      const request: KushkiChargeRequest = {
        token,
        amount: {
          subtotalIva0: kushkiAmount!,
          currency: "USD",
        },
      };
      kushkiResponse = await this.kushkiClient.chargeCard(request, idempotencyKey);
    } catch (e: unknown) {
      error = e instanceof Error ? e : new Error(String(e));
    }

    return this.db.transaction(async (tx: DbClient) => {
      if (error) {
        await tx.query(
          `UPDATE payment_transactions SET status = 'FAILED', raw_response = $1, updated_at = $2 WHERE id = $3`,
          [JSON.stringify({ error: error.message }), new Date(), paymentId]
        );
        throw error;
      }

      let newStatus = "PROCESSING";
      let requiresAction = false;
      let actionUrl = null;
      let ticketNumber = kushkiResponse!.ticketNumber || null;

      const is3ds = kushkiResponse!.secureValidation?.type === "REQUIRES_ACTION";

      if (is3ds) {
        newStatus = "PENDING_CHALLENGE";
        requiresAction = true;
        actionUrl = kushkiResponse!.secureValidation?.acsURL || null;
      } else if (kushkiResponse!.details?.responseCode === "000" || kushkiResponse!.status === "APPROVAL") {
        newStatus = "AUTHORIZED";
      } else {
        newStatus = "FAILED";
      }

      await tx.query(
        `UPDATE payment_transactions
         SET status = $1, kushki_ticket_number = $2, requires_action = $3, action_url = $4, raw_response = $5, updated_at = $6
         WHERE id = $7`,
        [newStatus, ticketNumber, requiresAction, actionUrl, JSON.stringify(kushkiResponse), new Date(), paymentId]
      );

      return {
        paymentId: paymentId!,
        ticketNumber,
        status: newStatus,
        actionUrl,
      };
    });
  }
}
TS

# 5. Apps/API Package & Routes
mkdir -p apps/api/src/routes
cat << 'JSON' > apps/api/package.json
{
  "name": "@escrow-ecuador/api",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "dependencies": {
    "express": "^4.19.2",
    "@escrow-ecuador/kushki-adapter": "*",
    "@escrow-ecuador/database": "*"
  },
  "devDependencies": {
    "@types/express": "^4.17.21"
  }
}
JSON

cat << 'TS' > apps/api/src/routes/payment.ts
import { Router, Request, Response } from "express";
import { KushkiClient, KushkiPaymentService } from "@escrow-ecuador/kushki-adapter";
import { PgDbClient } from "@escrow-ecuador/database";

const router = Router();
const db = new PgDbClient();
const kushkiClient = new KushkiClient({ merchantId: process.env.KUSHKI_MERCHANT_ID || "test_merchant" });
const kushkiPaymentService = new KushkiPaymentService(kushkiClient, db);

const authenticateJwt = (req: Request, res: Response, next: Function) => {
  (req as any).user = { id: "test-buyer-id" };
  next();
};

router.post("/:id/pay/card", authenticateJwt, async (req: Request, res: Response) => {
  try {
    const escrowId = req.params.id;
    const { token } = req.body;
    const idempotencyKey = req.headers["x-idempotency-key"] as string;
    const buyerId = (req as any).user.id;

    if (!idempotencyKey) {
      return res.status(400).json({ error: "Missing x-idempotency-key header" });
    }

    if (!token) {
      return res.status(400).json({ error: "Missing token in payload" });
    }

    const result = await kushkiPaymentService.processCardCharge(escrowId, buyerId, token, idempotencyKey);
    return res.status(200).json(result);
  } catch (error: any) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error(error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
TS

cat << 'TS' > apps/api/src/index.ts
import express from "express";
import paymentRouter from "./routes/payment.js";

const app = express();
app.use(express.json());

app.use("/api/v1/escrows", paymentRouter);

export default app;
TS

# 6. Test File
cat << 'TS' > packages/kushki-adapter/test/kushki.spec.ts
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
TS
