import type { Command } from "../core/Command.js";
import { PlaybackCoordinator } from "../playback/PlaybackCoordinator.js";

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
            await interaction.editReply("Команда доступна только на сервере.");
            return;
        }

        const coordinator = context.services.get<PlaybackCoordinator>("coordinator");
        coordinator.shuffle(interaction.guildId);
        await interaction.editReply("Очередь перемешана.");
    }
}

export {
    ShuffleCommand
};
