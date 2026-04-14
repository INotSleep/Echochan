import { Client, Events } from "discord.js";
import type { Logger } from "./Logger.js";
import type { Storage } from "./Storage.js";

class BotClient {
    client: Client;
    logger: Logger
    storage: Storage;
    
    constructor(logger: Logger, storage: Storage) {
        this.logger = logger;
        this.storage = storage;

        this.client = new Client({
            intents: [
                "GuildVoiceStates",
                "GuildMembers",
                "GuildMessageTyping",
                "Guilds",
                "MessageContent"
            ],
            presence: {
                status: "idle"
            }
        });

        this.registerEvents();
    }

    login() {
        return this.client.login(process.env.BOT_TOKEN);
    }

    registerEvents() {
        this.client.on(Events.ClientReady, () => {
            this.logger.info(`Logged in as ${this.client.user?.tag}`);
        });

        this.client.on(Events.Error, (error) => {
            this.logger.error("Client error:", error);
        }); 
    }
}

export { 
    BotClient
}