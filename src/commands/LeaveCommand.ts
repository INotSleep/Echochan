import type { Command } from "../core/Command.js";
import { MusicPlaybackService } from "../services/MusicPlaybackService.js";
import { PlaybackCoordinator } from "../playback/PlaybackCoordinator.js";

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
            await interaction.editReply("Команда доступна только на сервере.");
            return;
        }

        const coordinator = context.services.get<PlaybackCoordinator>("coordinator");
        await coordinator.clear(interaction.guildId);

        const music = context.services.get<MusicPlaybackService>("music");
        const left = music.leave(interaction.guildId);
        if (!left) {
            await interaction.editReply("Я не подключён к голосовому каналу.");
            return;
        }

        await interaction.editReply("Отключился от голосового канала.");
    }
}

export {
    LeaveCommand
};
