import type { Command } from "../core/Command.js";
import { PlaybackCoordinator } from "../playback/PlaybackCoordinator.js";
import { buildNoticeReply, buildQueuePanelReply } from "./ui/EchochanUi.js";

class SkipCommand implements Command {
    public readonly name = "skip";
    public readonly data = {
        name: "skip",
        description: "Пропустить текущий трек",
        dmPermission: false
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

        const coordinator = context.services.get<PlaybackCoordinator>("coordinator");
        await coordinator.skip(interaction.guildId);
        const queue = coordinator.getQueue(interaction.guildId);
        await interaction.editReply(buildQueuePanelReply(interaction, queue, {
            title: "Skip выполнен",
            note: "Текущий трек пропущен, запускаю следующий.",
            tone: "info",
            limit: 6
        }));
    }
}

export {
    SkipCommand
};
