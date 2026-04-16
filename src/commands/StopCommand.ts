import type { Command } from "../core/Command.js";
import { MusicPlaybackService } from "../services/MusicPlaybackService.js";

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
            await interaction.reply({
                content: "Команда доступна только на сервере.",
                ephemeral: true
            });
            return;
        }

        const music = context.services.get<MusicPlaybackService>("music");
        const isStopped = music.stop(interaction.guildId);
        if (!isStopped) {
            await interaction.reply({
                content: "Сейчас ничего не играет.",
                ephemeral: true
            });
            return;
        }

        await interaction.reply("Остановил воспроизведение.");
    }
}

export {
    StopCommand
};
