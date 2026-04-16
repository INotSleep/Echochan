import type { Command } from "../core/Command.js";
import { PlaybackCoordinator } from "../playback/PlaybackCoordinator.js";

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
            await interaction.editReply("Команда доступна только на сервере.");
            return;
        }

        const coordinator = context.services.get<PlaybackCoordinator>("coordinator");
        await coordinator.stop(interaction.guildId, false);
        await interaction.editReply("Остановил воспроизведение.");
    }
}

export {
    StopCommand
};
