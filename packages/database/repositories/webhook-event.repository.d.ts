import { DbClient } from "../db.js";
import { WebhookEvent } from "../types/index.js";
/**
 * Sanitizes payload object to prevent storing PAN, CVV, or authentication tokens.
 */
export declare function sanitizePayload<T>(input: T): T;
export declare class WebhookEventRepository {
    private readonly db;
    constructor(db: DbClient);
    /**
     * Atomically records a webhook event, sanitizing payload.
     * If event (provider, event_id) already exists, returns existing event with `isDuplicate: true`.
     */
    recordEvent(data: Omit<WebhookEvent, "id" | "received_at">): Promise<{
        event: WebhookEvent;
        isDuplicate: boolean;
    }>;
    findByProviderAndEventId(provider: string, eventId: string): Promise<WebhookEvent | null>;
    updateStatus(id: string, status: string, errorMessage?: string): Promise<WebhookEvent>;
}
//# sourceMappingURL=webhook-event.repository.d.ts.map