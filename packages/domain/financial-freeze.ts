export class FinancialFreezeError extends Error {
  constructor(message = "Financial action blocked: Escrow is under active dispute financial freeze.") {
    super(message);
    this.name = "FinancialFreezeError";
  }
}
