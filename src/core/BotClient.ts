import { Client, Events } from "discord.js";
import type { Logger } from "./Logger.js";
import type { Storage } from "./Storage.js";
import type { Module } from "./Module.js";
import type { EventBus } from "./EventBus.js";
import type { Events as EchochanEvents } from "./Events.js";
import type { ServiceRegistry } from "./ServiceRegistry.js";
import { TestModule } from "../modules/TestModule.js";
import { DiscordClientAdapter } from "./DiscordClientAdapter.js";

class BotClient {
    client: Client;
    logger: Logger
    storage: Storage;
    modules: Module[] = [];
    events: EventBus<EchochanEvents>;
    services: ServiceRegistry;
    adapter: DiscordClientAdapter;

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

        
        this.adapter = new DiscordClientAdapter(this.client);

        this.registerEvents();
        this.registerModules();
    }

    login() {
        return this.client.login(process.env.BOT_TOKEN);
    }

    registerEvents() {
        this.client.on(Events.ClientReady, () => {
            this.logger.info(`Logged in as ${this.client.user?.tag}`);
            this.events.emit("core.ready");
        });

        this.client.on(Events.Error, (error) => {
            this.logger.error("Client error:", error);
        }); 
    }

    registerModule<T extends Module>(
        TypeRef: new (
            logger: Logger,
            events: EventBus<EchochanEvents>,
            services: ServiceRegistry,
            storage: Storage,
            adapter: DiscordClientAdapter
        ) => T
    ) {
        const module = new TypeRef(this.logger, this.events, this.services, this.storage, this.adapter);
        this.modules.push(module);
        module.register();
    }

    registerModules() {
        this.registerModule(TestModule);
    }
}

export { 
    BotClient
}