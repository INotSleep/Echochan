import path from "node:path";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import type { EventBus } from "../core/EventBus.js";
import type { Events as EchochanEvents } from "../core/Events.js";
import type { Logger } from "../core/Logger.js";
import type { ResolverClient } from "../resolver/client/ResolverClient.js";
import type { ResolveCandidate, ResolvedEntry, SourceType } from "../resolver/contracts.js";
import {
    BinaryDownloadError,
    BinaryDownloadService
} from "../services/BinaryDownloadService.js";
import { LocalResolverError } from "../services/LocalResolverService.js";
import { MusicPlaybackService } from "../services/MusicPlaybackService.js";
import { CacheManager } from "./CacheManager.js";
import type { AddQueueEntryInput } from "./QueueService.js";
import { QueueService } from "./QueueService.js";
import type { CacheAsset, GuildQueueState, LoopMode, QueueEntry, QueueInputType, ResolvedTrack } from "./types.js";

type CoordinatorOptions = {
    playlistImportLimit?: number;
    resolveConcurrency?: number;
    warmConcurrency?: number;
};

type EnqueueInput = {
    guildId: string;
    requestedBy: string;
    input: string;
    requestId?: string;
};

type EnqueueResult = {
    addedCount: number;
    playlistTruncated: boolean;
    sourceType: SourceType;
};

type PlaybackSource = {
    source: string;
    cacheKey: string | null;
};

type PrefetchJob = {
    guildId: string;
    entryId: string;
    jobId: string;
};

class PlaybackCoordinator {
    private readonly logger: Logger;
    private readonly events: EventBus<EchochanEvents>;
    private readonly queue: QueueService;
    private readonly cache: CacheManager;
    private readonly resolver: ResolverClient;
    private readonly downloader: BinaryDownloadService;
    private readonly music: MusicPlaybackService;
    private readonly playlistImportLimit: number;
    private readonly resolveLimiter: TaskLimiter;
    private readonly warmLimiter: TaskLimiter;
    private readonly serializedByGuild = new Map<string, Promise<void>>();
    private readonly prefetchJobs = new Map<string, PrefetchJob>();
    private readonly resolvedTracksById = new Map<string, ResolvedTrack>();
    private readonly activeAssetByGuild = new Map<string, string>();
    private readonly resolveInFlight = new Map<string, Promise<ResolvedTrack | null>>();
    private readonly warmInFlightByCacheKey = new Map<string, Promise<CacheAsset | null>>();

    constructor(
        events: EventBus<EchochanEvents>,
        logger: Logger,
        queue: QueueService,
        cache: CacheManager,
        resolver: ResolverClient,
        downloader: BinaryDownloadService,
        music: MusicPlaybackService,
        options: CoordinatorOptions = {}
    ) {
        this.events = events;
        this.logger = logger.child("PlaybackCoordinator");
        this.queue = queue;
        this.cache = cache;
        this.resolver = resolver;
        this.downloader = downloader;
        this.music = music;
        this.playlistImportLimit = options.playlistImportLimit ?? 200;
        this.resolveLimiter = new TaskLimiter(options.resolveConcurrency ?? 4);
        this.warmLimiter = new TaskLimiter(options.warmConcurrency ?? 2);

        this.music.onTrackIdle((guildId) => {
            void this.onTrackIdle(guildId);
        });

        this.music.onTrackError(({ guildId, error }) => {
            void this.onTrackError(guildId, error);
        });
    }

    public async enqueue(input: EnqueueInput): Promise<EnqueueResult> {
        const normalizedInput = input.input.trim();
        if (!normalizedInput) {
            throw new Error("Input cannot be empty.");
        }

        const detected = detectSourceType(normalizedInput);
        if (detected === "spotify_playlist") {
            const result = await this.expandPlaylist({
                ...input,
                input: normalizedInput
            });
            void this.ensurePlayback(input.guildId);
            return result;
        }

        this.queue.add({
            guildId: input.guildId,
            requestedBy: input.requestedBy,
            input: normalizedInput,
            inputType: mapSourceTypeToQueueInputType(detected),
            state: "queued"
        });

        void this.ensurePlayback(input.guildId);
        return {
            addedCount: 1,
            playlistTruncated: false,
            sourceType: detected
        };
    }

