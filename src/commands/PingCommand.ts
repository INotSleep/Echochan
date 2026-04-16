import type { Command } from "../core/Command.js";

class PingCommand implements Command {
    public readonly name = "ping";
    public readonly data = {
        name: "ping",
        description: "Проверить, что бот онлайн"
    };

    public async execute(interaction: Parameters<Command["execute"]>[0]): Promise<void> {
        await interaction.editReply("Pong!");
    }
}

export {
    PingCommand
};
