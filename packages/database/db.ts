import pg from "pg";
import { DataType, newDb } from "pg-mem";

export interface DbQueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

export interface DbClient {
  query<T = any>(sql: string, params?: any[]): Promise<DbQueryResult<T>>;
  transaction<T>(callback: (tx: DbClient) => Promise<T>): Promise<T>;
}

export class PgDbClient implements DbClient {
  private pool: pg.Pool;

  constructor(config?: pg.PoolConfig) {
    this.pool = new pg.Pool(
      config ?? {
        connectionString:
          process.env.DATABASE_URL ||
          "postgresql://escrow_user:escrow_password@localhost:5432/escrow_db",
      }
    );
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<DbQueryResult<T>> {
    const res = await this.pool.query(sql, params);
    return {
      rows: res.rows as T[],
      rowCount: res.rowCount ?? res.rows.length,
    };
  }

  async transaction<T>(callback: (tx: DbClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const txClient: DbClient = {
        query: async <R = any>(sql: string, params: any[] = []): Promise<DbQueryResult<R>> => {
          const res = await client.query(sql, params);
          return { rows: res.rows as R[], rowCount: res.rowCount ?? res.rows.length };
        },
        transaction: async <R>(cb: (innerTx: DbClient) => Promise<R>): Promise<R> => {
          return cb(txClient);
        },
      };
      const result = await callback(txClient);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export class PgMemDbClient implements DbClient {
  private memDb: any;
  private client: any;

  constructor() {
    this.memDb = newDb();
    this.memDb.public.registerFunction({
      name: "gen_random_uuid",
      returns: DataType.uuid,
      implementation: () => crypto.randomUUID(),
    });
    const { Client } = this.memDb.adapters.createPg();
    this.client = new Client();
    this.client.connect();
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<DbQueryResult<T>> {
    const res = await this.client.query(sql, params);
    return {
      rows: (res.rows ?? []) as T[],
      rowCount: res.rowCount ?? res.rows?.length ?? 0,
    };
  }

  async transaction<T>(callback: (tx: DbClient) => Promise<T>): Promise<T> {
    try {
      await this.client.query("BEGIN");
      const result = await callback(this);
      await this.client.query("COMMIT");
      return result;
    } catch (err) {
      await this.client.query("ROLLBACK");
      throw err;
    }
  }
}

export class InMemoryDbClient implements DbClient {
  private tables: Map<string, any[]> = new Map();

  constructor() {}

  private getTable(tableName: string): any[] {
    const name = tableName.toLowerCase();
    if (!this.tables.has(name)) {
      this.tables.set(name, []);
    }
    return this.tables.get(name)!;
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<DbQueryResult<T>> {
    const norm = sql.replace(/\s+/g, " ").trim();
    const upper = norm.toUpperCase();

    // 1. INSERT INTO <table> (...) VALUES (...)
    if (upper.startsWith("INSERT INTO")) {
      const match = norm.match(/INSERT\s+INTO\s+([a-z0-9_]+)\s*\(([^)]+)\)/i);
      if (match) {
        const tableName = match[1].toLowerCase();
        const columns = match[2].split(",").map((c) => c.trim().toLowerCase());
        const row: Record<string, any> = {};

        for (let i = 0; i < columns.length; i++) {
          row[columns[i]] = params[i] !== undefined ? params[i] : null;
        }

        const table = this.getTable(tableName);
        table.push(row);
        return { rows: [row as T], rowCount: 1 };
      }
    }

    // 2. UPDATE <table> SET ... WHERE id = $...
    if (upper.startsWith("UPDATE")) {
      const matchTable = norm.match(/UPDATE\s+([a-z0-9_]+)/i);
      if (matchTable) {
        const tableName = matchTable[1].toLowerCase();
        const table = this.getTable(tableName);

        // Find match by id
        const idParamMatch = norm.match(/WHERE\s+id\s*=\s*\$(\d+)/i);
        let idVal: any = null;
        if (idParamMatch) {
          const paramIdx = parseInt(idParamMatch[1], 10) - 1;
          idVal = params[paramIdx];
        } else if (params.length > 0) {
          idVal = params[params.length - 1];
        }

        const row = table.find((r) => r.id === idVal);
        if (row) {
          if (tableName === "disputes") {
            row.status = params[0];
            row.resolved_by = params[1];
            row.resolution = params[2];
            row.resolved_at = params[3];
            row.updated_at = params[3];
          } else if (tableName === "escrow_transactions") {
            row.status = params[0];
            row.updated_at = params[1];
          }
          return { rows: [row as T], rowCount: 1 };
        }
      }
    }

    // 3. SELECT * FROM <table> ...
    if (upper.startsWith("SELECT")) {
      const matchTable = norm.match(/FROM\s+([a-z0-9_]+)/i);
      if (matchTable) {
        const tableName = matchTable[1].toLowerCase();
        const table = this.getTable(tableName);

        if (params.length === 0) {
          return { rows: [...table] as T[], rowCount: table.length };
        }

        // Extract condition pairs col_name = $N
        const condMatches = Array.from(norm.matchAll(/([a-z0-9_]+)\s*=\s*\$(\d+)/gi));
        if (condMatches.length > 0) {
          const filtered = table.filter((row) => {
            return condMatches.every((m) => {
              const colName = m[1].toLowerCase();
              const paramIdx = parseInt(m[2], 10) - 1;
              return row[colName] === params[paramIdx];
            });
          });
          return { rows: filtered as T[], rowCount: filtered.length };
        }

        return { rows: [...table] as T[], rowCount: table.length };
      }
    }

    return { rows: [], rowCount: 0 };
  }

  async transaction<T>(callback: (tx: DbClient) => Promise<T>): Promise<T> {
    return callback(this);
  }
}
