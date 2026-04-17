import type { Command } from "../core/Command.js";
import { MusicPlaybackService } from "../services/MusicPlaybackService.js";
import { PlaybackCoordinator } from "../playback/PlaybackCoordinator.js";
import { buildNoticeReply, buildQueuePanelReply } from "./ui/EchochanUi.js";

class LeaveCommand implements Command {
    public readonly name = "leave";
    public readonly data = {
        name: "leave",
        description: "Отключить бота от голосового канала",
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

        const music = context.services.get<MusicPlaybackService>("music");
        const left = music.leave(interaction.guildId);
        if (!left) {
            const queue = coordinator.getQueue(interaction.guildId);
            await interaction.editReply(buildQueuePanelReply(interaction, queue, {
                title: "Уже отключена",
                note: "Я уже не была подключена к голосовому каналу.",
                tone: "warning",
                limit: 6
            }));
            return;
        }

        const queue = coordinator.getQueue(interaction.guildId);
        await interaction.editReply(buildQueuePanelReply(interaction, queue, {
            title: "Голосовой канал покинут",
            note: "Отключилась от канала и очистила очередь.",
            tone: "success",
            limit: 6
        }));
    }
}

export {
    LeaveCommand
};
