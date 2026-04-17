import { randomUUID } from "node:crypto";
import type { EventBus } from "../core/EventBus.js";
import type { Events as EchochanEvents } from "../core/Events.js";
import type { Logger } from "../core/Logger.js";
import type {
    GuildQueueState,
    LoopMode,
    PlaybackState,
    QueueEntry,
    QueueEntryState,
    QueueInputType
} from "./types.js";

type AddQueueEntryInput = {
    guildId: string;
    requestedBy: string;
    input: string;
    inputType: QueueInputType;
    title?: string | null;
    artists?: string[];
    durationMs?: number | null;
    resolvedTrackId?: string | null;
    state?: QueueEntryState;
};

class QueueService {
    private readonly logger: Logger;
    private readonly events: EventBus<EchochanEvents>;
    private readonly queues = new Map<string, GuildQueueState>();

    constructor(events: EventBus<EchochanEvents>, logger: Logger) {
        this.events = events;
        this.logger = logger.child("Queue");
    }

    public getQueue(guildId: string): GuildQueueState {
        return this.cloneQueueState(this.getOrCreateQueue(guildId));
    }

    public getCurrentEntry(guildId: string): QueueEntry | null {
        const state = this.getOrCreateQueue(guildId);
        if (state.currentIndex === null) {
            return null;
        }

        const entry = state.entries[state.currentIndex];
        return entry ? this.cloneEntry(entry) : null;
    }

    public getNextEntry(guildId: string): QueueEntry | null {
        const state = this.getOrCreateQueue(guildId);
        const nextIndex = this.computeNextIndex(state, false);
        if (nextIndex === null) {
            return null;
        }
        const entry = state.entries[nextIndex];
        return entry ? this.cloneEntry(entry) : null;
    }

    public ensureCurrent(guildId: string): QueueEntry | null {
        const state = this.getOrCreateQueue(guildId);
        if (state.entries.length === 0) {
            state.currentIndex = null;
            state.playbackState = "idle";
            return null;
        }

        if (state.currentIndex === null) {
            const firstPlayable = this.findFirstPlayableIndex(state);
            if (firstPlayable === null) {
                state.playbackState = "idle";
                return null;
            }
            state.currentIndex = firstPlayable;
            this.bumpRevision(state);
        }

        const indexedCurrent = state.entries[state.currentIndex];
        if (!indexedCurrent || isTerminalState(indexedCurrent.state)) {
            const nextPlayable = this.computeNextIndex(state, true);
            if (nextPlayable === null) {
                state.currentIndex = null;
                state.playbackState = "idle";
                this.bumpRevision(state);
                return null;
            }
            state.currentIndex = nextPlayable;
            this.bumpRevision(state);
        }

        const current = state.currentIndex === null ? null : state.entries[state.currentIndex];
        return current ? this.cloneEntry(current) : null;
    }

    public add(input: AddQueueEntryInput): QueueEntry {
        const state = this.getOrCreateQueue(input.guildId);
        const entry = this.createEntry(state, input);
        state.entries.push(entry);
        this.bumpRevision(state);
        this.emitEntryAdded(entry);
        return this.cloneEntry(entry);
    }

    public addMany(inputs: AddQueueEntryInput[]): QueueEntry[] {
        if (inputs.length === 0) {
            return [];
        }

        const guildId = inputs[0]?.guildId;
        if (!guildId) {
            return [];
        }

        const state = this.getOrCreateQueue(guildId);
        const created: QueueEntry[] = [];
        for (const input of inputs) {
            if (input.guildId !== guildId) {
                throw new Error("addMany must target one guild per call.");
            }
            const entry = this.createEntry(state, input);
            state.entries.push(entry);
            created.push(entry);
        }

        this.bumpRevision(state);
        for (const entry of created) {
            this.emitEntryAdded(entry);
        }

        return created.map((entry) => this.cloneEntry(entry));
    }

