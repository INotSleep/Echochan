import postgres from "postgres";

class Storage {
    private db: postgres.Sql;

    constructor() {
        this.db = postgres({
            host: process.env.POSTGRES_HOST,
            port: parseInt(process.env.POSTGRES_PORT || "5432"),
            user: process.env.POSTGRES_USER,
            password: process.env.POSTGRES_PASSWORD,
            database: process.env.POSTGRES_DB
        });
    }

    async init() {
        
    }
}

export {
    Storage
}