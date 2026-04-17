import type { Command } from "../core/Command.js";
import { PlaybackCoordinator } from "../playback/PlaybackCoordinator.js";
import type { GuildQueueState, QueueEntry } from "../playback/types.js";
import { buildNoticeReply, buildQueuePanelReply } from "./ui/EchochanUi.js";

class NowPlayingCommand implements Command {
    public readonly name = "nowplaying";
    public readonly data = {
        name: "nowplaying",
        description: "Показать текущий трек и прогресс",
        dmPermission: false
    };

    public async execute(
        interaction: Parameters<Command["execute"]>[0],
        context: Parameters<Command["execute"]>[1]
    ): Promise<void> {
        if (!interaction.inGuild()) {
            await interaction.editReply(buildNoticeReply(interaction, {
                title: "Команда недоступна",
                description: "Команда работает только внутри сервера.",
                tone: "warning"
            }));
            return;
        }

        const coordinator = context.services.get<PlaybackCoordinator>("coordinator");
        const queue = coordinator.getQueue(interaction.guildId);
        const current = getCurrentEntry(queue);

        if (!current) {
            await interaction.editReply(buildQueuePanelReply(interaction, queue, {
                title: "Сейчас ничего не играет",
                note: "Очередь пуста. Добавь трек через `/play`.",
                tone: "warning",
                limit: 8
            }));
            return;
        }

        const durationMs = current.durationMs;
        const progressMs = coordinator.getPlaybackProgressMs(interaction.guildId);
        const progressLine = buildProgressLine(progressMs, durationMs, queue.playbackState);
        const artistLine = current.artists.length > 0
            ? `Артист: ${current.artists.join(", ")}`
            : "Артист: Unknown artist";
        const title = current.title ?? current.input;
        const note = [
            `Сейчас: ${title}`,
            artistLine,
            `Статус: ${queue.playbackState}`,
            progressLine
        ].join("\n");

        await interaction.editReply(buildQueuePanelReply(interaction, queue, {
            title: "Now Playing",
            note,
            tone: "info",
            limit: 8
        }));
    }
}

function getCurrentEntry(queue: GuildQueueState): QueueEntry | null {
    if (queue.currentIndex !== null) {
        const entry = queue.entries[queue.currentIndex];
        if (entry && entry.state !== "finished") {
            return entry;
        }
    }

    const firstVisible = queue.entries
        .filter((entry) => entry.state !== "finished")
        .sort((left, right) => left.position - right.position)[0];
    return firstVisible ?? null;
}

function buildProgressLine(
    progressMs: number | null,
    durationMs: number | null,
    playbackState: GuildQueueState["playbackState"]
): string {
    if (durationMs === null || durationMs <= 0 || progressMs === null) {
        return "Прогресс: [----------] --:-- / --:--";
    }

    const clamped = Math.max(0, Math.min(progressMs, durationMs));
    const ratio = durationMs > 0 ? clamped / durationMs : 0;
    const width = 10;
    const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
    const bar = `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`;
    const suffix = playbackState === "paused" ? " (paused)" : "";
    return `Прогресс: ${bar} ${formatDuration(clamped)} / ${formatDuration(durationMs)}${suffix}`;
}

function formatDuration(durationMs: number): string {
    if (durationMs <= 0) {
        return "00:00";
    }
    const totalSeconds = Math.floor(durationMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export {
    NowPlayingCommand
};
