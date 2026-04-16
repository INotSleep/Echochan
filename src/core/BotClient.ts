import { Client, Events } from "discord.js";
import type { Logger } from "./Logger.js";
import type { Storage } from "./Storage.js";
import type { Module } from "./Module.js";
import type { EventBus } from "./EventBus.js";
import type { Events as EchochanEvents } from "./Events.js";
import type { ServiceRegistry } from "./ServiceRegistry.js";
import { DiscordClientAdapter } from "./DiscordClientAdapter.js";
import { CommandRegistry } from "./Command.js";
import { createCommands } from "../commands/index.js";
import { MusicPlaybackService } from "../services/MusicPlaybackService.js";

class BotClient {
    client: Client;
    logger: Logger
    storage: Storage;
    modules: Module[] = [];
    events: EventBus<EchochanEvents>;
    services: ServiceRegistry;
    adapter: DiscordClientAdapter;
    commands: CommandRegistry;

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
        this.commands = new CommandRegistry(this.client, this.logger, this.storage, this.events, this.services, this.adapter);
        this.commands.attachInteractionListener();
        this.services.register("music", new MusicPlaybackService(this.adapter, this.logger.child("Music")));

        this.registerCommands();
        this.registerEvents();
        this.registerModules();
    }

    login() {
        return this.client.login(process.env.BOT_TOKEN);
    }

    registerEvents() {
        this.client.on(Events.ClientReady, async() => {
            this.logger.info(`Logged in as ${this.client.user?.tag}`);

            try {
                await this.events.emit("core.ready");
            } catch (error) {
                this.logger.error("Failed to finish ready lifecycle:", error);
            }
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
        void module.register().catch((error) => {
            this.logger.error(`Failed to register module ${module.name}:`, error);
        });
    }

    registerModules() {

    }

    registerCommands() {
        this.commands.registerMany(createCommands());
    }
}

export { 
    BotClient
}
