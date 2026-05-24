import { ApplicationCommandOptionType } from "discord.js";
import type { Command } from "../core/Command.js";
import type { LoopMode } from "../playback/types.js";
import { PlaybackCoordinator } from "../playback/PlaybackCoordinator.js";
import { buildNoticeReply, buildQueuePanelReply } from "./ui/EchochanUi.js";

class LoopCommand implements Command {
    public readonly name = "loop";
    public readonly data = {
        name: "loop",
        description: "Настроить режим повтора",
        dmPermission: false,
        options: [
            {
                name: "mode",
                description: "Режим цикла",
                type: ApplicationCommandOptionType.String as const,
                required: true,
                choices: [
                    { name: "Выключен", value: "off" },
                    { name: "Один трек", value: "track" },
                    { name: "Вся очередь", value: "queue" }
                ]
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

        const mode = interaction.options.getString("mode", true) as LoopMode;
        const coordinator = context.services.get<PlaybackCoordinator>("coordinator");
        coordinator.setLoopMode(interaction.guildId, mode);
        const queue = coordinator.getQueue(interaction.guildId);
        await interaction.editReply(buildQueuePanelReply(interaction, queue, {
            title: "Режим повтора обновлён",
            note: `Текущий режим: ${mode}.`,
            tone: "info",
            limit: 8
        }));
    }
}

export {
    LoopCommand
};
