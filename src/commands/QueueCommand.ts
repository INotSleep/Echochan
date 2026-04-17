import { ApplicationCommandOptionType } from "discord.js";
import type { Command } from "../core/Command.js";
import { PlaybackCoordinator } from "../playback/PlaybackCoordinator.js";
import { buildNoticeReply, buildQueuePanelReply } from "./ui/EchochanUi.js";

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
            await interaction.editReply(buildNoticeReply(interaction, {
                title: "Команда недоступна",
                description: "Команда работает только внутри сервера.",
                tone: "warning"
            }));
            return;
        }

        const limit = interaction.options.getInteger("limit") ?? 10;
        const coordinator = context.services.get<PlaybackCoordinator>("coordinator");
        const queue = coordinator.getQueue(interaction.guildId);
        await interaction.editReply(buildQueuePanelReply(interaction, queue, {
            title: "Очередь Echochan",
            note: "Текущее состояние проигрывания и ближайшие треки.",
            limit
        }));
    }
}

export {
    QueueCommand
};