    public skip(guildId: string): QueueEntry | null {
        const state = this.getOrCreateQueue(guildId);
        if (state.entries.length === 0) {
            return null;
        }

        if (state.currentIndex === null) {
            state.currentIndex = 0;
            this.bumpRevision(state);
            const first = state.entries[0];
            return first ? this.cloneEntry(first) : null;
        }

        const current = state.entries[state.currentIndex];
        if (current && current.state !== "failed") {
            current.state = "finished";
            this.emitEntryUpdated(current);
        }

        const nextIndex = this.computeNextIndex(state, true);
        if (nextIndex === null) {
            state.currentIndex = null;
            state.playbackState = "idle";
            this.bumpRevision(state);
            return null;
        }

        state.currentIndex = nextIndex;
        state.playbackState = "idle";
        this.bumpRevision(state);

        const next = state.entries[nextIndex];
        return next ? this.cloneEntry(next) : null;
    }

    public stop(guildId: string): void {
        const state = this.getOrCreateQueue(guildId);
        if (state.currentIndex !== null) {
            const current = state.entries[state.currentIndex];
            if (current && current.state !== "failed" && current.state !== "finished") {
                current.state = "finished";
                this.emitEntryUpdated(current);
            }
        }
        state.currentIndex = null;
        state.playbackState = "stopped";
        state.activePlaybackJobId = null;
        state.activeWarmJobId = null;
        this.bumpRevision(state);
    }

    public pause(guildId: string): void {
        const state = this.getOrCreateQueue(guildId);
        state.playbackState = "paused";
        this.bumpRevision(state);
    }

    public resume(guildId: string): void {
        const state = this.getOrCreateQueue(guildId);
        state.playbackState = "playing";
        this.bumpRevision(state);
    }

    public clear(guildId: string): void {
        const state = this.getOrCreateQueue(guildId);
        const removedEntries = [...state.entries];
        const removedCount = removedEntries.length;

        state.entries = [];
        state.currentIndex = null;
        state.playbackState = "idle";
        state.activePlaybackJobId = null;
        state.activeWarmJobId = null;
        this.bumpRevision(state);

        for (const entry of removedEntries) {
            void this.events.emit("queue_entry_removed", {
                guildId,
                entryId: entry.id
            });
        }

        void this.events.emit("queue_cleared", {
            guildId,
            removedCount
        });
    }

    public remove(guildId: string, entryId: string): QueueEntry | null {
        const state = this.getOrCreateQueue(guildId);
        const index = state.entries.findIndex((entry) => entry.id === entryId);
        if (index < 0) {
            return null;
        }

        const removed = state.entries.splice(index, 1)[0];
        if (!removed) {
            return null;
        }

        this.reindexEntries(state);
        if (state.currentIndex !== null) {
            if (state.entries.length === 0) {
                state.currentIndex = null;
                state.playbackState = "idle";
            } else if (index < state.currentIndex) {
                state.currentIndex -= 1;
            } else if (index === state.currentIndex) {
                if (state.currentIndex >= state.entries.length) {
                    state.currentIndex = state.entries.length - 1;
                }
                state.playbackState = "idle";
            }
        }

        this.bumpRevision(state);
        void this.events.emit("queue_entry_removed", {
            guildId,
            entryId: removed.id
        });

        return this.cloneEntry(removed);
    }

    public move(guildId: string, fromPosition: number, toPosition: number): boolean {
        const state = this.getOrCreateQueue(guildId);
        if (!isValidPosition(fromPosition, state.entries.length) || !isValidPosition(toPosition, state.entries.length)) {
            return false;
        }
        if (fromPosition === toPosition) {
            return true;
        }

        const moving = state.entries.splice(fromPosition, 1)[0];
        if (!moving) {
            return false;
        }
        state.entries.splice(toPosition, 0, moving);

        const currentIndex = state.currentIndex;
        if (currentIndex !== null) {
            if (currentIndex === fromPosition) {
                state.currentIndex = toPosition;
            } else if (fromPosition < currentIndex && toPosition >= currentIndex) {
                state.currentIndex = currentIndex - 1;
            } else if (fromPosition > currentIndex && toPosition <= currentIndex) {
                state.currentIndex = currentIndex + 1;
            }
        }

        this.reindexEntries(state);
        this.bumpRevision(state);
        this.emitQueueEntriesUpdated(state);
        return true;
    }

