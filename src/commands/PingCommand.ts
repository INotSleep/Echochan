import type { Command } from "../core/Command.js";
import { buildNoticeReply } from "./ui/EchochanUi.js";

class PingCommand implements Command {
    public readonly name = "ping";
    public readonly data = {
        name: "ping",
        description: "Проверить, что Echochan онлайн"
    };

    public async execute(interaction: Parameters<Command["execute"]>[0]): Promise<void> {
        const wsPing = interaction.client.ws.ping;
        await interaction.editReply(buildNoticeReply(interaction, {
            title: "Echochan онлайн",
            description: `Сердцебиение стабильно. WebSocket ping: ${wsPing} ms.`,
            tone: "success"
        }));
    }
}

export {
    PingCommand
};
