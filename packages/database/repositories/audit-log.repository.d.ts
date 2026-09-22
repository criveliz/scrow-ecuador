import { DbClient } from "../db.js";
import { AuditLog } from "../types/index.js";
export declare class AuditLogRepository {
    private readonly db;
    constructor(db: DbClient);
    create(data: Omit<AuditLog, "id" | "created_at">): Promise<AuditLog>;
    findByEntity(entityType: string, entityId: string): Promise<AuditLog[]>;
}
//# sourceMappingURL=audit-log.repository.d.ts.map