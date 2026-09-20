import { describe, expect, it } from "vitest";
import { EscrowStatus, assertTransition, canTransition } from "./state-machine";

describe("escrow state machine", () => {
  it("allows the normal happy path", () => {
    expect(canTransition(EscrowStatus.CREATED, EscrowStatus.AWAITING_PAYMENT)).toBe(true);
    expect(canTransition(EscrowStatus.AWAITING_PAYMENT, EscrowStatus.PAYMENT_RECEIVED)).toBe(true);
    expect(canTransition(EscrowStatus.PAYMENT_RECEIVED, EscrowStatus.FUNDS_CONFIRMED)).toBe(true);
    expect(canTransition(EscrowStatus.FUNDS_CONFIRMED, EscrowStatus.SELLER_ACCEPTED)).toBe(true);
    expect(canTransition(EscrowStatus.SELLER_ACCEPTED, EscrowStatus.DELIVERY_PENDING)).toBe(true);
    expect(canTransition(EscrowStatus.DELIVERY_PENDING, EscrowStatus.DELIVERED)).toBe(true);
    expect(canTransition(EscrowStatus.DELIVERED, EscrowStatus.BUYER_CONFIRMED)).toBe(true);
    expect(canTransition(EscrowStatus.BUYER_CONFIRMED, EscrowStatus.RELEASE_PENDING)).toBe(true);
    expect(canTransition(EscrowStatus.RELEASE_PENDING, EscrowStatus.RELEASED)).toBe(true);
  });

  it("rejects arbitrary jumps", () => {
    expect(canTransition(EscrowStatus.CREATED, EscrowStatus.RELEASED)).toBe(false);
    expect(() => assertTransition(EscrowStatus.CREATED, EscrowStatus.RELEASED)).toThrow();
  });

  it("allows disputes from operational states", () => {
    expect(canTransition(EscrowStatus.FUNDS_CONFIRMED, EscrowStatus.DISPUTED)).toBe(true);
    expect(canTransition(EscrowStatus.DELIVERED, EscrowStatus.DISPUTED)).toBe(true);
  });
});
