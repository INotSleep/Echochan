import { ApplicationCommandOptionType, EmbedBuilder } from "discord.js";
import type { Command } from "../core/Command.js";
import { PlaybackCoordinator } from "../playback/PlaybackCoordinator.js";
import type { QueueEntry } from "../playback/types.js";

class QueueCommand implements Command {
    public readonly name = "queue";
    public readonly data = {
        name: "queue",
        description: "Показать очередь",
        dmPermission: false,
        options: [
            {
                name: "limit",
                description: "Сколько элементов показать (1-20)",
                type: ApplicationCommandOptionType.Integer as const,
                required: false,
                minValue: 1,
                maxValue: 20
            }
        ]
    };

    public async execute(
        interaction: Parameters<Command["execute"]>[0],
        context: Parameters<Command["execute"]>[1]
    ): Promise<void> {
        if (!interaction.inGuild()) {
            await interaction.editReply("Команда доступна только на сервере.");
            return;
        }

        const limit = interaction.options.getInteger("limit") ?? 10;
        const coordinator = context.services.get<PlaybackCoordinator>("coordinator");
        const queue = coordinator.getQueue(interaction.guildId);
        const visible = getVisibleQueueEntries(queue.entries, queue.currentIndex);

        if (visible.length === 0) {
            const emptyEmbed = new EmbedBuilder()
                .setColor(0x2b2d31)
                .setTitle("Очередь")
                .setDescription("Сейчас очередь пустая.")
                .setFooter({
                    text: `loop: ${queue.loopMode} • shuffle: ${queue.shuffleEnabled ? "on" : "off"}`
                });
            await interaction.editReply({
                embeds: [emptyEmbed]
            });
            return;
        }

        const sliced = visible.slice(0, limit);
        const lines = sliced.map((entry, idx) => {
            const marker = idx === 0 ? "▶" : "•";
            const title = entry.title ?? entry.input;
            const artists = entry.artists.length > 0 ? entry.artists.join(", ") : "Unknown artist";
            return `${marker} **${idx + 1}.** ${title}\n   ${artists} • \`${entry.state}\``;
        });

        const totalVisible = visible.length;
        const hiddenCount = Math.max(0, totalVisible - sliced.length);
        const tail = hiddenCount > 0 ? `\n... и ещё ${hiddenCount} трек(ов)` : "";

        const embed = new EmbedBuilder()
            .setColor(0x4f8cff)
            .setTitle("Очередь")
            .setDescription(`${lines.join("\n")}${tail}`)
            .setFooter({
                text: `loop: ${queue.loopMode} • shuffle: ${queue.shuffleEnabled ? "on" : "off"} • visible: ${totalVisible}`
            });

        await interaction.editReply({
            embeds: [embed]
        });
    }
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

export {
    QueueCommand
};
