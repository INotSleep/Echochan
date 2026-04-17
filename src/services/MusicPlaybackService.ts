import {
    AudioPlayerStatus,
    NoSubscriberBehavior,
    VoiceConnectionStatus,
    entersState,
    type AudioPlayer,
    type VoiceConnection
} from "@discordjs/voice";
import type { ChatInputCommandInteraction, GuildMember, VoiceBasedChannel } from "discord.js";
import type { DiscordClientAdapter } from "../core/DiscordClientAdapter.js";
import type { Logger } from "../core/Logger.js";

type TrackIdleListener = (guildId: string) => void;
type TrackErrorListener = (payload: { guildId: string; error: Error }) => void;

class MusicPlaybackService {
    private readonly adapter: DiscordClientAdapter;
    private readonly logger: Logger;
    private readonly guildPlayers = new Map<string, AudioPlayer>();
    private readonly guildTrackActive = new Map<string, boolean>();
    private readonly idleListeners = new Set<TrackIdleListener>();
    private readonly errorListeners = new Set<TrackErrorListener>();

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
            const existingState = existing.state.status;
            const isRecoverable =
                existingState === VoiceConnectionStatus.Ready ||
                existingState === VoiceConnectionStatus.Connecting ||
                existingState === VoiceConnectionStatus.Signalling;

            if (sameChannel && isRecoverable) {
                return existing;
            }

            existing.destroy();
        }

        return this.adapter.joinVoiceChannel(channel, false);
    }

    async waitUntilConnectionReady(connection: VoiceConnection, timeoutMs: number = 10_000): Promise<boolean> {
        try {
            await entersState(connection, VoiceConnectionStatus.Ready, timeoutMs);
            return true;
        } catch {
            return false;
        }
    }

    playSource(channel: VoiceBasedChannel, source: string): void {
        this.joinChannel(channel);
        const started = this.playInGuild(channel.guild.id, source);
        if (!started) {
            throw new Error(`No active voice connection for guild ${channel.guild.id}.`);
        }
    }

    playInGuild(guildId: string, source: string): boolean {
        const connection = this.adapter.getVoiceConnection(guildId);
        if (!connection) {
            return false;
        }

        const player = this.getOrCreatePlayer(guildId);
        const resource = this.adapter.createAudioResource(source);
        player.play(resource);
        connection.subscribe(player);
        this.guildTrackActive.set(guildId, true);
        return true;
    }

    stop(guildId: string): boolean {
        const player = this.guildPlayers.get(guildId);
        if (!player) {
            return false;
        }

        this.guildTrackActive.set(guildId, false);
        player.stop(true);
        return true;
    }

    pause(guildId: string): boolean {
        const player = this.guildPlayers.get(guildId);
        if (!player) {
            return false;
        }
        return player.pause();
    }

    resume(guildId: string): boolean {
        const player = this.guildPlayers.get(guildId);
        if (!player) {
            return false;
        }
        return player.unpause();
    }

    leave(guildId: string): boolean {
        const connection = this.adapter.getVoiceConnection(guildId);
        if (!connection) {
            return false;
        }

        connection.destroy();
        this.guildPlayers.delete(guildId);
        this.guildTrackActive.delete(guildId);
        return true;
    }

    onTrackIdle(listener: TrackIdleListener): () => void {
        this.idleListeners.add(listener);
        return () => {
            this.idleListeners.delete(listener);
        };
    }

    onTrackError(listener: TrackErrorListener): () => void {
        this.errorListeners.add(listener);
        return () => {
            this.errorListeners.delete(listener);
        };
    }

    hasGuildPlayer(guildId: string): boolean {
        return this.guildPlayers.has(guildId);
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
            const wasActive = this.guildTrackActive.get(guildId) ?? false;
            this.guildTrackActive.set(guildId, false);
            this.logger.debug(`Playback became idle in guild ${guildId}.`);
            if (!wasActive) {
                return;
            }

            for (const listener of this.idleListeners) {
                listener(guildId);
            }
        });

        player.on("error", (error) => {
            const typedError = error instanceof Error ? error : new Error(String(error));
            this.guildTrackActive.set(guildId, false);
            this.logger.error(`Playback error in guild ${guildId}:`, typedError);
            for (const listener of this.errorListeners) {
                listener({
                    guildId,
                    error: typedError
                });
            }
        });

        this.guildPlayers.set(guildId, player);
        return player;
    }
}

export {
    MusicPlaybackService
};
