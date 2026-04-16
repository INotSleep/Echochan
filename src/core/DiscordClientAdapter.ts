import { createAudioPlayer, joinVoiceChannel, VoiceConnection, type CreateAudioPlayerOptions, type CreateAudioResourceOptions } from "@discordjs/voice";
import type { Client, Guild, Snowflake, VoiceBasedChannel } from "discord.js";
import type { group } from "node:console";
import type { Stream } from "node:stream";

class DiscordClientAdapter {
    client: Client;

    constructor(client: Client) {
        this.client = client;
    }

    async fetchChannel(id: string) {
        return await this.client.channels.fetch(id);
    }

    async fetchGuild(id: string) {
        return await this.client.guilds.fetch(id);
    }

    async joinVoiceChannel(channel: VoiceBasedChannel, selfDeaf: boolean = true, selfMute: boolean = false) {
        return joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
            selfDeaf,
            selfMute
        });
    }

    async createAudioPlayer(options: CreateAudioPlayerOptions = {}) {
        return createAudioPlayer(options);
    }

    async createAudioResource(input: string | Stream.Readable, options: CreateAudioResourceOptions<unknown> = {}) {
        const { createAudioResource } = await import("@discordjs/voice");
        return createAudioResource(input, options);
    }
}

export {
    DiscordClientAdapter
};