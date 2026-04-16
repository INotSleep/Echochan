import { ApplicationCommandOptionType } from "discord.js";
import type { Command } from "../core/Command.js";
import { PlaybackCoordinator } from "../playback/PlaybackCoordinator.js";

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
        const moved = coordinator.move(interaction.guildId, from - 1, to - 1);
        if (!moved) {
            await interaction.editReply("Не удалось переместить элемент. Проверь позиции.");
            return;
        }

        await interaction.editReply(`Переместил элемент с ${from} на ${to}.`);
    }
}

export {
    MoveCommand
};
