import type { Command } from "../core/Command.js";
import { PlaybackCoordinator } from "../playback/PlaybackCoordinator.js";
import { buildNoticeReply, buildQueuePanelReply } from "./ui/EchochanUi.js";

class ShuffleCommand implements Command {
    public readonly name = "shuffle";
    public readonly data = {
        name: "shuffle",
        description: "Перемешать очередь",
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
        coordinator.shuffle(interaction.guildId);
        const queue = coordinator.getQueue(interaction.guildId);
        await interaction.editReply(buildQueuePanelReply(interaction, queue, {
            title: "Shuffle выполнен",
            note: "Перемешала очередь. Текущий трек сохранён.",
            tone: "success",
            limit: 8
        }));
    }
}

export {
    ShuffleCommand
};
