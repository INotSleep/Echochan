import type { Command } from "../core/Command.js";
import { PlaybackCoordinator } from "../playback/PlaybackCoordinator.js";

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
            await interaction.editReply("Команда доступна только на сервере.");
            return;
        }

        const coordinator = context.services.get<PlaybackCoordinator>("coordinator");
        const paused = coordinator.pause(interaction.guildId);
        if (!paused) {
            await interaction.editReply("Сейчас нечего ставить на паузу.");
            return;
        }

        await interaction.editReply("Пауза.");
    }
}

export {
    PauseCommand
};
