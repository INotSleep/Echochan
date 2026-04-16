import { ApplicationCommandOptionType } from "discord.js";
import type { Command } from "../core/Command.js";
import { PlaybackCoordinator } from "../playback/PlaybackCoordinator.js";

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
        const target = queue.entries[position - 1];
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

export {
    RemoveCommand
};
