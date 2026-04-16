import type { Command } from "../core/Command.js";
import { MusicPlaybackService } from "../services/MusicPlaybackService.js";

class LeaveCommand implements Command {
    public readonly name = "leave";
    public readonly data = {
        name: "leave",
        description: "Отключить бота от голосового канала",
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
        const left = music.leave(interaction.guildId);
        if (!left) {
            await interaction.reply({
                content: "Я не подключён к голосовому каналу.",
                ephemeral: true
            });
            return;
        }

        await interaction.reply("Отключился от голосового канала.");
    }
}

export {
    LeaveCommand
};
