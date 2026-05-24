import { ApplicationCommandOptionType, type AutocompleteInteraction } from "discord.js";
import type { Command } from "../core/Command.js";
import { buildNoticeReply, buildQueuePanelReply } from "./ui/EchochanUi.js";
import { MusicPlaybackService } from "../services/MusicPlaybackService.js";
import { PlaybackCoordinator } from "../playback/PlaybackCoordinator.js";
import { LocalResolverService } from "../services/LocalResolverService.js";

class PlayCommand implements Command {
    public readonly name = "play";
    public readonly data = {
        name: "play",
        description: "Добавить трек в очередь (YouTube, Spotify или поиск)",
        dmPermission: false,
        options: [
            {
                name: "input",
                description: "Ссылка или запрос (например: artist - track)",
                type: ApplicationCommandOptionType.String as const,
                required: true,
                autocomplete: true
            }
        ]
    };

    public async autocomplete(
        interaction: AutocompleteInteraction,
        context: Parameters<Command["execute"]>[1]
    ): Promise<void> {
        const focused = interaction.options.getFocused(true);
        if (focused.name !== "input" || focused.type !== ApplicationCommandOptionType.String) {
            await interaction.respond([]);
            return;
        }

        const query = String(focused.value ?? "").trim();
        if (query.length < 2) {
            await interaction.respond([]);
            return;
        }

        const resolver = context.services.get<LocalResolverService>("resolver");
        const suggestions = await resolver.suggestTracks(query, 10);
        await interaction.respond(suggestions.slice(0, 25));
    }

    public async execute(
        interaction: Parameters<Command["execute"]>[0],
        context: Parameters<Command["execute"]>[1]
    ): Promise<void> {
        const music = context.services.get<MusicPlaybackService>("music");
        const channel = music.getMemberVoiceChannel(interaction);

        if (!channel) {
            await interaction.editReply(buildNoticeReply(interaction, {
                title: "Нужен голосовой канал",
                description: "Зайди в голосовой канал, и я сразу начну подготовку трека.",
                tone: "warning"
            }));
            return;
        }

        const input = interaction.options.getString("input", true).trim();
        if (!input) {
            await interaction.editReply(buildNoticeReply(interaction, {
                title: "Нужен источник трека",
                description: "Передай ссылку YouTube/Spotify или текстовый запрос.",
                tone: "warning"
            }));
            return;
        }

        const coordinator = context.services.get<PlaybackCoordinator>("coordinator");
        try {
            const connection = music.joinChannel(channel);
            const voiceReady = await music.waitUntilConnectionReady(connection, 12_000);
            const result = await coordinator.enqueue({
                guildId: channel.guild.id,
                requestedBy: interaction.user.id,
                input,
                requestId: interaction.id
            });

            void coordinator.ensurePlayback(channel.guild.id);

            const firstEntryId = result.entryIds[0] ?? null;
            if (firstEntryId) {
                await sleep(500);
            }
            const trackedEntry = firstEntryId
                ? coordinator.getEntry(channel.guild.id, firstEntryId)
                : null;
            const statusLine = trackedEntry
                ? `Статус: ${describeEntryState(trackedEntry.state)}`
                : "Статус: добавлено в очередь.";
            const artistLine = trackedEntry && trackedEntry.artists.length > 0
                ? `Артист: ${trackedEntry.artists.join(", ")}.`
                : "";
            const positionLine = trackedEntry
                ? `Позиция в очереди: ${trackedEntry.position + 1}.`
                : "";
            const voiceLine = voiceReady
                ? ""
                : " Голосовое соединение ещё поднимается, старт может занять немного времени.";
            const playlistNote = result.sourceType === "spotify_playlist" || result.sourceType === "spotify_album"
                ? ` Импортировано: **${result.addedCount}** треков${result.playlistTruncated ? " (обрезано лимитом)" : ""}.`
                : "";
            const queue = coordinator.getQueue(channel.guild.id);
            await interaction.editReply(buildQueuePanelReply(interaction, queue, {
                title: "Трек добавлен",
                note: `Добавила в очередь.${playlistNote} ${positionLine} ${statusLine} ${artistLine}${voiceLine}`.trim(),
                tone: "success"
            }));
        } catch (error) {
            const message = error instanceof Error ? error.message : "Не удалось добавить трек в очередь.";
            await interaction.editReply(buildNoticeReply(interaction, {
                title: "Не удалось добавить трек",
                description: message,
                tone: "error"
            }));
        }
    }

}

function describeEntryState(state: string): string {
    if (state === "queued") return "в очереди";
    if (state === "resolving_meta") return "загрузка метаданных...";
    if (state === "resolved") return "метаданные готовы";
    if (state === "warming") return "загрузка аудио...";
    if (state === "ready") return "аудио готово к старту";
    if (state === "playing") return "воспроизведение запущено";
    if (state === "finished") return "завершено";
    if (state === "failed") return "ошибка подготовки";
    return state;
}

async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

export {
    PlayCommand
};
