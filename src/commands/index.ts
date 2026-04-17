import type { ApplicationCommandDataResolvable } from "discord.js";
import type { Command } from "../core/Command.js";
import { ClearCommand } from "./ClearCommand.js";
import { JoinCommand } from "./JoinCommand.js";
import { LeaveCommand } from "./LeaveCommand.js";
import { LoopCommand } from "./LoopCommand.js";
import { MoveCommand } from "./MoveCommand.js";
import { NowPlayingCommand } from "./NowPlayingCommand.js";
import { PauseCommand } from "./PauseCommand.js";
import { PingCommand } from "./PingCommand.js";
import { PlayCommand } from "./PlayCommand.js";
import { QueueCommand } from "./QueueCommand.js";
import { RemoveCommand } from "./RemoveCommand.js";
import { ResumeCommand } from "./ResumeCommand.js";
import { ShuffleCommand } from "./ShuffleCommand.js";
import { SkipCommand } from "./SkipCommand.js";
import { StopCommand } from "./StopCommand.js";

type CommandConstructor = new () => Command;

const commandConstructors: CommandConstructor[] = [
    PingCommand,
    JoinCommand,
    PlayCommand,
    NowPlayingCommand,
    QueueCommand,
    MoveCommand,
    RemoveCommand,
    SkipCommand,
    PauseCommand,
    ResumeCommand,
    ShuffleCommand,
    LoopCommand,
    ClearCommand,
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
