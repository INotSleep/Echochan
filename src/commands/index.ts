import type { ApplicationCommandDataResolvable } from "discord.js";
import type { Command } from "../core/Command.js";
import { JoinCommand } from "./JoinCommand.js";
import { LeaveCommand } from "./LeaveCommand.js";
import { PingCommand } from "./PingCommand.js";
import { PlayCommand } from "./PlayCommand.js";
import { StopCommand } from "./StopCommand.js";

type CommandConstructor = new () => Command;

const commandConstructors: CommandConstructor[] = [
    PingCommand,
    JoinCommand,
    PlayCommand,
    StopCommand,
    LeaveCommand
];

function createCommands(): Command[] {
    return commandConstructors.map((CommandType) => new CommandType());
}

function getCommandData(): ApplicationCommandDataResolvable[] {
    return createCommands().map((command) => command.data);
}

export {
    createCommands,
    getCommandData
};
