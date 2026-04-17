import type { Command } from "../core/Command.js";
import { PlaybackCoordinator } from "../playback/PlaybackCoordinator.js";
import { buildNoticeReply, buildQueuePanelReply } from "./ui/EchochanUi.js";

class ResumeCommand implements Command {
    public readonly name = "resume";
    public readonly data = {
        name: "resume",
        description: "Продолжить воспроизведение",
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
        const resumed = coordinator.resume(interaction.guildId);
        const queue = coordinator.getQueue(interaction.guildId);
        if (!resumed) {
            await interaction.editReply(buildQueuePanelReply(interaction, queue, {
                title: "Нечего продолжать",
                note: "В очереди пока нет активного трека. Попробуй `/play`.",
                tone: "warning",
                limit: 6
            }));
            return;
        }

        await interaction.editReply(buildQueuePanelReply(interaction, queue, {
            title: "Продолжаю",
            note: "Сняла паузу и продолжаю воспроизведение.",
            tone: "success",
            limit: 6
        }));
    }
}

export {
    ResumeCommand
};
