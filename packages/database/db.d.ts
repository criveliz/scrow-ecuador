import pg from "pg";
export interface DbQueryResult<T = any> {
    rows: T[];
    rowCount: number;
}
export interface DbClient {
    query<T = any>(sql: string, params?: any[]): Promise<DbQueryResult<T>>;
    transaction<T>(callback: (tx: DbClient) => Promise<T>): Promise<T>;
}
export declare class PgDbClient implements DbClient {
    private pool;
    constructor(config?: pg.PoolConfig);
    query<T = any>(sql: string, params?: any[]): Promise<DbQueryResult<T>>;
    transaction<T>(callback: (tx: DbClient) => Promise<T>): Promise<T>;
    close(): Promise<void>;
}
export declare class PgMemDbClient implements DbClient {
    private memDb;
    private client;
    constructor();
    query<T = any>(sql: string, params?: any[]): Promise<DbQueryResult<T>>;
    transaction<T>(callback: (tx: DbClient) => Promise<T>): Promise<T>;
}
export declare class InMemoryDbClient implements DbClient {
    private tables;
    constructor();
    private getTable;
    query<T = any>(sql: string, params?: any[]): Promise<DbQueryResult<T>>;
    transaction<T>(callback: (tx: DbClient) => Promise<T>): Promise<T>;
}
//# sourceMappingURL=db.d.ts.map