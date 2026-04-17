import type { Command } from "../core/Command.js";
import { buildNoticeReply } from "./ui/EchochanUi.js";
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
            await interaction.editReply(buildNoticeReply(interaction, {
                title: "Нужен голосовой канал",
                description: "Сначала зайди в голосовой канал, и я подключусь к тебе.",
                tone: "warning"
            }));
            return;
        }

        const connection = music.joinChannel(channel);
        const isReady = await music.waitUntilConnectionReady(connection, 12_000);
        if (!isReady) {
            await interaction.editReply(buildNoticeReply(interaction, {
                title: "Подключение в процессе",
                description: `Поднимаю соединение с **${channel.name}**. Текущий статус: ${connection.state.status}.`,
                tone: "info"
            }));
            return;
        }

        await interaction.editReply(buildNoticeReply(interaction, {
            title: "Подключение готово",
            description: `Я в канале **${channel.name}**. Статус: ${connection.state.status}.`,
            tone: "success"
        }));
    }
}

export {
    JoinCommand
};
