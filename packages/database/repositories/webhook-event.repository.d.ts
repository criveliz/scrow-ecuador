import { DbClient } from "../db.js";
import { WebhookEvent } from "../types/index.js";
export declare class WebhookEventRepository {
    private readonly db;
    constructor(db: DbClient);
    recordEvent(data: Omit<WebhookEvent, "id" | "received_at">): Promise<WebhookEvent>;
    findByProviderAndEventId(provider: string, eventId: string): Promise<WebhookEvent | null>;
}
//# sourceMappingURL=webhook-event.repository.d.ts.map