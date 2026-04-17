import { ApplicationCommandOptionType } from "discord.js";
import type { Command } from "../core/Command.js";
import { PlaybackCoordinator } from "../playback/PlaybackCoordinator.js";
import type { QueueEntry } from "../playback/types.js";

class RemoveCommand implements Command {
    public readonly name = "remove";
    public readonly data = {
        name: "remove",
        description: "Удалить трек из очереди по позиции",
        dmPermission: false,
        options: [
            {
                name: "position",
                description: "Позиция в очереди (начиная с 1)",
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

        const position = interaction.options.getInteger("position", true);
        const coordinator = context.services.get<PlaybackCoordinator>("coordinator");
        const queue = coordinator.getQueue(interaction.guildId);
        const visible = getVisibleQueueEntries(queue.entries, queue.currentIndex);
        const target = visible[position - 1];
        if (!target) {
            await interaction.editReply(`Нет трека на позиции ${position}.`);
            return;
        }

        const removed = coordinator.remove(interaction.guildId, target.id);
        if (!removed) {
            await interaction.editReply("Не удалось удалить элемент очереди.");
            return;
        }

        const label = target.title ?? target.input;
        await interaction.editReply(`Удалил из очереди: ${position}. ${label}`);
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
    RemoveCommand
};