    public async ensurePlayback(guildId: string): Promise<void> {
        await this.runSerialized(guildId, async () => {
            await this.orchestrate(guildId);
        });
    }

    public async skip(guildId: string): Promise<void> {
        await this.runSerialized(guildId, async () => {
            const current = this.queue.getCurrentEntry(guildId);
            if (!current) {
                return;
            }

            this.music.stop(guildId);
            this.releaseGuildAsset(guildId);
            this.cancelPrefetch(guildId);

            if (current.state === "playing") {
                void this.events.emit("track_finished", {
                    guildId,
                    entryId: current.id
                });
            }

            this.queue.skip(guildId);
            await this.orchestrate(guildId);
        });
    }

    public async stop(guildId: string, clearQueue: boolean = false): Promise<void> {
        await this.runSerialized(guildId, async () => {
            this.music.stop(guildId);
            this.releaseGuildAsset(guildId);
            this.cancelPrefetch(guildId);
            this.queue.stop(guildId);
            if (clearQueue) {
                this.queue.clear(guildId);
            }
        });
    }

    public async clear(guildId: string): Promise<void> {
        await this.stop(guildId, true);
    }

    public pause(guildId: string): boolean {
        const paused = this.music.pause(guildId);
        if (paused) {
            this.queue.pause(guildId);
        }
        return paused;
    }

    public pauseAndKeepState(guildId: string): void {
        this.queue.pause(guildId);
    }

    public resume(guildId: string): boolean {
        const resumed = this.music.resume(guildId);
        if (resumed) {
            this.queue.resume(guildId);
        }
        return resumed;
    }

    public setLoopMode(guildId: string, loopMode: LoopMode): void {
        this.queue.setLoopMode(guildId, loopMode);
        void this.ensurePlayback(guildId);
    }

    public setShuffle(guildId: string, enabled: boolean): void {
        this.queue.setShuffle(guildId, enabled);
        if (enabled) {
            this.queue.shuffle(guildId);
        }
        this.cancelPrefetch(guildId);
        void this.ensurePlayback(guildId);
    }

    public remove(guildId: string, entryId: string): boolean {
        const removed = this.queue.remove(guildId, entryId);
        if (!removed) {
            return false;
        }
        this.cancelPrefetch(guildId);
        void this.ensurePlayback(guildId);
        return true;
    }

    public move(guildId: string, fromPosition: number, toPosition: number): boolean {
        const moved = this.queue.move(guildId, fromPosition, toPosition);
        if (!moved) {
            return false;
        }
        this.cancelPrefetch(guildId);
        void this.ensurePlayback(guildId);
        return true;
    }

    public shuffle(guildId: string): void {
        this.queue.shuffle(guildId);
        this.cancelPrefetch(guildId);
        void this.ensurePlayback(guildId);
    }

    public getQueue(guildId: string): GuildQueueState {
        return this.queue.getQueue(guildId);
    }

    private async orchestrate(guildId: string): Promise<void> {
        const snapshot = this.queue.getQueue(guildId);
        if (snapshot.playbackState === "playing" || snapshot.playbackState === "paused") {
            this.ensurePrefetch(guildId);
            return;
        }

        let current = this.queue.ensureCurrent(guildId);
        if (!current) {
            this.cancelPrefetch(guildId);
            return;
        }

        const maxAdvanceAttempts = Math.max(1, snapshot.entries.length + 2);
        let advanceAttempts = 0;
        while (current && (current.state === "failed" || current.state === "finished")) {
            advanceAttempts += 1;
            if (advanceAttempts > maxAdvanceAttempts) {
                this.logger.error(
                    `Orchestration loop guard triggered for guild ${guildId}. Prevented infinite terminal-state cycling.`
                );
                this.cancelPrefetch(guildId);
                return;
            }
            this.queue.skip(guildId);
            current = this.queue.ensureCurrent(guildId);
        }

        if (!current) {
            this.cancelPrefetch(guildId);
            return;
        }

        const source = await this.prepareCurrentSource(guildId, current);
        if (!source) {
            const afterFail = this.queue.finishCurrentAndAdvance(guildId);
            if (!afterFail.next) {
                this.cancelPrefetch(guildId);
                return;
            }
            await this.orchestrate(guildId);
            return;
        }

        const started = this.music.playInGuild(guildId, source.source);
        if (!started) {
            this.logger.warn(`Cannot start playback in guild ${guildId}: no active voice connection.`);
            return;
        }

        const playing = this.queue.markCurrentPlaying(guildId);
        if (!playing) {
            return;
        }

        this.assignGuildAsset(guildId, source.cacheKey);
        void this.events.emit("track_started", {
            guildId,
            entryId: playing.id
        });

        this.ensurePrefetch(guildId);
    }

