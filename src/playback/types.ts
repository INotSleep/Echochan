import type { ResolveCandidate } from "../resolver/contracts.js";

type QueueInputType =
    | "spotify_track"
    | "spotify_playlist"
    | "direct_url";

type QueueEntryState =
    | "queued"
    | "resolving_meta"
    | "resolved"
    | "warming"
    | "ready"
    | "playing"
    | "finished"
    | "failed";

type LoopMode = "off" | "track" | "queue";
type PlaybackState = "idle" | "playing" | "paused" | "stopped";

type QueueEntry = {
    id: string;
    guildId: string;
    requestedBy: string;
    input: string;
    inputType: QueueInputType;
    title: string | null;
    durationMs: number | null;
    state: QueueEntryState;
    resolvedTrackId: string | null;
    position: number;
    createdAt: string;
    errorMessage: string | null;
};

type GuildQueueState = {
    guildId: string;
    entries: QueueEntry[];
    currentIndex: number | null;
    loopMode: LoopMode;
    shuffleEnabled: boolean;
    playbackState: PlaybackState;
    activeWarmJobId: string | null;
    activePlaybackJobId: string | null;
    revision: number;
};

type ResolvedTrack = {
    id: string;
    canonicalId: string;
    title: string | null;
    artists: string[];
    durationMs: number | null;
    artworkUrl: string | null;
    sourceKind: QueueInputType;
    originalUrl: string;
    candidates: ResolveCandidate[];
    preferredCandidateIndex: number | null;
    createdAt: string;
    updatedAt: string;
};

type CacheAssetState = "temp" | "ready" | "broken";

type CacheAsset = {
    cacheKey: string;
    filePath: string;
    format: string;
    sizeBytes: number;
    state: CacheAssetState;
    producer: "spotiflac" | "ytdlp";
    lastAccessAt: string;
    refCount: number;
    expiresAt: string | null;
    createdAt: string;
    updatedAt: string;
};

type TrackEventPayload = {
    guildId: string;
    entryId: string;
};

type QueueEntryEventPayload = {
    guildId: string;
    entry: QueueEntry;
};

type QueueEntryRemovedPayload = {
    guildId: string;
    entryId: string;
};

type QueueClearedPayload = {
    guildId: string;
    removedCount: number;
};

type PrefetchEventPayload = {
    guildId: string;
    jobId: string;
    entryId: string;
};

type CacheAssetEventPayload = {
    cacheKey: string;
    asset: CacheAsset;
};

type TrackFailedPayload = {
    guildId: string;
    entryId: string;
    reason: string;
};

export type {
    QueueInputType,
    QueueEntryState,
    LoopMode,
    PlaybackState,
    QueueEntry,
    GuildQueueState,
    ResolvedTrack,
    CacheAssetState,
    CacheAsset,
    TrackEventPayload,
    QueueEntryEventPayload,
    QueueEntryRemovedPayload,
    QueueClearedPayload,
    PrefetchEventPayload,
    CacheAssetEventPayload,
    TrackFailedPayload
};
