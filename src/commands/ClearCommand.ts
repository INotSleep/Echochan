import type { Command } from "../core/Command.js";
import { PlaybackCoordinator } from "../playback/PlaybackCoordinator.js";

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
            await interaction.editReply("Команда доступна только на сервере.");
            return;
        }

        const coordinator = context.services.get<PlaybackCoordinator>("coordinator");
        await coordinator.clear(interaction.guildId);
        await interaction.editReply("Очередь очищена.");
    }
}

export {
    ClearCommand
};