    private async prepareCurrentSource(guildId: string, entry: QueueEntry): Promise<PlaybackSource | null> {
        const track = await this.ensureResolvedTrack(guildId, entry.id);
        if (!track) {
            return null;
        }

        const ranked = this.rankCandidatesForCurrent(track);
        for (const candidate of ranked) {
            const cacheKey = this.getCandidateCacheKey(track, candidate);
            const ready = this.cache.getReadyAsset(cacheKey);
            if (ready) {
                this.queue.updateEntryState(guildId, entry.id, "ready");
                void this.events.emit("track_ready", {
                    guildId,
                    entryId: entry.id
                });
                return {
                    source: ready.filePath,
                    cacheKey
                };
            }

            const warmed = await this.warmEntryCandidate(guildId, entry.id, track, candidate);
            if (warmed) {
                return {
                    source: warmed.filePath,
                    cacheKey: warmed.cacheKey
                };
            }
        }

        await this.markEntryFailed(guildId, entry.id, "No downloadable candidates available.");
        return null;
    }

    private async ensureResolvedTrack(guildId: string, entryId: string): Promise<ResolvedTrack | null> {
        const queueEntry = this.queue.findEntry(guildId, entryId);
        if (!queueEntry) {
            return null;
        }

        if (queueEntry.resolvedTrackId) {
            const existingTrack = this.resolvedTracksById.get(queueEntry.resolvedTrackId);
            if (existingTrack) {
                return existingTrack;
            }
        }

        const existingResolve = this.resolveInFlight.get(entryId);
        if (existingResolve) {
            return existingResolve;
        }

        const resolvePromise = this.resolveEntryWithProvider(guildId, queueEntry);
        this.resolveInFlight.set(entryId, resolvePromise);
        try {
            return await resolvePromise;
        } finally {
            this.resolveInFlight.delete(entryId);
        }
    }

    private async resolveEntryWithProvider(guildId: string, entry: QueueEntry): Promise<ResolvedTrack | null> {
        this.logger.info(
            `Resolving entry ${entry.id} in guild ${guildId}. inputType=${entry.inputType} input=${entry.input}`
        );
        this.queue.updateEntryState(guildId, entry.id, "resolving_meta");
        void this.events.emit("track_resolving", {
            guildId,
            entryId: entry.id
        });

        try {
            const result = await this.resolveLimiter.run(() => this.resolver.resolve({
                input: entry.input,
                requestedBy: entry.requestedBy,
                requestId: `${guildId}:${entry.id}`
            }));

            const first = result.entries[0];
            if (!first) {
                await this.markEntryFailed(guildId, entry.id, "Resolver returned no entries.");
                return null;
            }

            this.logger.info(
                `Resolved entry ${entry.id} in guild ${guildId}. sourceType=${result.sourceType} entries=${result.entries.length}`
            );

            const normalized = this.toResolvedTrack(entry, first);
            this.resolvedTracksById.set(normalized.id, normalized);
            this.queue.setEntryResolvedTrack(guildId, entry.id, normalized.id, {
                title: normalized.title,
                durationMs: normalized.durationMs
            });

            void this.events.emit("track_resolved", {
                guildId,
                entryId: entry.id
            });

            return normalized;
        } catch (error) {
            const reason = this.describeResolveError(error);
            await this.markEntryFailed(guildId, entry.id, reason);
            return null;
        }
    }

