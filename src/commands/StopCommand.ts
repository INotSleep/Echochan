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
            await interaction.editReply("Команда доступна только на сервере.");
            return;
        }

        const music = context.services.get<MusicPlaybackService>("music");
        const isStopped = music.stop(interaction.guildId);
        if (!isStopped) {
            await interaction.editReply("Сейчас ничего не играет.");
            return;
        }

        await interaction.editReply("Остановил воспроизведение.");
    }
}

export {
    StopCommand
};
