import type { Module } from "../core/Module.js";
import type { DiscordClientAdapter } from "../core/DiscordClientAdapter.js";
import type { EventBus } from "../core/EventBus.js";
import type { Events } from "../core/Events.js";
import type { Logger } from "../core/Logger.js";
import type { ServiceRegistry } from "../core/ServiceRegistry.js";
import type { Storage } from "../core/Storage.js";

class PlaybackDiagnosticsModule implements Module {
    public readonly name = "playback-diagnostics";
    public readonly logger: Logger;
    public readonly events: EventBus<Events>;
    public readonly services: ServiceRegistry;
    public readonly storage: Storage;
    public readonly adapter: DiscordClientAdapter;

    constructor(
        logger: Logger,
        events: EventBus<Events>,
        services: ServiceRegistry,
        storage: Storage,
        adapter: DiscordClientAdapter
    ) {
        this.logger = logger.child("Module").child("PlaybackDiagnostics");
        this.events = events;
        this.services = services;
        this.storage = storage;
        this.adapter = adapter;
    }

    public async register(): Promise<void> {
        this.events.on("track_started", ({ guildId, entryId }) => {
            this.logger.info(`Track started. guild=${guildId} entry=${entryId}`);
        });
        this.events.on("track_finished", ({ guildId, entryId }) => {
            this.logger.info(`Track finished. guild=${guildId} entry=${entryId}`);
        });
        this.events.on("track_failed", ({ guildId, entryId, reason }) => {
            this.logger.warn(`Track failed. guild=${guildId} entry=${entryId} reason=${reason}`);
        });
        this.events.on("prefetch_started", ({ guildId, entryId, jobId }) => {
            this.logger.debug(`Prefetch started. guild=${guildId} entry=${entryId} job=${jobId}`);
        });
        this.events.on("prefetch_cancelled", ({ guildId, entryId, jobId }) => {
            this.logger.debug(`Prefetch cancelled. guild=${guildId} entry=${entryId} job=${jobId}`);
        });
    }
}

export {
    PlaybackDiagnosticsModule
};
