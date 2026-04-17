import type { Command } from "../core/Command.js";
import { PlaybackCoordinator } from "../playback/PlaybackCoordinator.js";
import { buildNoticeReply, buildQueuePanelReply } from "./ui/EchochanUi.js";

class StopCommand implements Command {
    public readonly name = "stop";
    public readonly data = {
        name: "stop",
        description: "Остановить текущее воспроизведение",
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
        await coordinator.stop(interaction.guildId, false);
        const queue = coordinator.getQueue(interaction.guildId);
        await interaction.editReply(buildQueuePanelReply(interaction, queue, {
            title: "Воспроизведение остановлено",
            note: "Остановила плеер. Очередь сохранена.",
            tone: "info",
            limit: 6
        }));
    }
}

export {
    StopCommand
};
