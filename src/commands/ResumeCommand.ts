import type { Command } from "../core/Command.js";
import { PlaybackCoordinator } from "../playback/PlaybackCoordinator.js";

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
            await interaction.editReply("Команда доступна только на сервере.");
            return;
        }

        const coordinator = context.services.get<PlaybackCoordinator>("coordinator");
        const resumed = coordinator.resume(interaction.guildId);
        if (!resumed) {
            await interaction.editReply("Нечего продолжать. Попробуй `/play`.");
            return;
        }

        await interaction.editReply("Продолжаю воспроизведение.");
    }
}

export {
    ResumeCommand
};