    private async warmEntryCandidate(
        guildId: string,
        entryId: string,
        track: ResolvedTrack,
        candidate: ResolveCandidate
    ): Promise<CacheAsset | null> {
        if (candidate.kind !== "download") {
            return null;
        }

        this.logger.info(
            `Warming entry ${entryId} in guild ${guildId}. provider=${candidate.provider} candidate=${candidate.id} input=${candidate.url ?? track.originalUrl}`
        );

        const cacheKey = this.getCandidateCacheKey(track, candidate);
        const ready = this.cache.getReadyAsset(cacheKey);
        if (ready) {
            this.logger.info(
                `Cache hit for entry ${entryId} in guild ${guildId}. cacheKey=${cacheKey}`
            );
            return ready;
        }

        const existingWarm = this.warmInFlightByCacheKey.get(cacheKey);
        if (existingWarm) {
            return existingWarm;
        }

        const warmPromise = this.warmLimiter.run(async () => {
            this.queue.updateEntryState(guildId, entryId, "warming");
            void this.events.emit("track_warming", {
                guildId,
                entryId
            });

            const extension = inferExtension(candidate);
            const reserved = await this.cache.reserveTempAsset({
                cacheKey,
                extension,
                producer: candidate.provider
            });

            try {
                const outputDir = path.dirname(reserved.tempPath);
                const fileName = path.basename(reserved.tempPath);
                const input = candidate.url ?? track.originalUrl;

                const downloadResult = await this.downloader.downloadToFile({
                    provider: candidate.provider,
                    input,
                    outputDir,
                    fileName
                });

                if (downloadResult.filePath !== reserved.tempPath) {
                    await safeRename(downloadResult.filePath, reserved.tempPath);
                }

                await safeRename(reserved.tempPath, reserved.finalPath);
                const markedReady = await this.cache.markReady({
                    cacheKey,
                    finalPath: reserved.finalPath
                });

                if (!markedReady || markedReady.state !== "ready") {
                    this.cache.markBroken(cacheKey);
                    return null;
                }

                this.queue.updateEntryState(guildId, entryId, "ready");
                void this.events.emit("track_ready", {
                    guildId,
                    entryId
                });
                this.logger.info(
                    `Warm ready for entry ${entryId} in guild ${guildId}. cacheKey=${cacheKey} path=${markedReady.filePath}`
                );
                return markedReady;
            } catch (error) {
                const message = error instanceof BinaryDownloadError
                    ? error.message
                    : error instanceof Error
                        ? error.message
                        : "Unknown warm failure.";
                this.logger.warn(`Warm failed for entry ${entryId} in guild ${guildId}: ${message}`);
                this.cache.markBroken(cacheKey);
                return null;
            }
        });

        this.warmInFlightByCacheKey.set(cacheKey, warmPromise);
        try {
            return await warmPromise;
        } finally {
            this.warmInFlightByCacheKey.delete(cacheKey);
        }
    }

    private ensurePrefetch(guildId: string): void {
        const next = this.queue.getNextEntry(guildId);
        if (!next) {
            this.cancelPrefetch(guildId);
            return;
        }

        const existing = this.prefetchJobs.get(guildId);
        if (existing && existing.entryId === next.id) {
            return;
        }

        this.cancelPrefetch(guildId);

        const job: PrefetchJob = {
            guildId,
            entryId: next.id,
            jobId: randomUUID()
        };
        this.prefetchJobs.set(guildId, job);
        this.queue.setActiveWarmJob(guildId, job.jobId);

        void this.events.emit("prefetch_started", {
            guildId,
            jobId: job.jobId,
            entryId: job.entryId
        });

        void this.runPrefetchJob(job);
    }

    private cancelPrefetch(guildId: string): void {
        const active = this.prefetchJobs.get(guildId);
        if (!active) {
            return;
        }

        this.prefetchJobs.delete(guildId);
        this.queue.setActiveWarmJob(guildId, null);

        void this.events.emit("prefetch_cancelled", {
            guildId,
            jobId: active.jobId,
            entryId: active.entryId
        });
    }

    private async runPrefetchJob(job: PrefetchJob): Promise<void> {
        try {
            const stillActive = this.prefetchJobs.get(job.guildId);
            if (!stillActive || stillActive.jobId !== job.jobId) {
                return;
            }

            if (!this.isEntryCurrentOrNext(job.guildId, job.entryId)) {
                this.cancelPrefetch(job.guildId);
                return;
            }

            const entry = this.queue.findEntry(job.guildId, job.entryId);
            if (!entry) {
                this.cancelPrefetch(job.guildId);
                return;
            }

            const track = await this.ensureResolvedTrack(job.guildId, entry.id);
            if (!track) {
                return;
            }

            const warmCandidate = this.pickWarmCandidate(track);
            if (!warmCandidate) {
                return;
            }

            const ready = this.cache.getReadyAsset(this.getCandidateCacheKey(track, warmCandidate));
            if (ready) {
                this.queue.updateEntryState(job.guildId, entry.id, "ready");
                void this.events.emit("track_ready", {
                    guildId: job.guildId,
                    entryId: entry.id
                });
                return;
            }

            await this.warmEntryCandidate(job.guildId, entry.id, track, warmCandidate);
        } finally {
            const active = this.prefetchJobs.get(job.guildId);
            if (active && active.jobId === job.jobId) {
                this.prefetchJobs.delete(job.guildId);
                this.queue.setActiveWarmJob(job.guildId, null);
            }
        }
    }

