import type { Command } from "../core/Command.js";
import { PlaybackCoordinator } from "../playback/PlaybackCoordinator.js";
import { buildNoticeReply, buildQueuePanelReply } from "./ui/EchochanUi.js";

class PauseCommand implements Command {
    public readonly name = "pause";
    public readonly data = {
        name: "pause",
        description: "Поставить воспроизведение на паузу",
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
        const paused = coordinator.pause(interaction.guildId);
        const queue = coordinator.getQueue(interaction.guildId);
        if (!paused) {
            await interaction.editReply(buildQueuePanelReply(interaction, queue, {
                title: "Пауза недоступна",
                note: "Сейчас нечего ставить на паузу.",
                tone: "warning",
                limit: 6
            }));
            return;
        }

        await interaction.editReply(buildQueuePanelReply(interaction, queue, {
            title: "Пауза",
            note: "Поставила воспроизведение на паузу.",
            tone: "info",
            limit: 6
        }));
    }
}

export {
    PauseCommand
};
