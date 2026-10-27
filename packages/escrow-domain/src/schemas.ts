import { z } from "zod";

export const CreateEscrowSchema = z.object({
  sellerId: z.string().uuid(),
  arbitratorId: z.string().uuid().optional(),
  amountCents: z.number().int().positive(),
  feeCents: z.number().int().nonnegative().default(0),
  currency: z.string().length(3),
  description: z.string().min(5).max(1000),
  terms: z.record(z.any()).default({}),
});

export type CreateEscrowInput = z.infer<typeof CreateEscrowSchema>;

export const TransitionActionSchema = z.object({
  reason: z.string().min(3).max(500).optional(),
  metadata: z.record(z.any()).default({}),
});

export type TransitionActionInput = z.infer<typeof TransitionActionSchema>;
