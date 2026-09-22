export class IdempotencyRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    async findByKeyAndScope(key, scope = "GLOBAL") {
        const sql = `
      SELECT * FROM idempotency_keys
      WHERE key = $1 AND scope = $2
    `;
        const res = await this.db.query(sql, [key, scope]);
        if (!res.rows[0])
            return null;
        const row = res.rows[0];
        const expiresAt = new Date(row.expires_at);
        if (expiresAt.getTime() <= Date.now()) {
            return null;
        }
        if (typeof row.response_body === "string") {
            try {
                row.response_body = JSON.parse(row.response_body);
            }
            catch (e) {
                // ignore
            }
        }
        return row;
    }
    async saveKey(data) {
        const scope = data.scope ?? "GLOBAL";
        const existing = await this.findByKeyAndScope(data.key, scope);
        const now = new Date();
        const ttlHours = data.ttlHours ?? 24;
        const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
        if (existing) {
            const updateSql = `
        UPDATE idempotency_keys
        SET response_status = $1, response_body = $2, expires_at = $3
        WHERE id = $4
        RETURNING *
      `;
            const res = await this.db.query(updateSql, [
                data.responseStatus,
                JSON.stringify(data.responseBody),
                expiresAt,
                existing.id,
            ]);
            return res.rows[0];
        }
        else {
            const id = crypto.randomUUID();
            const insertSql = `
        INSERT INTO idempotency_keys (
          id, key, scope, request_hash, response_status, response_body, created_at, expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `;
            const res = await this.db.query(insertSql, [
                id,
                data.key,
                scope,
                data.requestHash ?? null,
                data.responseStatus,
                JSON.stringify(data.responseBody),
                now,
                expiresAt,
            ]);
            return res.rows[0];
        }
    }
}
//# sourceMappingURL=idempotency.repository.js.map