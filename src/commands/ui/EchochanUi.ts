import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    type ButtonInteraction,
    type ChatInputCommandInteraction
} from "discord.js";
import type { GuildQueueState, LoopMode, QueueEntry, QueueEntryState } from "../../playback/types.js";

type EchochanTone = "info" | "success" | "warning" | "error";
type EchochanInteraction = ChatInputCommandInteraction | ButtonInteraction;

type EchochanControlAction =
    | "pause_resume"
    | "skip"
    | "loop"
    | "shuffle"
    | "refresh"
    | "stop";

type QueuePanelOptions = {
    title?: string;
    note?: string;
    limit?: number;
    tone?: EchochanTone;
};

type NoticeOptions = {
    title: string;
    description: string;
    tone?: EchochanTone;
    queue?: GuildQueueState | null;
    includeControls?: boolean;
};

const CONTROL_PREFIX = "echochan:control:";

function buildNoticeReply(
    interaction: EchochanInteraction,
    options: NoticeOptions
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
    const queue = options.queue ?? null;
    const includeControls = options.includeControls ?? false;
    const embed = createBaseEmbed(interaction, options.title, options.description, options.tone ?? "info");

    return {
        embeds: [embed],
        components: includeControls && queue ? buildQueueControlRows(queue) : []
    };
}

function buildQueuePanelReply(
    interaction: EchochanInteraction,
    queue: GuildQueueState,
    options: QueuePanelOptions = {}
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
    const embed = buildQueueEmbed(interaction, queue, options);
    return {
        embeds: [embed],
        components: buildQueueControlRows(queue)
    };
}

function buildQueueEmbed(
    interaction: EchochanInteraction,
    queue: GuildQueueState,
    options: QueuePanelOptions = {}
): EmbedBuilder {
    const title = options.title ?? "Очередь Echochan";
    const limit = options.limit ?? 8;
    const tone = options.tone ?? "info";
    const visible = getVisibleQueueEntries(queue.entries, queue.currentIndex);
    const embed = createBaseEmbed(interaction, title, options.note ?? "", tone);
    const summaryLine = [
        `Статус: ${formatPlaybackState(queue.playbackState)}`,
        `Цикл: ${formatLoopMode(queue.loopMode)}`,
        `Шафл: ${queue.shuffleEnabled ? "вкл" : "выкл"}`,
        `Треков: ${visible.length}`
    ].join(" | ");

    if (visible.length === 0) {
        embed.setDescription([
            options.note?.trim(),
            "Сейчас очередь пустая. Добавь трек через `/play`."
        ].filter((part) => Boolean(part)).join("\n\n"));
        embed.addFields({
            name: "Сводка",
            value: summaryLine
        });
        embed.setFooter({
            text: `Музыка готова к запуску`
        });
        return embed;
    }

    const current = visible[0] ?? null;
    embed.addFields({
        name: "Сводка",
        value: summaryLine
    });

    if (current) {
        embed.addFields({
            name: "Сейчас",
            value: formatCurrentEntry(current)
        });
    }

    const upcoming = visible.slice(1, limit + 1);
    if (upcoming.length > 0) {
        const upcomingLines = upcoming.map((entry, idx) => {
            const queuePosition = idx + 2;
            return formatEntryLine(entry, queuePosition);
        });
        embed.addFields({
            name: "Дальше",
            value: upcomingLines.join("\n")
        });
    }

    const hiddenCount = Math.max(0, visible.length - (upcoming.length + 1));
    if (hiddenCount > 0) {
        embed.addFields({
            name: "Хвост",
            value: `... и ещё ${hiddenCount} трек(ов) в очереди.`
        });
    }

    if (options.note && options.note.trim().length > 0) {
        embed.setDescription(options.note);
    }

    embed.setFooter({
        text: `Позиция: ${queue.currentIndex === null ? "-" : queue.currentIndex + 1} | Обновлено`
    });

    return embed;
}

function buildQueueControlRows(queue: GuildQueueState): ActionRowBuilder<ButtonBuilder>[] {
    const empty = queue.entries.length === 0;
    const isPaused = queue.playbackState === "paused";
    const pauseLabel = isPaused ? "Продолжить" : "Пауза";
    const pauseStyle = isPaused ? ButtonStyle.Success : ButtonStyle.Primary;
    const loopLabel = `Цикл: ${queue.loopMode}`;
    const shuffleLabel = `Шафл: ${queue.shuffleEnabled ? "вкл" : "выкл"}`;
    const shuffleStyle = queue.shuffleEnabled ? ButtonStyle.Success : ButtonStyle.Secondary;
    const loopStyle = queue.loopMode === "off" ? ButtonStyle.Secondary : ButtonStyle.Success;

    const primaryRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        buildControlButton("pause_resume", pauseLabel, pauseStyle, empty),
        buildControlButton("skip", "Пропуск", ButtonStyle.Secondary, empty),
        buildControlButton("loop", loopLabel, loopStyle, empty),
        buildControlButton("shuffle", shuffleLabel, shuffleStyle, empty),
        buildControlButton("refresh", "Обновить", ButtonStyle.Secondary, false)
    );

    const dangerRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        buildControlButton("stop", "Стоп", ButtonStyle.Danger, empty)
    );

    return [primaryRow, dangerRow];
}