    private async onTrackIdle(guildId: string): Promise<void> {
        await this.runSerialized(guildId, async () => {
            const current = this.queue.getCurrentEntry(guildId);
            if (!current || current.state !== "playing") {
                return;
            }

            this.releaseGuildAsset(guildId);
            void this.events.emit("track_finished", {
                guildId,
                entryId: current.id
            });

            this.queue.finishCurrentAndAdvance(guildId);
            await this.orchestrate(guildId);
        });
    }

    private async onTrackError(guildId: string, error: Error): Promise<void> {
        await this.runSerialized(guildId, async () => {
            const current = this.queue.getCurrentEntry(guildId);
            if (!current) {
                return;
            }

            this.releaseGuildAsset(guildId);
            await this.markEntryFailed(guildId, current.id, error.message || "Playback error.");
            this.queue.finishCurrentAndAdvance(guildId);
            await this.orchestrate(guildId);
        });
    }

    private async markEntryFailed(guildId: string, entryId: string, reason: string): Promise<void> {
        this.logger.warn(`Entry failed in guild ${guildId}. entryId=${entryId} reason=${reason}`);
        this.queue.updateEntryState(guildId, entryId, "failed", {
            errorMessage: reason
        });
        void this.events.emit("track_failed", {
            guildId,
            entryId,
            reason
        });
    }

    private assignGuildAsset(guildId: string, nextCacheKey: string | null): void {
        this.releaseGuildAsset(guildId);
        if (!nextCacheKey) {
            return;
        }
        this.cache.retain(nextCacheKey);
        this.activeAssetByGuild.set(guildId, nextCacheKey);
    }

    private releaseGuildAsset(guildId: string): void {
        const current = this.activeAssetByGuild.get(guildId);
        if (!current) {
            return;
        }
        this.cache.release(current);
        this.activeAssetByGuild.delete(guildId);
    }

    private rankCandidatesForCurrent(track: ResolvedTrack): ResolveCandidate[] {
        const downloadCandidates = this.getDownloadCandidates(track);
        const ready: ResolveCandidate[] = [];
        const download: ResolveCandidate[] = [];

        for (const candidate of downloadCandidates) {
            const cacheKey = this.getCandidateCacheKey(track, candidate);
            const hasReady = this.cache.getReadyAsset(cacheKey);
            if (hasReady) {
                ready.push(candidate);
                continue;
            }

            download.push(candidate);
        }

        return [...ready, ...download];
    }

    private pickWarmCandidate(track: ResolvedTrack): ResolveCandidate | null {
        const downloadCandidates = this.getDownloadCandidates(track);
        for (const candidate of downloadCandidates) {
            const cacheKey = this.getCandidateCacheKey(track, candidate);
            const ready = this.cache.getReadyAsset(cacheKey);
            if (ready) {
                return candidate;
            }
        }
        return downloadCandidates[0] ?? null;
    }

    private getDownloadCandidates(track: ResolvedTrack): ResolveCandidate[] {
        const explicitDownload = track.candidates.filter((candidate) => candidate.kind === "download");
        if (explicitDownload.length > 0) {
            return explicitDownload;
        }

        const fallbackCandidate = track.candidates[0];
        if (!fallbackCandidate) {
            return [];
        }

        return [
            {
                id: `derived-download:${fallbackCandidate.id}`,
                provider: fallbackCandidate.provider,
                kind: "download",
                quality: fallbackCandidate.quality,
                url: null,
                metadata: {
                    ...fallbackCandidate.metadata,
                    derived: true
                }
            }
        ];
    }

