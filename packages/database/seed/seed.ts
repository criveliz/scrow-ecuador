import { ActorRole, EscrowStatus } from "@escrow-ecuador/domain";
import { DbClient } from "../db.js";
import { EscrowRepository } from "../repositories/escrow.repository.js";
import { LedgerRepository } from "../repositories/ledger.repository.js";
import { UserRepository } from "../repositories/user.repository.js";
import { LedgerAccountType } from "../types/index.js";

export async function seedDatabase(db: DbClient) {
  const userRepo = new UserRepository(db);
  const escrowRepo = new EscrowRepository(db);
  const ledgerRepo = new LedgerRepository(db);

  // 1. Seed Users (synthetic test users)
  const buyer = await userRepo.create({
    email: "test.buyer@example.invalid",
    phone: "+593999999991",
    password_hash: "$2b$10$synthetic_hash_buyer_1234567890123456789012345678",
    role: ActorRole.BUYER,
    status: "ACTIVE",
  });

  const seller = await userRepo.create({
    email: "test.seller@example.invalid",
    phone: "+593999999992",
    password_hash: "$2b$10$synthetic_hash_seller_123456789012345678901234567",
    role: ActorRole.SELLER,
    status: "ACTIVE",
  });

  // 2. Seed Standard Ledger Accounts
  const ledgerAccounts = [
    {
      name: "CUSTOMER_FUNDS",
      code: "1010",
      type: LedgerAccountType.ASSET,
      description: "Clearing account for customer funds held in fiduciary trust",
    },
    {
      name: "PENDING_RELEASE",
      code: "2010",
      type: LedgerAccountType.LIABILITY,
      description: "Liability account for funds awaiting seller release",
    },
    {
      name: "PLATFORM_FEES",
      code: "4010",
      type: LedgerAccountType.REVENUE,
      description: "Platform transaction commission revenue",
    },
    {
      name: "REFUNDS",
      code: "2020",
      type: LedgerAccountType.LIABILITY,
      description: "Liability clearing account for pending buyer refunds",
    },
    {
      name: "OTHER_CLEARING_ACCOUNTS",
      code: "1090",
      type: LedgerAccountType.ASSET,
      description: "General clearing account for provider settlements",
    },
  ];

  for (const acc of ledgerAccounts) {
    await ledgerRepo.createAccount(acc);
  }

  // 3. Seed Sample Escrow Transaction
  const sampleEscrow = await escrowRepo.create({
    external_reference: "ESC-SEED-0001",
    buyer_id: buyer.id,
    seller_id: seller.id,
    amount: "150.00",
    currency: "USD",
    status: EscrowStatus.CREATED,
    description: "Synthetic test purchase of laptop accessory",
    expires_at: new Date(Date.now() + 48 * 3600 * 1000),
  });

  return {
    buyer,
    seller,
    sampleEscrow,
  };
}
