import { DbClient } from "../db.js";
import { User } from "../types/index.js";
export declare class UserRepository {
    private readonly db;
    constructor(db: DbClient);
    create(user: Omit<User, "id" | "created_at" | "updated_at">): Promise<User>;
    findById(id: string): Promise<User | null>;
    findByEmail(email: string): Promise<User | null>;
}
//# sourceMappingURL=user.repository.d.ts.map