    private getCandidateCacheKey(track: ResolvedTrack, candidate: ResolveCandidate): string {
        return this.cache.buildCacheKey({
            canonicalId: track.canonicalId,
            provider: candidate.provider,
            kind: candidate.kind,
            quality: candidate.quality,
            url: candidate.url,
            formatHint: inferExtension(candidate)
        });
    }

    private toResolvedTrack(entry: QueueEntry, resolved: ResolvedEntry): ResolvedTrack {
        const nowIso = new Date().toISOString();
        return {
            id: randomUUID(),
            canonicalId: resolved.canonicalId ?? `entry:${entry.id}`,
            title: resolved.title ?? entry.title ?? null,
            artists: [...resolved.artists],
            durationMs: resolved.durationMs ?? entry.durationMs ?? null,
            artworkUrl: resolved.artworkUrl ?? null,
            sourceKind: mapSourceTypeToQueueInputType(detectSourceType(entry.input)),
            originalUrl: entry.input,
            candidates: [...resolved.candidates],
            preferredCandidateIndex: resolved.candidates.length > 0 ? 0 : null,
            createdAt: nowIso,
            updatedAt: nowIso
        };
    }

    private async expandPlaylist(input: EnqueueInput): Promise<EnqueueResult> {
        const resolvePayload = {
            input: input.input,
            requestedBy: input.requestedBy,
            ...(input.requestId ? { requestId: input.requestId } : {})
        };
        const resolveResult = await this.resolveLimiter.run(() => this.resolver.resolve(resolvePayload));
        const limited = resolveResult.entries.slice(0, this.playlistImportLimit);

        const addInputs: AddQueueEntryInput[] = limited.map((entry) => ({
            guildId: input.guildId,
            requestedBy: input.requestedBy,
            input: inferExpandedTrackInput(entry, input.input),
            inputType: inferExpandedTrackInputType(entry),
            title: entry.title ?? null,
            durationMs: entry.durationMs ?? null,
            state: "queued"
        }));

        if (addInputs.length === 0) {
            this.queue.add({
                guildId: input.guildId,
                requestedBy: input.requestedBy,
                input: input.input,
                inputType: "spotify_playlist",
                state: "queued"
            });
            return {
                addedCount: 1,
                playlistTruncated: false,
                sourceType: "spotify_playlist"
            };
        }

        this.queue.addMany(addInputs);
        return {
            addedCount: addInputs.length,
            playlistTruncated: resolveResult.entries.length > addInputs.length,
            sourceType: "spotify_playlist"
        };
    }

    private isEntryCurrentOrNext(guildId: string, entryId: string): boolean {
        const current = this.queue.getCurrentEntry(guildId);
        if (current && current.id === entryId) {
            return true;
        }
        const next = this.queue.getNextEntry(guildId);
        return Boolean(next && next.id === entryId);
    }

    private describeResolveError(error: unknown): string {
        if (error instanceof LocalResolverError) {
            return `${error.code}: ${error.message}`;
        }
        if (error instanceof Error) {
            return error.message;
        }
        return "Resolver failed.";
    }

    private runSerialized(guildId: string, task: () => Promise<void>): Promise<void> {
        const previous = this.serializedByGuild.get(guildId) ?? Promise.resolve();
        const next = previous
            .catch(() => undefined)
            .then(task)
            .catch((error) => {
                this.logger.error(`Serialized task failed in guild ${guildId}:`, error);
            });

        this.serializedByGuild.set(guildId, next);
        return next;
    }
}

function detectSourceType(input: string): SourceType {
    const spotify = parseSpotifyInput(input);
    if (spotify?.kind === "track") {
        return "spotify_track";
    }
    if (spotify?.kind === "album") {
        return "spotify_album";
    }
    if (spotify?.kind === "playlist") {
        return "spotify_playlist";
    }
    if (/youtu\.be\/|youtube\.com\//i.test(input)) {
        return "youtube";
    }
    const url = safeUrl(input);
    if (url && (url.protocol === "http:" || url.protocol === "https:")) {
        const ext = path.extname(url.pathname).toLowerCase();
        if (ext && [".mp3", ".m4a", ".aac", ".flac", ".wav", ".ogg", ".opus", ".webm", ".mp4", ".mkv"].includes(ext)) {
            return "direct_url";
        }
        return "unknown";
    }
    return "unknown";
}

