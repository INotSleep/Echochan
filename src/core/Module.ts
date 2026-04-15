import type { EventBus } from "./EventBus.js";
import type { Events } from "./Events.js";
import type { Logger } from "./Logger.js";
import type { ServiceRegistry } from "./ServiceRegistry.js";
import type { Storage } from "./Storage.js";

interface Module {
    name: string;
    logger: Logger;
    events: EventBus<Events>;
    services: ServiceRegistry;
    storage: Storage;

    register(logger: Logger, events: EventBus<Events>, services: ServiceRegistry, storage: Storage): Promise<void>;
}

export type {
    Module
}