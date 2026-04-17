import { ApplicationCommandOptionType } from "discord.js";
import type { Command } from "../core/Command.js";
import type { LoopMode } from "../playback/types.js";
import { PlaybackCoordinator } from "../playback/PlaybackCoordinator.js";
import { buildNoticeReply, buildQueuePanelReply } from "./ui/EchochanUi.js";

class LoopCommand implements Command {
    public readonly name = "loop";
    public readonly data = {
        name: "loop",
        description: "Установить режим loop",
        dmPermission: false,
        options: [
            {
                name: "mode",
                description: "Режим цикла",
                type: ApplicationCommandOptionType.String as const,
                required: true,
                choices: [
                    { name: "off", value: "off" },
                    { name: "track", value: "track" },
                    { name: "queue", value: "queue" }
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
            title: "Loop обновлён",
            note: `Новый режим loop: ${mode}.`,
            tone: "info",
            limit: 8
        }));
    }
}

export {
    LoopCommand
};
