import dotenv from "dotenv";
import { REST, Routes } from "discord.js";
import { getCommandData } from "../commands/index.js";

type DeployMode = "global" | "guild";

function readModeFromArgs(): DeployMode {
    const arg = process.argv[2]?.toLowerCase();

    if (arg === "guild" || arg === "dev") {
        return "guild";
    }

    return "global";
}

async function main(): Promise<void> {
    dotenv.config();

    const token = process.env.BOT_TOKEN;
    const clientId = process.env.BOT_CLIENT_ID;
    const devGuild = process.env.DEV_GUILD;
    const mode = readModeFromArgs();
    const commandData = getCommandData();

    if (!token) {
        throw new Error("BOT_TOKEN is missing.");
    }

    if (!clientId) {
        throw new Error("BOT_CLIENT_ID is missing.");
    }

    if (mode === "guild" && !devGuild) {
        throw new Error("DEV_GUILD is missing for guild deploy.");
    }

    const rest = new REST({ version: "10" }).setToken(token);

    if (mode === "guild") {
        await rest.put(
            Routes.applicationGuildCommands(clientId, devGuild),
            { body: commandData }
        );
        console.log(`Deployed ${commandData.length} commands to guild ${devGuild}.`);
        return;
    }

    await rest.put(
        Routes.applicationCommands(clientId),
        { body: commandData }
    );
    console.log(`Deployed ${commandData.length} global commands.`);
}

main().catch((error: unknown) => {
    console.error("Failed to deploy commands:", error);
    process.exit(1);
});