    public shuffle(guildId: string): void {
        const state = this.getOrCreateQueue(guildId);
        if (state.entries.length <= 1) {
            state.shuffleEnabled = true;
            this.bumpRevision(state);
            return;
        }

        const currentEntryId = state.currentIndex !== null
            ? state.entries[state.currentIndex]?.id ?? null
            : null;

        for (let i = state.entries.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const left = state.entries[i];
            const right = state.entries[j];
            if (!left || !right) {
                continue;
            }
            state.entries[i] = right;
            state.entries[j] = left;
        }

        if (currentEntryId) {
            const newCurrentIndex = state.entries.findIndex((entry) => entry.id === currentEntryId);
            state.currentIndex = newCurrentIndex >= 0 ? newCurrentIndex : null;
        }

        state.shuffleEnabled = true;
        this.reindexEntries(state);
        this.bumpRevision(state);
        this.emitQueueEntriesUpdated(state);
    }

    public setLoopMode(guildId: string, loopMode: LoopMode): void {
        const state = this.getOrCreateQueue(guildId);
        state.loopMode = loopMode;
        this.bumpRevision(state);
    }

    public setShuffle(guildId: string, enabled: boolean): void {
        const state = this.getOrCreateQueue(guildId);
        state.shuffleEnabled = enabled;
        this.bumpRevision(state);
    }

    public setPlaybackState(guildId: string, playbackState: PlaybackState): void {
        const state = this.getOrCreateQueue(guildId);
        state.playbackState = playbackState;
        this.bumpRevision(state);
    }

    public setActiveWarmJob(guildId: string, warmJobId: string | null): void {
        const state = this.getOrCreateQueue(guildId);
        state.activeWarmJobId = warmJobId;
        this.bumpRevision(state);
    }

    public setActivePlaybackJob(guildId: string, playbackJobId: string | null): void {
        const state = this.getOrCreateQueue(guildId);
        state.activePlaybackJobId = playbackJobId;
        this.bumpRevision(state);
    }

    public findEntry(guildId: string, entryId: string): QueueEntry | null {
        const state = this.getOrCreateQueue(guildId);
        const found = state.entries.find((entry) => entry.id === entryId);
        return found ? this.cloneEntry(found) : null;
    }

    public updateEntryState(
        guildId: string,
        entryId: string,
        nextState: QueueEntryState,
        options: {
            errorMessage?: string | null;
            resolvedTrackId?: string | null;
            title?: string | null;
            artists?: string[];
            durationMs?: number | null;
        } = {}
    ): QueueEntry | null {
        const state = this.getOrCreateQueue(guildId);
        const entry = state.entries.find((item) => item.id === entryId);
        if (!entry) {
            return null;
        }

        if (!isStateTransitionAllowed(entry.state, nextState)) {
            this.logger.warn(
                `Illegal queue state transition ignored for entry ${entry.id}: ${entry.state} -> ${nextState}`
            );
            return null;
        }

        entry.state = nextState;
        if (Object.prototype.hasOwnProperty.call(options, "errorMessage")) {
            entry.errorMessage = options.errorMessage ?? null;
        }
        if (Object.prototype.hasOwnProperty.call(options, "resolvedTrackId")) {
            entry.resolvedTrackId = options.resolvedTrackId ?? null;
        }
        if (Object.prototype.hasOwnProperty.call(options, "title")) {
            entry.title = options.title ?? null;
        }
        if (Object.prototype.hasOwnProperty.call(options, "artists")) {
            entry.artists = options.artists ?? [];
        }
        if (Object.prototype.hasOwnProperty.call(options, "durationMs")) {
            entry.durationMs = options.durationMs ?? null;
        }

        this.bumpRevision(state);
        this.emitEntryUpdated(entry);
        return this.cloneEntry(entry);
    }

    public setEntryResolvedTrack(
        guildId: string,
        entryId: string,
        resolvedTrackId: string,
        metadata: {
            title: string | null;
            artists: string[];
            durationMs: number | null;
        }
    ): QueueEntry | null {
        return this.updateEntryState(guildId, entryId, "resolved", {
            resolvedTrackId,
            title: metadata.title,
            artists: metadata.artists,
            durationMs: metadata.durationMs
        });
    }

