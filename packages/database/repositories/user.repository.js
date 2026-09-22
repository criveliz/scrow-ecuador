export class UserRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    async create(user) {
        const id = crypto.randomUUID();
        const now = new Date();
        const sql = `
      INSERT INTO users (id, email, phone, password_hash, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
        const params = [
            id,
            user.email,
            user.phone ?? null,
            user.password_hash,
            user.role,
            user.status,
            now,
            now,
        ];
        const res = await this.db.query(sql, params);
        if (res.rows.length > 0)
            return res.rows[0];
        throw new Error("Failed to create user record in database");
    }
    async findById(id) {
        const sql = `SELECT * FROM users WHERE id = $1`;
        const res = await this.db.query(sql, [id]);
        return res.rows[0] ?? null;
    }
    async findByEmail(email) {
        const sql = `SELECT * FROM users WHERE email = $1`;
        const res = await this.db.query(sql, [email]);
        return res.rows[0] ?? null;
    }
}
//# sourceMappingURL=user.repository.js.map