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
import { LocalResolverService } from "../services/LocalResolverService.js";
import { BinaryDownloadService } from "../services/BinaryDownloadService.js";
import { QueueService } from "../playback/QueueService.js";
import { CacheManager } from "../playback/CacheManager.js";
import { PlaybackCoordinator } from "../playback/PlaybackCoordinator.js";
import { CacheMaintenanceModule } from "../modules/CacheMaintenanceModule.js";
import { PlaybackDiagnosticsModule } from "../modules/PlaybackDiagnosticsModule.js";

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
        const music = new MusicPlaybackService(this.adapter, this.logger.child("Music"));
        const resolver = new LocalResolverService({
            timeoutMs: parseInt(process.env.PROVIDER_TIMEOUT_MS || "15000", 10)
        });
        const downloader = new BinaryDownloadService({
            downloadTimeoutMs: parseInt(process.env.DOWNLOAD_TIMEOUT_MS || "120000", 10)
        });
        const queue = new QueueService(this.events, this.logger.child("Playback"));
        const cache = new CacheManager(this.events, this.logger.child("Playback"));
        const coordinator = new PlaybackCoordinator(
            this.events,
            this.logger.child("Playback"),
            queue,
            cache,
            resolver,
            downloader,
            music
        );

        this.services.register("music", music);
        this.services.register("resolver", resolver);
        this.services.register("downloader", downloader);
        this.services.register("queue", queue);
        this.services.register("cache", cache);
        this.services.register("coordinator", coordinator);

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
        this.registerModule(CacheMaintenanceModule);
        this.registerModule(PlaybackDiagnosticsModule);
    }

    registerCommands() {
        this.commands.registerMany(createCommands());
    }
}

export { 
    BotClient
}
