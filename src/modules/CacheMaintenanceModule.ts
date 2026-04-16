import type { Module } from "../core/Module.js";
import type { DiscordClientAdapter } from "../core/DiscordClientAdapter.js";
import type { EventBus } from "../core/EventBus.js";
import type { Events } from "../core/Events.js";
import type { Logger } from "../core/Logger.js";
import type { ServiceRegistry } from "../core/ServiceRegistry.js";
import type { Storage } from "../core/Storage.js";
import { CacheManager } from "../playback/CacheManager.js";

class CacheMaintenanceModule implements Module {
    public readonly name = "cache-maintenance";
    public readonly logger: Logger;
    public readonly events: EventBus<Events>;
    public readonly services: ServiceRegistry;
    public readonly storage: Storage;
    public readonly adapter: DiscordClientAdapter;
    private cleanupTimer: ReturnType<typeof setInterval> | null = null;

    constructor(
        logger: Logger,
        events: EventBus<Events>,
        services: ServiceRegistry,
        storage: Storage,
        adapter: DiscordClientAdapter
    ) {
        this.logger = logger.child("Module").child("CacheMaintenance");
        this.events = events;
        this.services = services;
        this.storage = storage;
        this.adapter = adapter;
    }

    public async register(): Promise<void> {
        this.events.on("core.ready", () => {
            const cache = this.services.get<CacheManager>("cache");
            if (this.cleanupTimer) {
                return;
            }

            void cache.cleanup().catch((error) => {
                this.logger.warn("Initial cache cleanup failed:", error);
            });

            this.cleanupTimer = setInterval(() => {
                void cache.cleanup().catch((error) => {
                    this.logger.warn("Periodic cache cleanup failed:", error);
                });
            }, 60_000);

            this.logger.info("Periodic cache cleanup enabled (every 60s).");
        });
    }
}

export {
    CacheMaintenanceModule
};
