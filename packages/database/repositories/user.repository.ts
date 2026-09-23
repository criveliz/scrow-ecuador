import { DbClient } from "../db.js";
import { User } from "../types/index.js";

export class UserRepository {
  constructor(private readonly db: DbClient) {}

  async create(
    user: Omit<User, "id" | "created_at" | "updated_at">,
  ): Promise<User> {
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

    const res = await this.db.query<User>(sql, params);
    if (res.rows.length > 0) return res.rows[0];

    throw new Error("Failed to create user record in database");
  }

  async findById(id: string): Promise<User | null> {
    const sql = `SELECT * FROM users WHERE id = $1`;
    const res = await this.db.query<User>(sql, [id]);
    return res.rows[0] ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const sql = `SELECT * FROM users WHERE email = $1`;
    const res = await this.db.query<User>(sql, [email]);
    return res.rows[0] ?? null;
  }
}
