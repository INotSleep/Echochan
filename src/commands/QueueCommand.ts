import { ApplicationCommandOptionType } from "discord.js";
import type { Command } from "../core/Command.js";
import { PlaybackCoordinator } from "../playback/PlaybackCoordinator.js";

class QueueCommand implements Command {
    public readonly name = "queue";
    public readonly data = {
        name: "queue",
        description: "Показать очередь",
        dmPermission: false,
        options: [
            {
                name: "limit",
                description: "Сколько элементов показать (1-20)",
                type: ApplicationCommandOptionType.Integer as const,
                required: false,
                minValue: 1,
                maxValue: 20
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

        const limit = interaction.options.getInteger("limit") ?? 10;
        const coordinator = context.services.get<PlaybackCoordinator>("coordinator");
        const queue = coordinator.getQueue(interaction.guildId);

        if (queue.entries.length === 0) {
            await interaction.editReply("Очередь пустая.");
            return;
        }

        const currentIndex = queue.currentIndex ?? -1;
        const lines = queue.entries
            .slice(0, limit)
            .map((entry, index) => {
                const isCurrent = index === currentIndex;
                const marker = isCurrent ? ">>" : "  ";
                const title = entry.title ?? entry.input;
                return `${marker} ${index + 1}. ${title} [${entry.state}]`;
            });

        const header = `Queue: ${queue.entries.length} трек(ов), loop=${queue.loopMode}, shuffle=${queue.shuffleEnabled ? "on" : "off"}`;
        await interaction.editReply([header, ...lines].join("\n"));
    }
}

export {
    QueueCommand
};
