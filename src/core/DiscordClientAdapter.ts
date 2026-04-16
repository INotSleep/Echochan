import { createAudioPlayer, createAudioResource, getVoiceConnection, joinVoiceChannel, type AudioPlayer, type CreateAudioPlayerOptions, type CreateAudioResourceOptions, type VoiceConnection } from "@discordjs/voice";
import type { Channel, Client, Guild, VoiceBasedChannel } from "discord.js";
import type { Stream } from "node:stream";

class DiscordClientAdapter {
    client: Client;

    constructor(client: Client) {
        this.client = client;
    }

    async fetchChannel(id: string): Promise<Channel | null> {
        return await this.client.channels.fetch(id);
    }

    async fetchGuild(id: string): Promise<Guild> {
        return await this.client.guilds.fetch(id);
    }

    joinVoiceChannel(channel: VoiceBasedChannel, selfDeaf: boolean = true, selfMute: boolean = false): VoiceConnection {
        return joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
            selfDeaf,
            selfMute
        });
    }

    createAudioPlayer(options: CreateAudioPlayerOptions = {}): AudioPlayer {
        return createAudioPlayer(options);
    }

    createAudioResource(input: string | Stream.Readable, options: CreateAudioResourceOptions<unknown> = {}) {
        return createAudioResource(input, options);
    }

    getVoiceConnection(guildId: string): VoiceConnection | undefined {
        return getVoiceConnection(guildId);
    }

    destroyVoiceConnection(guildId: string): void {
        const connection = this.getVoiceConnection(guildId);
        connection?.destroy();
    }
}

export {
    DiscordClientAdapter
};
