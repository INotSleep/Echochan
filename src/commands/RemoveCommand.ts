import { ApplicationCommandOptionType } from "discord.js";
import type { Command } from "../core/Command.js";
import { PlaybackCoordinator } from "../playback/PlaybackCoordinator.js";
import { buildNoticeReply, buildQueuePanelReply, getVisibleQueueEntries } from "./ui/EchochanUi.js";

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
            await interaction.editReply(buildNoticeReply(interaction, {
                title: "Команда недоступна",
                description: "Команда работает только внутри сервера.",
                tone: "warning"
            }));
            return;
        }

        const position = interaction.options.getInteger("position", true);
        const coordinator = context.services.get<PlaybackCoordinator>("coordinator");
        const queue = coordinator.getQueue(interaction.guildId);
        const visible = getVisibleQueueEntries(queue.entries, queue.currentIndex);
        const target = visible[position - 1];
        if (!target) {
            await interaction.editReply(buildQueuePanelReply(interaction, queue, {
                title: "Удаление не выполнено",
                note: `Позиция ${position} не найдена в видимой очереди.`,
                tone: "warning",
                limit: 8
            }));
            return;
        }

        const removed = coordinator.remove(interaction.guildId, target.id);
        if (!removed) {
            const updatedQueue = coordinator.getQueue(interaction.guildId);
            await interaction.editReply(buildQueuePanelReply(interaction, updatedQueue, {
                title: "Удаление не выполнено",
                note: "Не удалось удалить элемент очереди.",
                tone: "warning",
                limit: 8
            }));
            return;
        }

        const updatedQueue = coordinator.getQueue(interaction.guildId);
        const label = target.title ?? target.input;
        await interaction.editReply(buildQueuePanelReply(interaction, updatedQueue, {
            title: "Трек удалён",
            note: `Удалила из очереди позицию ${position}: ${label}`,
            tone: "success",
            limit: 8
        }));
    }
}

export {
    RemoveCommand
};
