import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export async function runMigrations(db) {
    const schemaDir = path.join(__dirname, "../schema");
    if (!fs.existsSync(schemaDir)) {
        throw new Error(`Schema directory not found: ${schemaDir}`);
    }
    const files = fs
        .readdirSync(schemaDir)
        .filter((f) => f.endsWith(".sql"))
        .sort();
    const executed = [];
    for (const file of files) {
        const filePath = path.join(schemaDir, file);
        const sql = fs.readFileSync(filePath, "utf-8");
        await db.query(sql);
        executed.push(file);
    }
    return executed;
}
//# sourceMappingURL=migrate.js.map