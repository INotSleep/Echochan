import type { Command } from "../core/Command.js";
import { MusicPlaybackService } from "../services/MusicPlaybackService.js";

class JoinCommand implements Command {
    public readonly name = "join";
    public readonly data = {
        name: "join",
        description: "Подключить бота к вашему голосовому каналу",
        dmPermission: false
    };

    public async execute(
        interaction: Parameters<Command["execute"]>[0],
        context: Parameters<Command["execute"]>[1]
    ): Promise<void> {
        const music = context.services.get<MusicPlaybackService>("music");
        const channel = music.getMemberVoiceChannel(interaction);

        if (!channel) {
            await interaction.editReply("Сначала зайдите в голосовой канал.");
            return;
        }

        const connection = music.joinChannel(channel);
        const isReady = await music.waitUntilConnectionReady(connection, 12_000);
        if (!isReady) {
            await interaction.editReply(
                `Пробую подключиться к **${channel.name}**, но соединение ещё не готово (status: ${connection.state.status}).`
            );
            return;
        }

        await interaction.editReply(`Подключился к **${channel.name}** (status: ${connection.state.status}).`);
    }
}

export {
    JoinCommand
};
