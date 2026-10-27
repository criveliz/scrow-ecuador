import { describe, expect, it } from "vitest";
import {
  ActorRole,
  EscrowStatus,
  InvalidStateTransitionError,
  InvalidTransitionPayloadError,
  TerminalStateError,
  UnauthorizedActorError,
  assertTransition,
  canTransition,
  executeTransition,
  isAllowedActorForTransition,
  isTerminalState,
  validateTransition,
} from "./state-machine.js";

describe("escrow state machine", () => {
  const dummyTxId = "tx-12345";
  const now = new Date("2025-01-01T12:00:00Z");

  describe("happy path transitions", () => {
    it("allows full happy path sequence with valid actors and payload", () => {
      // CREATED -> AWAITING_PAYMENT
      const t1 = executeTransition({
        transactionId: dummyTxId,
        previousState: EscrowStatus.CREATED,
        newState: EscrowStatus.AWAITING_PAYMENT,
        actorId: "buyer-1",
        actorRole: ActorRole.BUYER,
        timestamp: now,
        reason: "Initiate payment",
      });
      expect(t1.newState).toBe(EscrowStatus.AWAITING_PAYMENT);

      // AWAITING_PAYMENT -> PAYMENT_RECEIVED
      const t2 = executeTransition({
        transactionId: dummyTxId,
        previousState: EscrowStatus.AWAITING_PAYMENT,
        newState: EscrowStatus.PAYMENT_RECEIVED,
        actorId: "sys-1",
        actorRole: ActorRole.SYSTEM,
        timestamp: now,
        reason: "Payment gateway webhook confirmed payment",
      });
      expect(t2.newState).toBe(EscrowStatus.PAYMENT_RECEIVED);

      // PAYMENT_RECEIVED -> FUNDS_CONFIRMED
      const t3 = executeTransition({
        transactionId: dummyTxId,
        previousState: EscrowStatus.PAYMENT_RECEIVED,
        newState: EscrowStatus.FUNDS_CONFIRMED,
        actorId: "sys-1",
        actorRole: ActorRole.SYSTEM,
        timestamp: now,
        reason: "Fiduciary confirmed clearing",
      });
      expect(t3.newState).toBe(EscrowStatus.FUNDS_CONFIRMED);

      // FUNDS_CONFIRMED -> SELLER_ACCEPTED
      const t4 = executeTransition({
        transactionId: dummyTxId,
        previousState: EscrowStatus.FUNDS_CONFIRMED,
        newState: EscrowStatus.SELLER_ACCEPTED,
        actorId: "seller-1",
        actorRole: ActorRole.SELLER,
        timestamp: now,
        reason: "Seller accepted order",
      });
      expect(t4.newState).toBe(EscrowStatus.SELLER_ACCEPTED);

      // SELLER_ACCEPTED -> DELIVERY_PENDING
      const t5 = executeTransition({
        transactionId: dummyTxId,
        previousState: EscrowStatus.SELLER_ACCEPTED,
        newState: EscrowStatus.DELIVERY_PENDING,
        actorId: "seller-1",
        actorRole: ActorRole.SELLER,
        timestamp: now,
        reason: "Shipment dispatched",
      });
      expect(t5.newState).toBe(EscrowStatus.DELIVERY_PENDING);

      // DELIVERY_PENDING -> DELIVERED
      const t6 = executeTransition({
        transactionId: dummyTxId,
        previousState: EscrowStatus.DELIVERY_PENDING,
        newState: EscrowStatus.DELIVERED,
        actorId: "seller-1",
        actorRole: ActorRole.SELLER,
        timestamp: now,
        reason: "Courier marked item delivered",
      });
      expect(t6.newState).toBe(EscrowStatus.DELIVERED);

      // DELIVERED -> BUYER_CONFIRMED
      const t7 = executeTransition({
        transactionId: dummyTxId,
        previousState: EscrowStatus.DELIVERED,
        newState: EscrowStatus.BUYER_CONFIRMED,
        actorId: "buyer-1",
        actorRole: ActorRole.BUYER,
        timestamp: now,
        reason: "Buyer confirmed receipt and satisfaction",
      });
      expect(t7.newState).toBe(EscrowStatus.BUYER_CONFIRMED);

      // BUYER_CONFIRMED -> RELEASE_PENDING
      const t8 = executeTransition({
        transactionId: dummyTxId,
        previousState: EscrowStatus.BUYER_CONFIRMED,
        newState: EscrowStatus.RELEASE_PENDING,
        actorId: "buyer-1",
        actorRole: ActorRole.BUYER,
        timestamp: now,
        reason: "Release requested",
      });
      expect(t8.newState).toBe(EscrowStatus.RELEASE_PENDING);

      // RELEASE_PENDING -> RELEASED
      const t9 = executeTransition({
        transactionId: dummyTxId,
        previousState: EscrowStatus.RELEASE_PENDING,
        newState: EscrowStatus.RELEASED,
        actorId: "sys-1",
        actorRole: ActorRole.SYSTEM,
        timestamp: now,
        reason: "Payout processed to seller account",
      });
      expect(t9.newState).toBe(EscrowStatus.RELEASED);
    });
  });

  describe("invalid state transitions", () => {
    it("rejects illegal state jumps", () => {
      expect(canTransition(EscrowStatus.CREATED, EscrowStatus.RELEASED)).toBe(
        false,
      );
      expect(() =>
        validateTransition({
          transactionId: dummyTxId,
          previousState: EscrowStatus.CREATED,
          newState: EscrowStatus.RELEASED,
          actorId: "admin-1",
          actorRole: ActorRole.ADMIN,
          timestamp: now,
          reason: "Arbitrary status change attempt",
        }),
      ).toThrow(InvalidStateTransitionError);
    });

    it("rejects transition if transactionId is missing or empty", () => {
      expect(() =>
        validateTransition({
          transactionId: "",
          previousState: EscrowStatus.CREATED,
          newState: EscrowStatus.AWAITING_PAYMENT,
          actorId: "buyer-1",
          actorRole: ActorRole.BUYER,
          timestamp: now,
          reason: "Missing tx id",
        }),
      ).toThrow(InvalidTransitionPayloadError);
    });

    it("rejects transition if actorId is missing or empty", () => {
      expect(() =>
        validateTransition({
          transactionId: dummyTxId,
          previousState: EscrowStatus.CREATED,
          newState: EscrowStatus.AWAITING_PAYMENT,
          actorId: "  ",
          actorRole: ActorRole.BUYER,
          timestamp: now,
          reason: "Missing actor id",
        }),
      ).toThrow(InvalidTransitionPayloadError);
    });

    it("rejects transition if reason is missing or empty", () => {
      expect(() =>
        validateTransition({
          transactionId: dummyTxId,
          previousState: EscrowStatus.CREATED,
          newState: EscrowStatus.AWAITING_PAYMENT,
          actorId: "buyer-1",
          actorRole: ActorRole.BUYER,
          timestamp: now,
          reason: "",
        }),
      ).toThrow(InvalidTransitionPayloadError);
    });

    it("rejects transition if timestamp is invalid", () => {
      expect(() =>
        validateTransition({
          transactionId: dummyTxId,
          previousState: EscrowStatus.CREATED,
          newState: EscrowStatus.AWAITING_PAYMENT,
          actorId: "buyer-1",
          actorRole: ActorRole.BUYER,
          timestamp: "not-a-date",
          reason: "Bad timestamp",
        }),
      ).toThrow(InvalidTransitionPayloadError);
    });
  });

  describe("role-based transition authorization", () => {
    it("prevents BUYER from accepting order on behalf of SELLER", () => {
      expect(
        isAllowedActorForTransition(
          EscrowStatus.FUNDS_CONFIRMED,
          EscrowStatus.SELLER_ACCEPTED,
          ActorRole.BUYER,
        ),
      ).toBe(false);

      expect(() =>
        executeTransition({
          transactionId: dummyTxId,
          previousState: EscrowStatus.FUNDS_CONFIRMED,
          newState: EscrowStatus.SELLER_ACCEPTED,
          actorId: "buyer-1",
          actorRole: ActorRole.BUYER,
          timestamp: now,
          reason: "Buyer trying to accept seller order",
        }),
      ).toThrow(UnauthorizedActorError);
    });

    it("prevents BUYER from directly setting PAYMENT_RECEIVED", () => {
      expect(
        isAllowedActorForTransition(
          EscrowStatus.AWAITING_PAYMENT,
          EscrowStatus.PAYMENT_RECEIVED,
          ActorRole.BUYER,
        ),
      ).toBe(false);

      expect(() =>
        executeTransition({
          transactionId: dummyTxId,
          previousState: EscrowStatus.AWAITING_PAYMENT,
          newState: EscrowStatus.PAYMENT_RECEIVED,
          actorId: "buyer-1",
          actorRole: ActorRole.BUYER,
          timestamp: now,
          reason: "Buyer claims paid without gateway confirmation",
        }),
      ).toThrow(UnauthorizedActorError);
    });

    it("prevents SELLER from confirming receipt on behalf of BUYER", () => {
      expect(
        isAllowedActorForTransition(
          EscrowStatus.DELIVERED,
          EscrowStatus.BUYER_CONFIRMED,
          ActorRole.SELLER,
        ),
      ).toBe(false);

      expect(() =>
        executeTransition({
          transactionId: dummyTxId,
          previousState: EscrowStatus.DELIVERED,
          newState: EscrowStatus.BUYER_CONFIRMED,
          actorId: "seller-1",
          actorRole: ActorRole.SELLER,
          timestamp: now,
          reason: "Seller trying to confirm for buyer",
        }),
      ).toThrow(UnauthorizedActorError);
    });

    it("allows ADMIN or SUPPORT to resolve DISPUTED state", () => {
      expect(
        isAllowedActorForTransition(
          EscrowStatus.DISPUTED,
          EscrowStatus.REFUNDED,
          ActorRole.ADMIN,
        ),
      ).toBe(true);

      expect(
        isAllowedActorForTransition(
          EscrowStatus.DISPUTED,
          EscrowStatus.RELEASE_PENDING,
          ActorRole.SUPPORT,
        ),
      ).toBe(true);
    });

    it("prevents BUYER or SELLER from unilaterally resolving DISPUTED to REFUNDED or RELEASE_PENDING", () => {
      expect(
        isAllowedActorForTransition(
          EscrowStatus.DISPUTED,
          EscrowStatus.REFUNDED,
          ActorRole.BUYER,
        ),
      ).toBe(false);

      expect(
        isAllowedActorForTransition(
          EscrowStatus.DISPUTED,
          EscrowStatus.RELEASE_PENDING,
          ActorRole.SELLER,
        ),
      ).toBe(false);
    });
  });

  describe("dispute handling & pausing automatic releases", () => {
    it("allows entering DISPUTED from active operational states", () => {
      const operationalStates = [
        EscrowStatus.PAYMENT_RECEIVED,
        EscrowStatus.FUNDS_CONFIRMED,
        EscrowStatus.SELLER_ACCEPTED,
        EscrowStatus.DELIVERY_PENDING,
        EscrowStatus.DELIVERED,
        EscrowStatus.RELEASE_PENDING,
      ];

      for (const state of operationalStates) {
        expect(canTransition(state, EscrowStatus.DISPUTED)).toBe(true);

        const transition = executeTransition({
          transactionId: dummyTxId,
          previousState: state,
          newState: EscrowStatus.DISPUTED,
          actorId: "buyer-1",
          actorRole: ActorRole.BUYER,
          timestamp: now,
          reason: `Opened dispute from ${state}`,
        });
        expect(transition.newState).toBe(EscrowStatus.DISPUTED);
      }
    });

    it("prevents DISPUTED from transitioning directly to RELEASED without RELEASE_PENDING", () => {
      expect(canTransition(EscrowStatus.DISPUTED, EscrowStatus.RELEASED)).toBe(
        false,
      );

      expect(() =>
        executeTransition({
          transactionId: dummyTxId,
          previousState: EscrowStatus.DISPUTED,
          newState: EscrowStatus.RELEASED,
          actorId: "admin-1",
          actorRole: ActorRole.ADMIN,
          timestamp: now,
          reason: "Direct release attempt from dispute",
        }),
      ).toThrow(InvalidStateTransitionError);
    });

    it("allows dispute resolution to RELEASE_PENDING or REFUNDED by authorized role", () => {
      // Dispute resolved in favor of seller -> RELEASE_PENDING
      const releaseRes = executeTransition({
        transactionId: dummyTxId,
        previousState: EscrowStatus.DISPUTED,
        newState: EscrowStatus.RELEASE_PENDING,
        actorId: "admin-1",
        actorRole: ActorRole.ADMIN,
        timestamp: now,
        reason: "Dispute resolved in favor of seller",
      });
      expect(releaseRes.newState).toBe(EscrowStatus.RELEASE_PENDING);

      // Dispute resolved in favor of buyer -> REFUNDED
      const refundRes = executeTransition({
        transactionId: dummyTxId,
        previousState: EscrowStatus.DISPUTED,
        newState: EscrowStatus.REFUNDED,
        actorId: "support-1",
        actorRole: ActorRole.SUPPORT,
        timestamp: now,
        reason: "Dispute resolved in favor of buyer",
      });
      expect(refundRes.newState).toBe(EscrowStatus.REFUNDED);
    });
  });

  describe("financial finality and terminal state protection", () => {
    it("identifies terminal states correctly", () => {
      expect(isTerminalState(EscrowStatus.RELEASED)).toBe(true);
      expect(isTerminalState(EscrowStatus.REFUNDED)).toBe(true);
      expect(isTerminalState(EscrowStatus.EXPIRED)).toBe(true);
      expect(isTerminalState(EscrowStatus.CANCELLED)).toBe(true);

      expect(isTerminalState(EscrowStatus.CREATED)).toBe(false);
      expect(isTerminalState(EscrowStatus.AWAITING_PAYMENT)).toBe(false);
      expect(isTerminalState(EscrowStatus.DISPUTED)).toBe(false);
    });

    it("prevents any state transition after escrow is RELEASED", () => {
      const targets = [
        EscrowStatus.REFUNDED,
        EscrowStatus.DISPUTED,
        EscrowStatus.RELEASE_PENDING,
        EscrowStatus.CREATED,
      ];

      for (const target of targets) {
        expect(canTransition(EscrowStatus.RELEASED, target)).toBe(false);
        expect(() =>
          executeTransition({
            transactionId: dummyTxId,
            previousState: EscrowStatus.RELEASED,
            newState: target,
            actorId: "admin-1",
            actorRole: ActorRole.ADMIN,
            timestamp: now,
            reason: "Post-release transition attempt",
          }),
        ).toThrow(TerminalStateError);
      }
    });

    it("prevents release or dispute after escrow is REFUNDED", () => {
      const targets = [
        EscrowStatus.RELEASED,
        EscrowStatus.RELEASE_PENDING,
        EscrowStatus.DISPUTED,
      ];

      for (const target of targets) {
        expect(canTransition(EscrowStatus.REFUNDED, target)).toBe(false);
        expect(() =>
          executeTransition({
            transactionId: dummyTxId,
            previousState: EscrowStatus.REFUNDED,
            newState: target,
            actorId: "admin-1",
            actorRole: ActorRole.ADMIN,
            timestamp: now,
            reason: "Post-refund transition attempt",
          }),
        ).toThrow(TerminalStateError);
      }
    });

    it("prevents transitions out of EXPIRED or CANCELLED", () => {
      for (const terminalState of [
        EscrowStatus.EXPIRED,
        EscrowStatus.CANCELLED,
      ]) {
        expect(() =>
          executeTransition({
            transactionId: dummyTxId,
            previousState: terminalState,
            newState: EscrowStatus.AWAITING_PAYMENT,
            actorId: "admin-1",
            actorRole: ActorRole.ADMIN,
            timestamp: now,
            reason: "Reopening terminal escrow",
          }),
        ).toThrow(TerminalStateError);
      }
    });
  });

  describe("cancellation and expiration rules", () => {
    it("allows cancellation from CREATED and AWAITING_PAYMENT", () => {
      const t1 = executeTransition({
        transactionId: dummyTxId,
        previousState: EscrowStatus.CREATED,
        newState: EscrowStatus.CANCELLED,
        actorId: "buyer-1",
        actorRole: ActorRole.BUYER,
        timestamp: now,
        reason: "Buyer cancelled before payment link created",
      });
      expect(t1.newState).toBe(EscrowStatus.CANCELLED);

      const t2 = executeTransition({
        transactionId: dummyTxId,
        previousState: EscrowStatus.AWAITING_PAYMENT,
        newState: EscrowStatus.CANCELLED,
        actorId: "seller-1",
        actorRole: ActorRole.SELLER,
        timestamp: now,
        reason: "Seller cancelled transaction",
      });
      expect(t2.newState).toBe(EscrowStatus.CANCELLED);
    });

    it("prevents cancellation once payment is received or funds confirmed", () => {
      expect(
        canTransition(EscrowStatus.PAYMENT_RECEIVED, EscrowStatus.CANCELLED),
      ).toBe(false);
      expect(
        canTransition(EscrowStatus.FUNDS_CONFIRMED, EscrowStatus.CANCELLED),
      ).toBe(false);

      expect(() =>
        executeTransition({
          transactionId: dummyTxId,
          previousState: EscrowStatus.FUNDS_CONFIRMED,
          newState: EscrowStatus.CANCELLED,
          actorId: "buyer-1",
          actorRole: ActorRole.BUYER,
          timestamp: now,
          reason: "Direct cancellation after funds confirmed",
        }),
      ).toThrow(InvalidStateTransitionError);
    });

    it("allows expiration from AWAITING_PAYMENT by SYSTEM or ADMIN", () => {
      const exp = executeTransition({
        transactionId: dummyTxId,
        previousState: EscrowStatus.AWAITING_PAYMENT,
        newState: EscrowStatus.EXPIRED,
        actorId: "sys-1",
        actorRole: ActorRole.SYSTEM,
        timestamp: now,
        reason: "Payment window expired (48h limit reached)",
      });
      expect(exp.newState).toBe(EscrowStatus.EXPIRED);
    });

    it("prevents expiration from CREATED or active financial states", () => {
      expect(canTransition(EscrowStatus.CREATED, EscrowStatus.EXPIRED)).toBe(
        false,
      );
      expect(
        canTransition(EscrowStatus.FUNDS_CONFIRMED, EscrowStatus.EXPIRED),
      ).toBe(false);

      expect(() =>
        executeTransition({
          transactionId: dummyTxId,
          previousState: EscrowStatus.CREATED,
          newState: EscrowStatus.EXPIRED,
          actorId: "sys-1",
          actorRole: ActorRole.SYSTEM,
          timestamp: now,
          reason: "Premature expiration",
        }),
      ).toThrow(InvalidStateTransitionError);
    });
  });

  describe("assertTransition backward compatibility helper", () => {
    it("asserts valid transitions without error", () => {
      expect(() =>
        assertTransition(EscrowStatus.CREATED, EscrowStatus.AWAITING_PAYMENT),
      ).not.toThrow();
    });

    it("throws InvalidStateTransitionError on invalid non-terminal transitions", () => {
      expect(() =>
        assertTransition(EscrowStatus.CREATED, EscrowStatus.DELIVERED),
      ).toThrow(InvalidStateTransitionError);
    });

    it("throws TerminalStateError on terminal state transitions", () => {
      expect(() =>
        assertTransition(EscrowStatus.RELEASED, EscrowStatus.DISPUTED),
      ).toThrow(TerminalStateError);
    });
  });
});