function buildControlButton(
    action: EchochanControlAction,
    label: string,
    style: ButtonStyle,
    disabled: boolean
): ButtonBuilder {
    return new ButtonBuilder()
        .setCustomId(getControlCustomId(action))
        .setLabel(label)
        .setStyle(style)
        .setDisabled(disabled);
}

function getControlCustomId(action: EchochanControlAction): string {
    return `${CONTROL_PREFIX}${action}`;
}

function isEchochanControlCustomId(value: string): boolean {
    return value.startsWith(CONTROL_PREFIX);
}

function parseEchochanControlAction(value: string): EchochanControlAction | null {
    if (!isEchochanControlCustomId(value)) {
        return null;
    }

    const action = value.slice(CONTROL_PREFIX.length);
    if (
        action === "pause_resume"
        || action === "skip"
        || action === "loop"
        || action === "shuffle"
        || action === "refresh"
        || action === "stop"
    ) {
        return action;
    }

    return null;
}

function getVisibleQueueEntries(entries: QueueEntry[], currentIndex: number | null): QueueEntry[] {
    const currentStart = currentIndex ?? 0;
    return entries
        .filter((entry) => entry.state !== "finished")
        .sort((left, right) => {
            const leftCurrent = left.position === currentStart ? 0 : 1;
            const rightCurrent = right.position === currentStart ? 0 : 1;
            if (leftCurrent !== rightCurrent) {
                return leftCurrent - rightCurrent;
            }
            return left.position - right.position;
        });
}

function nextLoopMode(current: LoopMode): LoopMode {
    if (current === "off") {
        return "track";
    }
    if (current === "track") {
        return "queue";
    }
    return "off";
}

function describeEntryState(state: QueueEntryState): string {
    if (state === "queued") return "в очереди";
    if (state === "resolving_meta") return "поиск метаданных";
    if (state === "resolved") return "метаданные готовы";
    if (state === "warming") return "подготовка аудио";
    if (state === "ready") return "готово";
    if (state === "playing") return "играет";
    if (state === "finished") return "завершено";
    return "ошибка";
}

function formatEntryLine(entry: QueueEntry, position: number): string {
    const title = clampText(entry.title ?? entry.input, 56);
    const artists = clampText(entry.artists.length > 0 ? entry.artists.join(", ") : "Неизвестный артист", 32);
    const duration = formatDuration(entry.durationMs);
    const state = describeEntryState(entry.state);
    return `\`${position.toString().padStart(2, "0")}.\` **${title}** — ${artists} · ${duration} · ${state}`;
}

function formatCurrentEntry(entry: QueueEntry): string {
    const title = clampText(entry.title ?? entry.input, 80);
    const artists = clampText(entry.artists.length > 0 ? entry.artists.join(", ") : "Неизвестный артист", 64);
    const duration = formatDuration(entry.durationMs);
    const state = describeEntryState(entry.state);
    const requestedBy = entry.requestedBy ? `<@${entry.requestedBy}>` : "неизвестно";
    const source = formatInputType(entry.inputType);
    return [
        `**${title}**`,
        `${artists}`,
        `Источник: ${source} | Длительность: ${duration}`,
        `Статус: ${state} | Запросил: ${requestedBy}`
    ].join("\n");
}

function formatDuration(durationMs: number | null): string {
    if (durationMs === null || durationMs <= 0) {
        return "--:--";
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

function createBaseEmbed(
    interaction: EchochanInteraction,
    title: string,
    description: string,
    tone: EchochanTone
): EmbedBuilder {
    const color = getToneColor(tone);
    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`Echochan | ${title}`)
        .setDescription(description)
        .setTimestamp();
    const avatarUrl = interaction.client.user?.displayAvatarURL() ?? null;
    if (avatarUrl) {
        embed.setThumbnail(avatarUrl);
    }
    embed.setFooter({
        text: "Музыкальный режим Echochan"
    });
    return embed;
}

function getToneColor(tone: EchochanTone): number {
    if (tone === "success") return 0x62a5ff;
    if (tone === "warning") return 0xf4b86a;
    if (tone === "error") return 0xec6f8f;
    return 0x8c7dff;
}

function formatLoopMode(loopMode: LoopMode): string {
    if (loopMode === "track") return "трек";
    if (loopMode === "queue") return "очередь";
    return "выкл";
}

function formatPlaybackState(state: GuildQueueState["playbackState"]): string {
    if (state === "playing") return "играет";
    if (state === "paused") return "пауза";
    if (state === "stopped") return "остановлено";
    return "ожидание";
}

function formatInputType(inputType: QueueEntry["inputType"]): string {
    if (inputType === "spotify_track") return "Spotify";
    if (inputType === "spotify_playlist") return "Spotify playlist/album";
    return "YouTube/URL";
}

function clampText(value: string, maxLength: number): string {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.slice(0, Math.max(1, maxLength - 1))}…`;
}

export {
    buildNoticeReply,
    buildQueuePanelReply,
    buildQueueEmbed,
    buildQueueControlRows,
    getVisibleQueueEntries,
    isEchochanControlCustomId,
    parseEchochanControlAction,
    nextLoopMode
};

export type {
    EchochanControlAction
};
