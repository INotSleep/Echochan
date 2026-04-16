import { AudioPlayerStatus, NoSubscriberBehavior, type AudioPlayer, type VoiceConnection } from "@discordjs/voice";
import type { ChatInputCommandInteraction, GuildMember, VoiceBasedChannel } from "discord.js";
import type { DiscordClientAdapter } from "../core/DiscordClientAdapter.js";
import type { Logger } from "../core/Logger.js";

class MusicPlaybackService {
    private readonly adapter: DiscordClientAdapter;
    private readonly logger: Logger;
    private readonly guildPlayers = new Map<string, AudioPlayer>();

    constructor(adapter: DiscordClientAdapter, logger: Logger) {
        this.adapter = adapter;
        this.logger = logger.child("MusicPlayback");
    }

    getMemberVoiceChannel(interaction: ChatInputCommandInteraction): VoiceBasedChannel | null {
        if (!interaction.inCachedGuild()) {
            return null;
        }

        const member = interaction.member as GuildMember;
        const channel = member.voice.channel;

        if (!channel || !channel.isVoiceBased()) {
            return null;
        }

        return channel;
    }

    joinChannel(channel: VoiceBasedChannel): VoiceConnection {
        const existing = this.adapter.getVoiceConnection(channel.guild.id);
        if (existing) {
            const sameChannel = existing.joinConfig.channelId === channel.id;
            if (sameChannel) {
                return existing;
            }

            existing.destroy();
        }

        return this.adapter.joinVoiceChannel(channel, false);
    }

    playFile(channel: VoiceBasedChannel, filePath: string): void {
        const connection = this.joinChannel(channel);
        const player = this.getOrCreatePlayer(channel.guild.id);
        const resource = this.adapter.createAudioResource(filePath);

        player.play(resource);
        connection.subscribe(player);
    }

    stop(guildId: string): boolean {
        const player = this.guildPlayers.get(guildId);
        if (!player) {
            return false;
        }

        player.stop(true);
        return true;
    }

    leave(guildId: string): boolean {
        const connection = this.adapter.getVoiceConnection(guildId);
        if (!connection) {
            return false;
        }

        connection.destroy();
        this.guildPlayers.delete(guildId);
        return true;
    }

    private getOrCreatePlayer(guildId: string): AudioPlayer {
        const existing = this.guildPlayers.get(guildId);
        if (existing) {
            return existing;
        }

        const player = this.adapter.createAudioPlayer({
            behaviors: {
                noSubscriber: NoSubscriberBehavior.Pause
            }
        });

        player.on(AudioPlayerStatus.Idle, () => {
            this.logger.debug(`Playback became idle in guild ${guildId}.`);
        });

        this.guildPlayers.set(guildId, player);
        return player;
    }
}

export {
    MusicPlaybackService
};
