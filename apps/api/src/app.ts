import express, { Express, Request, Response, NextFunction } from "express";
import { Pool } from "pg";
import { createEscrowRouter } from "./routes/escrow.router.js";
import { EscrowService } from "@escrow-ecuador/escrow-domain";

export function createApp(pool: Pool): Express {
  const app = express();
  app.use(express.json());

  const escrowService = new EscrowService(pool);
  const escrowRouter = createEscrowRouter(escrowService);

  app.use("/api/v1/escrows", escrowRouter);

  // Global error handler
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  });

  return app;
}
