import { ApplicationCommandOptionType } from "discord.js";
import { access } from "node:fs/promises";
import path from "node:path";
import type { Command } from "../core/Command.js";
import { MusicPlaybackService } from "../services/MusicPlaybackService.js";
import { PlaybackCoordinator } from "../playback/PlaybackCoordinator.js";

class PlayCommand implements Command {
    public readonly name = "play";
    public readonly data = {
        name: "play",
        description: "Проиграть URL или локальный аудиофайл",
        dmPermission: false,
        options: [
            {
                name: "input",
                description: "URL или имя локального файла (по умолчанию audio.mp3)",
                type: ApplicationCommandOptionType.String as const,
                required: false
            }
        ]
    };

    public async execute(
        interaction: Parameters<Command["execute"]>[0],
        context: Parameters<Command["execute"]>[1]
    ): Promise<void> {
        const music = context.services.get<MusicPlaybackService>("music");
        const channel = music.getMemberVoiceChannel(interaction);

        if (!channel) {
            await interaction.editReply("Нужно быть в голосовом канале, чтобы включить музыку.");
            return;
        }

        const input = interaction.options.getString("input") ?? "audio.mp3";

        const localPath = this.tryResolveSafeLocalPath(input);
        if (localPath) {
            try {
                await access(localPath);
                music.playSource(channel, localPath);
                await interaction.editReply(`Воспроизвожу локальный файл \`${input}\` в **${channel.name}**.`);
                return;
            } catch {
                // fall through: if local file does not exist, try resolver as URL/query input.
            }
        }

        const coordinator = context.services.get<PlaybackCoordinator>("coordinator");
        try {
            music.joinChannel(channel);
            const result = await coordinator.enqueue({
                guildId: channel.guild.id,
                requestedBy: interaction.user.id,
                input,
                requestId: interaction.id
            });
            await coordinator.ensurePlayback(channel.guild.id);

            const playlistNote = result.sourceType === "spotify_playlist"
                ? ` Импортировано: **${result.addedCount}** треков${result.playlistTruncated ? " (обрезано лимитом)" : ""}.`
                : "";
            await interaction.editReply(`Добавил в очередь.${playlistNote}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Не удалось добавить трек в очередь.";
            await interaction.editReply(`Ошибка: ${message}`);
        }
    }

    private tryResolveSafeLocalPath(input: string): string | null {
        if (input.includes("..") || path.isAbsolute(input)) {
            return null;
        }

        const possibleUrl = this.safeUrl(input);
        if (possibleUrl) {
            return null;
        }

        const filePath = path.resolve(process.cwd(), input);
        return filePath;
    }

    private safeUrl(input: string): URL | null {
        try {
            return new URL(input);
        } catch {
            return null;
        }
    }
}

export {
    PlayCommand
};
