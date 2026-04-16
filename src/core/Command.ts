import { Events, type ApplicationCommandDataResolvable, type ChatInputCommandInteraction, type Client, type Interaction } from "discord.js";
import type { DiscordClientAdapter } from "./DiscordClientAdapter.js";
import type { EventBus } from "./EventBus.js";
import type { Events as EchochanEvents } from "./Events.js";
import type { Logger } from "./Logger.js";
import type { ServiceRegistry } from "./ServiceRegistry.js";
import type { Storage } from "./Storage.js";

interface CommandContext {
    logger: Logger;
    storage: Storage;
    events: EventBus<EchochanEvents>;
    services: ServiceRegistry;
    adapter: DiscordClientAdapter;
}

interface Command {
    name: string;
    data: ApplicationCommandDataResolvable;
    execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void>;
}

class CommandRegistry {
    private readonly client: Client;
    private readonly logger: Logger;
    private readonly context: CommandContext;
    private readonly commands = new Map<string, Command>();
    private interactionListenerBound = false;

    constructor(
        client: Client,
        logger: Logger,
        storage: Storage,
        events: EventBus<EchochanEvents>,
        services: ServiceRegistry,
        adapter: DiscordClientAdapter
    ) {
        this.client = client;
        this.logger = logger.child("Commands");
        this.context = {
            logger: this.logger,
            storage,
            events,
            services,
            adapter
        };
    }

    register(command: Command): void {
        if (this.commands.has(command.name)) {
            throw new Error(`Command "${command.name}" is already registered.`);
        }

        this.commands.set(command.name, command);
    }

    registerMany(commands: Command[]): void {
        for (const command of commands) {
            this.register(command);
        }
    }

    attachInteractionListener(): void {
        if (this.interactionListenerBound) {
            return;
        }

        this.client.on(Events.InteractionCreate, (interaction: Interaction) => {
            void this.handleInteraction(interaction);
        });

        this.interactionListenerBound = true;
    }

    private async handleInteraction(interaction: Interaction): Promise<void> {
        if (!interaction.isChatInputCommand()) {
            return;
        }

        const command = this.commands.get(interaction.commandName);

        if (!command) {
            await interaction.reply({
                content: "Unknown command.",
                ephemeral: true
            }).catch(() => undefined);
            return;
        }

        try {
            await command.execute(interaction, this.context);
        } catch (error) {
            this.logger.error(`Command "${command.name}" failed:`, error);

            const payload = {
                content: "Произошла ошибка при выполнении команды.",
                ephemeral: true
            };

            if (interaction.deferred || interaction.replied) {
                await interaction.followUp(payload).catch(() => undefined);
                return;
            }

            await interaction.reply(payload).catch(() => undefined);
        }
    }
}

export type {
    Command,
    CommandContext
};

export {
    CommandRegistry
};
