import { Events, type ButtonInteraction, type Interaction } from "discord.js";
import { buildNoticeReply, buildQueuePanelReply, isEchochanControlCustomId, nextLoopMode, parseEchochanControlAction } from "../commands/ui/EchochanUi.js";
import type { DiscordClientAdapter } from "../core/DiscordClientAdapter.js";
import type { EventBus } from "../core/EventBus.js";
import type { Events as EchochanEvents } from "../core/Events.js";
import type { Logger } from "../core/Logger.js";
import type { Module } from "../core/Module.js";
import type { ServiceRegistry } from "../core/ServiceRegistry.js";
import type { Storage } from "../core/Storage.js";
import { PlaybackCoordinator } from "../playback/PlaybackCoordinator.js";
import type { GuildQueueState } from "../playback/types.js";

class EchochanUiModule implements Module {
    public readonly name = "echochan-ui";
    public readonly logger: Logger;
    public readonly events: EventBus<EchochanEvents>;
    public readonly services: ServiceRegistry;
    public readonly storage: Storage;
    public readonly adapter: DiscordClientAdapter;

    constructor(
        logger: Logger,
        events: EventBus<EchochanEvents>,
        services: ServiceRegistry,
        storage: Storage,
        adapter: DiscordClientAdapter
    ) {
        this.logger = logger.child("Module").child("EchochanUi");
        this.events = events;
        this.services = services;
        this.storage = storage;
        this.adapter = adapter;
    }

    public async register(): Promise<void> {
        this.adapter.client.on(Events.InteractionCreate, (interaction: Interaction) => {
            void this.handleInteraction(interaction);
        });
    }

    private async handleInteraction(interaction: Interaction): Promise<void> {
        if (!interaction.isButton()) {
            return;
        }

        if (!isEchochanControlCustomId(interaction.customId)) {
            return;
        }

        const action = parseEchochanControlAction(interaction.customId);
        if (!action) {
            return;
        }

        if (!interaction.inGuild()) {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.reply({
                    ...buildNoticeReply(interaction, {
                        title: "Команда недоступна",
                        description: "Кнопки очереди доступны только на сервере.",
                        tone: "warning"
                    }),
                    ephemeral: true
                });
            }
            return;
        }

        await this.runQueueControl(interaction, action);
    }

    private async runQueueControl(
        interaction: ButtonInteraction,
        action: "pause_resume" | "skip" | "loop" | "shuffle" | "refresh" | "stop"
    ): Promise<void> {
        const coordinator = this.services.get<PlaybackCoordinator>("coordinator");
        const guildId = interaction.guildId;

        if (!guildId) {
            return;
        }

        const before = coordinator.getQueue(guildId);
        await interaction.deferUpdate();

        let note = "Панель обновлена.";
        try {
            if (action === "pause_resume") {
                if (before.playbackState === "paused") {
                    const resumed = coordinator.resume(guildId);
                    note = resumed ? "Echochan продолжает проигрывание." : "Сейчас нечего продолжать.";
                } else {
                    const paused = coordinator.pause(guildId);
                    note = paused ? "Echochan поставила музыку на паузу." : "Сейчас нечего ставить на паузу.";
                }
            } else if (action === "skip") {
                await coordinator.skip(guildId);
                note = "Текущий трек пропущен.";
            } else if (action === "loop") {
                const next = nextLoopMode(before.loopMode);
                coordinator.setLoopMode(guildId, next);
                note = `Режим цикла: ${next}.`;
            } else if (action === "shuffle") {
                coordinator.setShuffle(guildId, !before.shuffleEnabled);
                note = `Шафл: ${!before.shuffleEnabled ? "вкл" : "выкл"}.`;
            } else if (action === "stop") {
                await coordinator.stop(guildId, false);
                note = "Воспроизведение остановлено.";
            }
        } catch (error) {
            note = `Операция не удалась: ${error instanceof Error ? error.message : "неизвестная ошибка"}`;
            this.logger.warn(`Queue control action failed. action=${action} guild=${guildId}`, error);
        }

        const queue = coordinator.getQueue(guildId);
        await this.updateQueuePanel(interaction, queue, note);
    }

    private async updateQueuePanel(
        interaction: ButtonInteraction,
        queue: GuildQueueState,
        note: string
    ): Promise<void> {
        try {
            await interaction.editReply(buildQueuePanelReply(interaction, queue, {
                title: "Пульт Echochan",
                note,
                tone: "info",
                limit: 8
            }));
        } catch (error) {
            this.logger.warn("Failed to edit queue control message.", error);
            await interaction.followUp({
                ...buildNoticeReply(interaction, {
                    title: "Панель не обновилась",
                    description: note,
                    tone: "warning",
                    queue
                }),
                ephemeral: true
            }).catch(() => undefined);
        }
    }
}

export {
    EchochanUiModule
};
