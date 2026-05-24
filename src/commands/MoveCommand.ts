import { ApplicationCommandOptionType } from "discord.js";
import type { Command } from "../core/Command.js";
import { PlaybackCoordinator } from "../playback/PlaybackCoordinator.js";
import { buildNoticeReply, buildQueuePanelReply, getVisibleQueueEntries } from "./ui/EchochanUi.js";

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
            await interaction.editReply(buildNoticeReply(interaction, {
                title: "Команда недоступна",
                description: "Команда работает только внутри сервера.",
                tone: "warning"
            }));
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
            await interaction.editReply(buildQueuePanelReply(interaction, queue, {
                title: "Перемещение не выполнено",
                note: "Проверь позиции: одна из них выходит за границы очереди.",
                tone: "warning",
                limit: 8
            }));
            return;
        }

        const moved = coordinator.move(interaction.guildId, fromEntry.position, toEntry.position);
        if (!moved) {
            const updatedQueue = coordinator.getQueue(interaction.guildId);
            await interaction.editReply(buildQueuePanelReply(interaction, updatedQueue, {
                title: "Перемещение не выполнено",
                note: "Не удалось переместить элемент. Проверь позиции и попробуй ещё раз.",
                tone: "warning",
                limit: 8
            }));
            return;
        }

        const updatedQueue = coordinator.getQueue(interaction.guildId);
        await interaction.editReply(buildQueuePanelReply(interaction, updatedQueue, {
            title: "Трек перемещён",
            note: `Переместила трек с позиции ${from} на ${to}.`,
            tone: "success",
            limit: 8
        }));
    }
}

export {
    MoveCommand
};
