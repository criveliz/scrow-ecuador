import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { DbClient } from "../db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(db: DbClient): Promise<string[]> {
  const schemaDir = path.join(__dirname, "../schema");
  if (!fs.existsSync(schemaDir)) {
    throw new Error(`Schema directory not found: ${schemaDir}`);
  }

  const files = fs
    .readdirSync(schemaDir)
    .filter((f: string) => f.endsWith(".sql"))
    .sort();

  const executed: string[] = [];

  for (const file of files) {
    const filePath = path.join(schemaDir, file);
    const sql = fs.readFileSync(filePath, "utf-8");
    await db.query(sql);
    executed.push(file);
  }

  return executed;
}
