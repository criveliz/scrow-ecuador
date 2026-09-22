import { DbClient } from "../db.js";
import { IdempotencyKeyRecord } from "../types/index.js";
export declare class IdempotencyRepository {
    private readonly db;
    constructor(db: DbClient);
    findByKeyAndScope(key: string, scope?: string): Promise<IdempotencyKeyRecord | null>;
    saveKey(data: {
        key: string;
        scope?: string;
        requestHash?: string | null;
        responseStatus: number;
        responseBody: Record<string, unknown>;
        ttlHours?: number;
    }): Promise<IdempotencyKeyRecord>;
}
//# sourceMappingURL=idempotency.repository.d.ts.map