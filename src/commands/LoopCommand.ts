import { ApplicationCommandOptionType } from "discord.js";
import type { Command } from "../core/Command.js";
import type { LoopMode } from "../playback/types.js";
import { PlaybackCoordinator } from "../playback/PlaybackCoordinator.js";

class LoopCommand implements Command {
    public readonly name = "loop";
    public readonly data = {
        name: "loop",
        description: "Установить режим loop",
        dmPermission: false,
        options: [
            {
                name: "mode",
                description: "Режим цикла",
                type: ApplicationCommandOptionType.String as const,
                required: true,
                choices: [
                    { name: "off", value: "off" },
                    { name: "track", value: "track" },
                    { name: "queue", value: "queue" }
                ]
            }
        ]
    };

    public async execute(
        interaction: Parameters<Command["execute"]>[0],
        context: Parameters<Command["execute"]>[1]
    ): Promise<void> {
        if (!interaction.inGuild()) {
            await interaction.editReply("Команда доступна только на сервере.");
            return;
        }

        const mode = interaction.options.getString("mode", true) as LoopMode;
        const coordinator = context.services.get<PlaybackCoordinator>("coordinator");
        coordinator.setLoopMode(interaction.guildId, mode);
        await interaction.editReply(`Loop mode: ${mode}`);
    }
}

export {
    LoopCommand
};
