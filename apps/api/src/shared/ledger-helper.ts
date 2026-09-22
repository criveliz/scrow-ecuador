import { LedgerRepository } from "@escrow-ecuador/database";
import { LedgerAccountType, LedgerDirection } from "@escrow-ecuador/database";

export const ACCOUNT_CODES = {
  CUSTOMER_ESCROW_LIABILITY: "2000_ESCROW_LIABILITY",
  SELLER_PAYOUT_SETTLEMENT: "1010_SELLER_PAYOUT",
  BUYER_REFUND_SETTLEMENT: "1020_BUYER_REFUND",
} as const;

export async function ensureDefaultLedgerAccounts(ledgerRepo: LedgerRepository) {
  let escrowLiability = await ledgerRepo.findAccountByName("CUSTOMER_ESCROW_LIABILITY");
  if (!escrowLiability) {
    escrowLiability = await ledgerRepo.createAccount({
      name: "CUSTOMER_ESCROW_LIABILITY",
      code: ACCOUNT_CODES.CUSTOMER_ESCROW_LIABILITY,
      type: LedgerAccountType.LIABILITY,
      description: "Escrow funds held in custody on behalf of customers",
    });
  }

  let sellerPayout = await ledgerRepo.findAccountByName("SELLER_PAYOUT_SETTLEMENT");
  if (!sellerPayout) {
    sellerPayout = await ledgerRepo.createAccount({
      name: "SELLER_PAYOUT_SETTLEMENT",
      code: ACCOUNT_CODES.SELLER_PAYOUT_SETTLEMENT,
      type: LedgerAccountType.ASSET,
      description: "Settlement account for seller fund releases",
    });
  }

  let buyerRefund = await ledgerRepo.findAccountByName("BUYER_REFUND_SETTLEMENT");
  if (!buyerRefund) {
    buyerRefund = await ledgerRepo.createAccount({
      name: "BUYER_REFUND_SETTLEMENT",
      code: ACCOUNT_CODES.BUYER_REFUND_SETTLEMENT,
      type: LedgerAccountType.ASSET,
      description: "Settlement account for buyer refunds",
    });
  }

  return { escrowLiability, sellerPayout, buyerRefund };
}

export async function postConfirmedReleaseLedger(opts: {
  ledgerRepo: LedgerRepository;
  escrowId: string;
  amount: string;
  currency: string;
  providerReference: string;
}) {
  const { ledgerRepo, escrowId, amount, currency, providerReference } = opts;
  const ref = `RELEASE:${providerReference}`;

  const existing = await ledgerRepo.findTransactionByReference(ref);
  if (existing) {
    return existing;
  }

  const { escrowLiability, sellerPayout } = await ensureDefaultLedgerAccounts(ledgerRepo);

  const { transaction } = await ledgerRepo.postTransaction(
    {
      escrow_id: escrowId,
      type: "ESCROW_FUND_RELEASE",
      reference: ref,
      status: "POSTED",
    },
    [
      {
        ledger_account_id: escrowLiability.id,
        direction: LedgerDirection.DEBIT,
        amount,
        currency,
      },
      {
        ledger_account_id: sellerPayout.id,
        direction: LedgerDirection.CREDIT,
        amount,
        currency,
      },
    ]
  );

  return transaction;
}

export async function postConfirmedRefundLedger(opts: {
  ledgerRepo: LedgerRepository;
  escrowId: string;
  amount: string;
  currency: string;
  providerReference: string;
}) {
  const { ledgerRepo, escrowId, amount, currency, providerReference } = opts;
  const ref = `REFUND:${providerReference}`;

  const existing = await ledgerRepo.findTransactionByReference(ref);
  if (existing) {
    return existing;
  }

  const { escrowLiability, buyerRefund } = await ensureDefaultLedgerAccounts(ledgerRepo);

  const { transaction } = await ledgerRepo.postTransaction(
    {
      escrow_id: escrowId,
      type: "ESCROW_FUND_REFUND",
      reference: ref,
      status: "POSTED",
    },
    [
      {
        ledger_account_id: escrowLiability.id,
        direction: LedgerDirection.DEBIT,
        amount,
        currency,
      },
      {
        ledger_account_id: buyerRefund.id,
        direction: LedgerDirection.CREDIT,
        amount,
        currency,
      },
    ]
  );

  return transaction;
}
