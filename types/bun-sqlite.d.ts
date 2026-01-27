declare module "bun:sqlite" {
  export class Database {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      run: (...params: any[]) => void;
      get: (...params: any[]) => any;
      all: (...params: any[]) => any[];
    };
    query(sql: string): {
      run: (...params: any[]) => void;
      get: (...params: any[]) => any;
      all: (...params: any[]) => any[];
    };
    transaction<T>(fn: () => T): () => T;
  }
}