    public markCurrentPlaying(guildId: string): QueueEntry | null {
        const state = this.getOrCreateQueue(guildId);
        if (state.currentIndex === null) {
            return null;
        }
        const current = state.entries[state.currentIndex];
        if (!current) {
            return null;
        }

        const allowed = isStateTransitionAllowed(current.state, "playing");
        if (!allowed) {
            return this.cloneEntry(current);
        }

        current.state = "playing";
        state.playbackState = "playing";
        this.bumpRevision(state);
        this.emitEntryUpdated(current);
        return this.cloneEntry(current);
    }

    public finishCurrentAndAdvance(guildId: string): { finished: QueueEntry | null; next: QueueEntry | null } {
        const state = this.getOrCreateQueue(guildId);
        if (state.currentIndex === null) {
            return { finished: null, next: null };
        }

        const current = state.entries[state.currentIndex] ?? null;
        const finishedSnapshot = current ? this.cloneEntry(current) : null;
        if (state.loopMode === "track" && current && current.state !== "failed") {
            if (isStateTransitionAllowed(current.state, "ready")) {
                current.state = "ready";
                this.emitEntryUpdated(current);
            }
            state.playbackState = "idle";
            this.bumpRevision(state);
            return {
                finished: finishedSnapshot,
                next: this.cloneEntry(current)
            };
        }

        if (current && current.state !== "failed" && isStateTransitionAllowed(current.state, "finished")) {
            current.state = "finished";
            this.emitEntryUpdated(current);
        }

        const nextIndex = this.computeNextIndex(state, false);
        if (nextIndex === null) {
            if (state.loopMode === "queue") {
                const resetCount = this.resetFinishedEntriesForQueueLoop(state);
                if (resetCount > 0) {
                    const wrappedIndex = this.findFirstPlayableIndex(state);
                    if (wrappedIndex !== null) {
                        state.currentIndex = wrappedIndex;
                        state.playbackState = "idle";
                        this.bumpRevision(state);
                        const wrapped = state.entries[wrappedIndex] ?? null;
                        return {
                            finished: finishedSnapshot,
                            next: wrapped ? this.cloneEntry(wrapped) : null
                        };
                    }
                }
            }

            state.currentIndex = null;
            state.playbackState = "idle";
            this.bumpRevision(state);
            return { finished: finishedSnapshot, next: null };
        }

        state.currentIndex = nextIndex;
        state.playbackState = "idle";
        this.bumpRevision(state);
        const next = state.entries[nextIndex] ?? null;

        return {
            finished: finishedSnapshot,
            next: next ? this.cloneEntry(next) : null
        };
    }

    private computeNextIndex(state: GuildQueueState, forceAdvance: boolean): number | null {
        if (state.entries.length === 0) {
            return null;
        }

        const currentIndex = state.currentIndex;
        if (currentIndex === null) {
            return this.findFirstPlayableIndex(state);
        }

        const currentEntry = state.entries[currentIndex];
        if (!forceAdvance && state.loopMode === "track" && currentEntry && !isTerminalState(currentEntry.state)) {
            return currentIndex;
        }

        if (state.shuffleEnabled && state.entries.length > 1) {
            const candidates = state.entries
                .map((_, index) => index)
                .filter((index) => {
                    if (index === currentIndex) {
                        return false;
                    }
                    const entry = state.entries[index];
                    return Boolean(entry && !isTerminalState(entry.state));
                });
            if (candidates.length > 0) {
                const randomIndex = Math.floor(Math.random() * candidates.length);
                const selected = candidates[randomIndex];
                if (typeof selected === "number") {
                    return selected;
                }
            }
        }

        for (let i = currentIndex + 1; i < state.entries.length; i++) {
            const entry = state.entries[i];
            if (!entry || isTerminalState(entry.state)) {
                continue;
            }
            return i;
        }

        if (state.loopMode === "queue") {
            for (let i = 0; i < currentIndex; i++) {
                const entry = state.entries[i];
                if (!entry || isTerminalState(entry.state)) {
                    continue;
                }
                return i;
            }
        }

        return null;
    }

    private findFirstPlayableIndex(state: GuildQueueState): number | null {
        for (let i = 0; i < state.entries.length; i++) {
            const entry = state.entries[i];
            if (!entry || isTerminalState(entry.state)) {
                continue;
            }
            return i;
        }
        return null;
    }

