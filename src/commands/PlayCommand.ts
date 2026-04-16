import { ApplicationCommandOptionType } from "discord.js";
import { access } from "node:fs/promises";
import path from "node:path";
import type { Command } from "../core/Command.js";
import { MusicPlaybackService } from "../services/MusicPlaybackService.js";

class PlayCommand implements Command {
    public readonly name = "play";
    public readonly data = {
        name: "play",
        description: "Проиграть локальный аудиофайл",
        dmPermission: false,
        options: [
            {
                name: "file",
                description: "Имя файла рядом с корнем проекта (по умолчанию audio.mp3)",
                type: ApplicationCommandOptionType.String as const,
                required: false
            }
        ]
    };

    public async execute(
        interaction: Parameters<Command["execute"]>[0],
        context: Parameters<Command["execute"]>[1]
    ): Promise<void> {
        const music = context.services.get<MusicPlaybackService>("music");
        const channel = music.getMemberVoiceChannel(interaction);

        if (!channel) {
            await interaction.reply({
                content: "Нужно быть в голосовом канале, чтобы включить музыку.",
                ephemeral: true
            });
            return;
        }

        const fileName = interaction.options.getString("file") ?? "audio.mp3";
        if (fileName.includes("..") || path.isAbsolute(fileName)) {
            await interaction.reply({
                content: "Небезопасное имя файла. Укажите только относительное имя, например `audio.mp3`.",
                ephemeral: true
            });
            return;
        }

        const filePath = path.resolve(process.cwd(), fileName);
        try {
            await access(filePath);
        } catch {
            await interaction.reply({
                content: `Файл не найден: \`${fileName}\``,
                ephemeral: true
            });
            return;
        }

        music.playFile(channel, filePath);
        await interaction.reply(`Воспроизвожу \`${fileName}\` в **${channel.name}**.`);
    }
}

export {
    PlayCommand
};
