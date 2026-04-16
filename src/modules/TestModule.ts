import type { VoiceBasedChannel } from "discord.js";
import type { DiscordClientAdapter } from "../core/DiscordClientAdapter.js";
import type { EventBus } from "../core/EventBus.js";
import type { Events } from "../core/Events.js";
import type { Logger } from "../core/Logger.js";
import type { Module } from "../core/Module.js";
import type { ServiceRegistry } from "../core/ServiceRegistry.js";
import type { Storage } from "../core/Storage.js";

class TestModule implements Module {
    name: string = "TestModule";
    logger: Logger;
    events: EventBus<Events>;
    services: ServiceRegistry;
    storage: Storage;
    adapter: DiscordClientAdapter;

    constructor(logger: Logger, events: EventBus<Events>, services: ServiceRegistry, storage: Storage, adapter: DiscordClientAdapter) {
        this.logger = logger;
        this.events = events;
        this.services = services;
        this.storage = storage;
        this.adapter = adapter;
    }

    async register() {
        this.events.on("core.ready", async() => {
            const channel = await this.adapter.fetchChannel(process.env.DEV_VOICE_CHANNEL);
            if (channel && channel.isVoiceBased()) {
                this.logger.info(`Fetched channel: ${channel.name}`);
                const voiceChannel = channel as VoiceBasedChannel;

                const connection = await this.adapter.joinVoiceChannel(voiceChannel, false);
                const player = await this.adapter.createAudioPlayer();

                const resource = await this.adapter.createAudioResource("audio.mp3");
                player.play(resource);
                
                
                connection.subscribe(player);
            }
        });

        
        this.logger.info("TestModule registered");
    }
}

export {
    TestModule
};