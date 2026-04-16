import type { Command } from "../core/Command.js";
import { PlaybackCoordinator } from "../playback/PlaybackCoordinator.js";

class SkipCommand implements Command {
    public readonly name = "skip";
    public readonly data = {
        name: "skip",
        description: "Пропустить текущий трек",
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
        await coordinator.skip(interaction.guildId);
        await interaction.editReply("Пропустил текущий трек.");
    }
}

export {
    SkipCommand
};
