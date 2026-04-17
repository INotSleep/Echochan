import { ApplicationCommandOptionType } from "discord.js";
import type { Command } from "../core/Command.js";
import { PlaybackCoordinator } from "../playback/PlaybackCoordinator.js";
import type { QueueEntry } from "../playback/types.js";

class MoveCommand implements Command {
    public readonly name = "move";
    public readonly data = {
        name: "move",
        description: "Переместить элемент очереди",
        dmPermission: false,
        options: [
            {
                name: "from",
                description: "Текущая позиция (начиная с 1)",
                type: ApplicationCommandOptionType.Integer as const,
                required: true,
                minValue: 1
            },
            {
                name: "to",
                description: "Новая позиция (начиная с 1)",
                type: ApplicationCommandOptionType.Integer as const,
                required: true,
                minValue: 1
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

        const from = interaction.options.getInteger("from", true);
        const to = interaction.options.getInteger("to", true);
        const coordinator = context.services.get<PlaybackCoordinator>("coordinator");
        const queue = coordinator.getQueue(interaction.guildId);
        const visible = getVisibleQueueEntries(queue.entries, queue.currentIndex);
        const fromEntry = visible[from - 1];
        const toEntry = visible[to - 1];
        if (!fromEntry || !toEntry) {
            await interaction.editReply("Не удалось переместить элемент. Проверь позиции.");
            return;
        }

        const moved = coordinator.move(interaction.guildId, fromEntry.position, toEntry.position);
        if (!moved) {
            await interaction.editReply("Не удалось переместить элемент. Проверь позиции.");
            return;
        }

        await interaction.editReply(`Переместил элемент с ${from} на ${to}.`);
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
    MoveCommand
};
