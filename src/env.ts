// Source - https://stackoverflow.com/a/53981706
// Posted by Karol Majewski, modified by community. See post 'Timeline' for change history
// Retrieved 2026-04-14, License - CC BY-SA 4.0

declare global {
    namespace NodeJS {
        interface ProcessEnv {
            BOT_TOKEN: string;

            POSTGRES_PASSWORD: string;
            POSTGRES_USER: string;
            POSTGRES_DB: string;
            POSTGRES_HOST: string;
            POSTGRES_PORT: string;
        }
    }
}

export {}
