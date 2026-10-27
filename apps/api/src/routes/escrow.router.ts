import { Router, Request, Response } from "express";
import {
  EscrowService,
  EscrowError,
  CreateEscrowSchema,
  EscrowStatus,
} from "@escrow-ecuador/escrow-domain";
import { authenticateJwt } from "@escrow-ecuador/auth";
import { ZodError } from "zod";

export function createEscrowRouter(escrowService: EscrowService): Router {
  const router = Router();

  // Middleware to serialize bigints in JSON responses
  const serializeBigInt = (obj: any): any => {
    return JSON.parse(
      JSON.stringify(obj, (key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    );
  };

  router.use(authenticateJwt);

  router.post("/", async (req: Request, res: Response) => {
    try {
      const idempotencyKey = req.header("x-idempotency-key");
      const input = CreateEscrowSchema.parse(req.body);
      const buyerId = (req as any).user.id;

      const escrow = await escrowService.createEscrow(
        buyerId,
        input,
        idempotencyKey,
      );
      res.status(201).json(serializeBigInt(escrow));
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ error: error.errors });
      } else if (error instanceof EscrowError) {
        if (error.code === "INVALID_COUNTERPARTY") {
          res.status(409).json({ error: error.message, code: error.code });
        } else {
          res.status(400).json({ error: error.message, code: error.code });
        }
      } else {
        res.status(500).json({ error: "Internal Server Error" });
      }
    }
  });

  router.get("/:id", async (req: Request, res: Response) => {
    try {
      const escrowId = req.params.id;
      const actorId = (req as any).user.id;
      const actorRole = (req as any).user.role;

      const escrow = await escrowService.getEscrowById(
        escrowId,
        actorId,
        actorRole,
      );
      res.status(200).json(serializeBigInt(escrow));
    } catch (error) {
      if (error instanceof EscrowError) {
        if (error.code === "ESCROW_NOT_FOUND") {
          res.status(404).json({ error: error.message, code: error.code });
        } else if (error.code === "FORBIDDEN_RESOURCE") {
          res.status(403).json({ error: error.message, code: error.code });
        } else {
          res.status(400).json({ error: error.message, code: error.code });
        }
      } else {
        res.status(500).json({ error: "Internal Server Error" });
      }
    }
  });

  const handleTransition = (targetStatus: EscrowStatus, action: string) => {
    return async (req: Request, res: Response) => {
      try {
        const escrowId = req.params.id;
        const actorId = (req as any).user.id;
        const actorRole = (req as any).user.role;

        const escrow = await escrowService.transitionStatus(
          escrowId,
          targetStatus,
          actorId,
          actorRole,
          action,
          req.body,
        );
        res.status(200).json(serializeBigInt(escrow));
      } catch (error) {
        if (error instanceof EscrowError) {
          if (error.code === "ESCROW_NOT_FOUND") {
            res.status(404).json({ error: error.message, code: error.code });
          } else if (error.code === "AUTHORITY_ERROR") {
            res.status(403).json({ error: error.message, code: error.code });
          } else if (error.code === "ILLEGAL_STATE_TRANSITION") {
            res.status(409).json({ error: error.message, code: error.code });
          } else {
            res.status(400).json({ error: error.message, code: error.code });
          }
        } else {
          res.status(500).json({ error: "Internal Server Error" });
        }
      }
    };
  };

  router.post(
    "/:id/release",
    handleTransition(EscrowStatus.RELEASED, "RELEASE_FUNDS"),
  );
  router.post(
    "/:id/dispute",
    handleTransition(EscrowStatus.DISPUTED, "OPEN_DISPUTE"),
  );
  router.post(
    "/:id/refund",
    handleTransition(EscrowStatus.REFUNDED, "REFUND_FUNDS"),
  );

  return router;
}
