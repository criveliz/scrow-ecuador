export class MockPaymentProvider {
    async createPaymentIntent(input) {
        return {
            providerReference: `mock-pay-${input.escrowId}`,
            amount: input.amount,
            currency: input.currency,
            status: "PENDING",
            paymentUrl: `http://localhost:3000/pay/${input.escrowId}`,
        };
    }
    async verifyWebhook(input) {
        if (!input.signature)
            throw new Error("Missing mock webhook signature");
        return {
            eventId: `mock-event-${Date.now()}`,
            eventType: "payment.succeeded",
            payload: JSON.parse(input.rawBody),
        };
    }
}
export class MockFiduciaryProvider {
    async verifyIncomingFunds() {
        return { confirmed: true, providerReference: "mock-funds-confirmed" };
    }
    async requestRelease(input) {
        return {
            providerReference: `mock-release-${input.escrowId}`,
            status: "PENDING",
        };
    }
    async requestRefund(input) {
        return {
            providerReference: `mock-refund-${input.escrowId}`,
            status: "PENDING",
        };
    }
}
//# sourceMappingURL=mock.js.map