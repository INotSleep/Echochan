import { Client, Events } from "discord.js";
import type { Logger } from "./Logger.js";
import type { Storage } from "./Storage.js";
import type { Module } from "./Module.js";
import type { EventBus } from "./EventBus.js";
import type { Events as EchochanEvents } from "./Events.js";
import type { ServiceRegistry } from "./ServiceRegistry.js";

class BotClient {
    client: Client;
    logger: Logger
    storage: Storage;
    modules: Module[] = [];
    events: EventBus<EchochanEvents>;
    services: ServiceRegistry;

    constructor(logger: Logger, storage: Storage, events: EventBus<EchochanEvents>, services: ServiceRegistry) {
        this.logger = logger;
        this.storage = storage;
        this.events = events;
        this.services = services;

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

    registerModule(module: Module) {
        this.modules.push(module);
        module.register(this.logger.child(module.name), this.events, this.services, this.storage);
    }
}

export { 
    BotClient
}