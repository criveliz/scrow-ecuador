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