    private resetFinishedEntriesForQueueLoop(state: GuildQueueState): number {
        let changed = 0;
        for (const entry of state.entries) {
            if (entry.state !== "finished") {
                continue;
            }
            entry.state = "ready";
            this.emitEntryUpdated(entry);
            changed += 1;
        }
        return changed;
    }

    private createEntry(state: GuildQueueState, input: AddQueueEntryInput): QueueEntry {
        const now = new Date().toISOString();
        return {
            id: randomUUID(),
            guildId: input.guildId,
            requestedBy: input.requestedBy,
            input: input.input,
            inputType: input.inputType,
            title: input.title ?? null,
            artists: input.artists ?? [],
            durationMs: input.durationMs ?? null,
            state: input.state ?? "queued",
            resolvedTrackId: input.resolvedTrackId ?? null,
            position: state.entries.length,
            createdAt: now,
            errorMessage: null
        };
    }

    private getOrCreateQueue(guildId: string): GuildQueueState {
        const existing = this.queues.get(guildId);
        if (existing) {
            return existing;
        }

        const created: GuildQueueState = {
            guildId,
            entries: [],
            currentIndex: null,
            loopMode: "off",
            shuffleEnabled: false,
            playbackState: "idle",
            activeWarmJobId: null,
            activePlaybackJobId: null,
            revision: 0
        };
        this.queues.set(guildId, created);
        return created;
    }

    private bumpRevision(state: GuildQueueState): void {
        state.revision += 1;
    }

    private reindexEntries(state: GuildQueueState): void {
        for (let i = 0; i < state.entries.length; i++) {
            const entry = state.entries[i];
            if (!entry) {
                continue;
            }
            entry.position = i;
        }
    }

    private emitEntryAdded(entry: QueueEntry): void {
        void this.events.emit("queue_entry_added", {
            guildId: entry.guildId,
            entry: this.cloneEntry(entry)
        });
    }

    private emitEntryUpdated(entry: QueueEntry): void {
        void this.events.emit("queue_entry_updated", {
            guildId: entry.guildId,
            entry: this.cloneEntry(entry)
        });
    }

    private emitQueueEntriesUpdated(state: GuildQueueState): void {
        for (const entry of state.entries) {
            this.emitEntryUpdated(entry);
        }
    }

    private cloneQueueState(state: GuildQueueState): GuildQueueState {
        return {
            guildId: state.guildId,
            entries: state.entries.map((entry) => this.cloneEntry(entry)),
            currentIndex: state.currentIndex,
            loopMode: state.loopMode,
            shuffleEnabled: state.shuffleEnabled,
            playbackState: state.playbackState,
            activeWarmJobId: state.activeWarmJobId,
            activePlaybackJobId: state.activePlaybackJobId,
            revision: state.revision
        };
    }

    private cloneEntry(entry: QueueEntry): QueueEntry {
        return {
            ...entry
        };
    }
}

function isValidPosition(position: number, length: number): boolean {
    return Number.isInteger(position) && position >= 0 && position < length;
}

function isTerminalState(state: QueueEntryState): boolean {
    return state === "finished" || state === "failed";
}

const ACTIVE_STATES = new Set<QueueEntryState>([
    "queued",
    "resolving_meta",
    "resolved",
    "warming",
    "ready",
    "playing"
]);

const STATE_TRANSITIONS: Record<QueueEntryState, Set<QueueEntryState>> = {
    queued: new Set(["resolving_meta", "failed"]),
    resolving_meta: new Set(["resolved", "failed"]),
    resolved: new Set(["warming", "ready", "playing", "failed"]),
    warming: new Set(["ready", "failed"]),
    ready: new Set(["playing", "failed"]),
    playing: new Set(["ready", "finished", "failed"]),
    finished: new Set([]),
    failed: new Set([])
};

function isStateTransitionAllowed(from: QueueEntryState, to: QueueEntryState): boolean {
    if (from === to) {
        return true;
    }
    if (to === "failed" && ACTIVE_STATES.has(from)) {
        return true;
    }
    return STATE_TRANSITIONS[from].has(to);
}

export type {
    AddQueueEntryInput
};

export {
    QueueService
};
