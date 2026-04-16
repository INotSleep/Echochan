import { ApplicationCommandOptionType } from "discord.js";
import { access } from "node:fs/promises";
import path from "node:path";
import type { Command } from "../core/Command.js";
import type { ResolveCandidate } from "../resolver/contracts.js";
import type { ResolverClient } from "../resolver/client/ResolverClient.js";
import { MusicPlaybackService } from "../services/MusicPlaybackService.js";
import { LocalResolverError } from "../services/LocalResolverService.js";

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

        const resolver = context.services.get<ResolverClient>("resolver");
        try {
            const result = await resolver.resolve({
                input,
                requestedBy: interaction.user.id,
                requestId: interaction.id
            });

            const firstEntry = result.entries[0];
            if (!firstEntry) {
                await interaction.editReply("Резолвер не вернул ни одного трека.");
                return;
            }

            const candidate = pickPlayableCandidate(firstEntry.candidates);
            if (!candidate || !candidate.url) {
                await interaction.editReply("Для этого трека не найден playable URL у кандидатов резолва.");
                return;
            }

            music.playSource(channel, candidate.url);
            const title = firstEntry.title ?? "Unknown title";
            await interaction.editReply(
                `Воспроизвожу: **${title}** (source: \`${result.sourceType}\`, provider: \`${candidate.provider}\`) в **${channel.name}**.`
            );
        } catch (error) {
            if (error instanceof LocalResolverError) {
                await interaction.editReply(`Ошибка резолвера: \`${error.code}\` — ${error.message}`);
                return;
            }

            await interaction.editReply("Не удалось обработать input для резолва.");
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

function pickPlayableCandidate(candidates: ResolveCandidate[]): ResolveCandidate | null {
    const streamWithUrl = candidates.find((candidate) => candidate.kind === "stream" && candidate.url);
    if (streamWithUrl) {
        return streamWithUrl;
    }

    const downloadWithUrl = candidates.find((candidate) => candidate.kind === "download" && candidate.url);
    if (downloadWithUrl) {
        return downloadWithUrl;
    }

    return null;
}

export {
    PlayCommand
};