function parseSpotifyInput(input: string): { kind: "track" | "album" | "playlist"; id: string } | null {
    const uriMatch = input.match(/^spotify:(track|album|playlist):([A-Za-z0-9]+)$/i);
    if (uriMatch) {
        const kindRaw = uriMatch[1]?.toLowerCase();
        const id = uriMatch[2]?.trim();
        if (!id) {
            return null;
        }
        if (kindRaw === "track" || kindRaw === "album" || kindRaw === "playlist") {
            return { kind: kindRaw, id };
        }
    }

    const url = safeUrl(input);
    if (!url || !url.hostname.toLowerCase().endsWith("spotify.com")) {
        return null;
    }

    const parts = url.pathname.split("/").filter(Boolean);
    const kindIndex = parts.findIndex(
        (part) => part === "track" || part === "album" || part === "playlist"
    );
    if (kindIndex < 0) {
        return null;
    }

    const kind = parts[kindIndex];
    const id = parts[kindIndex + 1];
    if (!kind || !id) {
        return null;
    }

    if (kind === "track" || kind === "album" || kind === "playlist") {
        return { kind, id };
    }
    return null;
}

function mapSourceTypeToQueueInputType(sourceType: SourceType): QueueInputType {
    if (sourceType === "spotify_track") {
        return "spotify_track";
    }
    if (sourceType === "spotify_playlist") {
        return "spotify_playlist";
    }
    return "direct_url";
}

function inferExpandedTrackInput(entry: ResolvedEntry, fallbackPlaylistInput: string): string {
    const canonical = entry.canonicalId ?? "";
    const spotifyTrackPrefix = "spotify:track:";
    if (canonical.startsWith(spotifyTrackPrefix)) {
        const id = canonical.slice(spotifyTrackPrefix.length).trim();
        if (id) {
            return `https://open.spotify.com/track/${id}`;
        }
    }

    const youtubePrefix = "youtube:";
    if (canonical.startsWith(youtubePrefix)) {
        const id = canonical.slice(youtubePrefix.length).trim();
        if (id) {
            return `https://www.youtube.com/watch?v=${id}`;
        }
    }

    const streamUrl = entry.candidates.find((candidate) => candidate.kind === "stream" && candidate.url)?.url;
    if (streamUrl) {
        return streamUrl;
    }
    return fallbackPlaylistInput;
}

function inferExpandedTrackInputType(entry: ResolvedEntry): QueueInputType {
    const canonical = entry.canonicalId ?? "";
    if (canonical.startsWith("spotify:track:")) {
        return "spotify_track";
    }
    return "direct_url";
}

function safeUrl(input: string): URL | null {
    try {
        return new URL(input);
    } catch {
        return null;
    }
}

function inferExtension(candidate: ResolveCandidate): string {
    const metadataExt = candidate.metadata.ext;
    if (typeof metadataExt === "string" && metadataExt.trim()) {
        const normalized = metadataExt.trim().toLowerCase();
        if (normalized.startsWith(".")) {
            return normalized;
        }
        return `.${normalized}`;
    }

    if (candidate.url) {
        const parsed = safeUrl(candidate.url);
        if (parsed) {
            const ext = path.extname(parsed.pathname).toLowerCase();
            if (ext) {
                return ext;
            }
        }
    }

    if (candidate.quality === "lossless") {
        return ".flac";
    }
    return ".bin";
}

async function safeRename(fromPath: string, toPath: string): Promise<void> {
    if (fromPath === toPath) {
        return;
    }
    await fs.rename(fromPath, toPath);
}

class TaskLimiter {
    private running = 0;
    private readonly queue: Array<() => void> = [];
    private readonly maxConcurrent: number;

    constructor(maxConcurrent: number) {
        this.maxConcurrent = Math.max(1, Math.floor(maxConcurrent));
    }

    public async run<T>(task: () => Promise<T>): Promise<T> {
        await this.acquire();
        try {
            return await task();
        } finally {
            this.release();
        }
    }

    private acquire(): Promise<void> {
        if (this.running < this.maxConcurrent) {
            this.running += 1;
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            this.queue.push(() => {
                this.running += 1;
                resolve();
            });
        });
    }

    private release(): void {
        this.running = Math.max(0, this.running - 1);
        const next = this.queue.shift();
        if (next) {
            next();
        }
    }
}

export type {
    CoordinatorOptions,
    EnqueueInput,
    EnqueueResult
};

export {
    PlaybackCoordinator
};
