import type { Command } from "../core/Command.js";
import { PlaybackCoordinator } from "../playback/PlaybackCoordinator.js";
import { buildNoticeReply, buildQueuePanelReply } from "./ui/EchochanUi.js";

class ClearCommand implements Command {
    public readonly name = "clear";
    public readonly data = {
        name: "clear",
        description: "Очистить очередь и остановить воспроизведение",
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
        await coordinator.clear(interaction.guildId);
        const queue = coordinator.getQueue(interaction.guildId);
        await interaction.editReply(buildQueuePanelReply(interaction, queue, {
            title: "Очередь очищена",
            note: "Очистила очередь и остановила активный трек.",
            tone: "success",
            limit: 6
        }));
    }
}

export {
    ClearCommand
};
