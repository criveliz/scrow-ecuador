import type { FiduciaryProvider, PaymentProvider } from "./interfaces.js";
export declare class MockPaymentProvider implements PaymentProvider {
    createPaymentIntent(input: {
        escrowId: string;
        amount: string;
        currency: "USD";
        idempotencyKey: string;
    }): Promise<{
        providerReference: string;
        amount: string;
        currency: "USD";
        status: "PENDING";
        paymentUrl: string;
    }>;
    verifyWebhook(input: {
        rawBody: string;
        signature: string;
    }): Promise<{
        eventId: string;
        eventType: string;
        payload: any;
    }>;
}
export declare class MockFiduciaryProvider implements FiduciaryProvider {
    verifyIncomingFunds(): Promise<{
        confirmed: boolean;
        providerReference: string;
    }>;
    requestRelease(input: {
        escrowId: string;
        amount: string;
        idempotencyKey: string;
    }): Promise<{
        providerReference: string;
        status: "PENDING";
    }>;
    requestRefund(input: {
        escrowId: string;
        amount: string;
        idempotencyKey: string;
    }): Promise<{
        providerReference: string;
        status: "PENDING";
    }>;
}
//# sourceMappingURL=mock.d.ts.map