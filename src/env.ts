// Source - https://stackoverflow.com/a/53981706
// Posted by Karol Majewski, modified by community. See post 'Timeline' for change history
// Retrieved 2026-04-14, License - CC BY-SA 4.0

declare global {
    namespace NodeJS {
        interface ProcessEnv {
            BOT_TOKEN: string;
            BOT_CLIENT_ID: string;
            LOG_LEVEL: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
            PROVIDER_TIMEOUT_MS: string;
            DOWNLOAD_TIMEOUT_MS: string;
            YTDLP_BIN: string;
            FFMPEG_INSTALL_DIR: string;
            YTDLP_INSTALL_DIR: string;
            SPOTIFY_ACCESS_TOKEN: string;
            SPOTIFY_CLIENT_ID: string;
            SPOTIFY_CLIENT_SECRET: string;

            POSTGRES_PASSWORD: string;
            POSTGRES_USER: string;
            POSTGRES_DB: string;
            POSTGRES_HOST: string;
            POSTGRES_PORT: string;

            DEV_GUILD: string;
            DEV_VOICE_CHANNEL: string;
        }
    }
}

export {}
