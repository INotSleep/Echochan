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
    | "stop"
    | "clear";

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

    if (visible.length === 0) {
        embed.setDescription([
            options.note?.trim(),
            "Сейчас очередь пустая. Добавь трек через `/play`."
        ].filter((part) => Boolean(part)).join("\n\n"));
        embed.setFooter({
            text: `loop: ${queue.loopMode} | shuffle: ${queue.shuffleEnabled ? "on" : "off"} | state: ${queue.playbackState}`
        });
        return embed;
    }

    const current = visible[0] ?? null;
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
            return `${queuePosition}. ${formatEntryLine(entry)}`;
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
        text: `loop: ${queue.loopMode} | shuffle: ${queue.shuffleEnabled ? "on" : "off"} | visible: ${visible.length} | state: ${queue.playbackState}`
    });

    return embed;
}

function buildQueueControlRows(queue: GuildQueueState): ActionRowBuilder<ButtonBuilder>[] {
    const empty = queue.entries.length === 0;
    const isPaused = queue.playbackState === "paused";
    const pauseLabel = isPaused ? "Продолжить" : "Пауза";
    const pauseStyle = isPaused ? ButtonStyle.Success : ButtonStyle.Primary;
    const loopLabel = `Loop: ${queue.loopMode}`;
    const shuffleLabel = `Shuffle: ${queue.shuffleEnabled ? "on" : "off"}`;
    const shuffleStyle = queue.shuffleEnabled ? ButtonStyle.Success : ButtonStyle.Secondary;
    const loopStyle = queue.loopMode === "off" ? ButtonStyle.Secondary : ButtonStyle.Success;

    const primaryRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        buildControlButton("pause_resume", pauseLabel, pauseStyle, empty),
        buildControlButton("skip", "Skip", ButtonStyle.Secondary, empty),
        buildControlButton("loop", loopLabel, loopStyle, empty),
        buildControlButton("shuffle", shuffleLabel, shuffleStyle, empty),
        buildControlButton("refresh", "Обновить", ButtonStyle.Secondary, false)
    );

    const dangerRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        buildControlButton("stop", "Stop", ButtonStyle.Danger, empty),
        buildControlButton("clear", "Clear", ButtonStyle.Danger, empty)
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
        || action === "clear"
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
    if (state === "queued") return "queued";
    if (state === "resolving_meta") return "resolving metadata";
    if (state === "resolved") return "resolved";
    if (state === "warming") return "caching";
    if (state === "ready") return "ready";
    if (state === "playing") return "playing";
    if (state === "finished") return "finished";
    return "failed";
}

function formatEntryLine(entry: QueueEntry): string {
    const title = entry.title ?? entry.input;
    const artists = entry.artists.length > 0 ? entry.artists.join(", ") : "Unknown artist";
    const duration = formatDuration(entry.durationMs);
    const state = describeEntryState(entry.state);
    return `${title} | ${artists} | ${duration} | ${state}`;
}

function formatCurrentEntry(entry: QueueEntry): string {
    const title = entry.title ?? entry.input;
    const artists = entry.artists.length > 0 ? entry.artists.join(", ") : "Unknown artist";
    const duration = formatDuration(entry.durationMs);
    const state = describeEntryState(entry.state);
    return `1. ${title}\n${artists} | ${duration} | ${state}`;
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
        text: "Chibi music mode"
    });
    return embed;
}

function getToneColor(tone: EchochanTone): number {
    if (tone === "success") return 0x62a5ff;
    if (tone === "warning") return 0xf4b86a;
    if (tone === "error") return 0xec6f8f;
    return 0x8c7dff;
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
