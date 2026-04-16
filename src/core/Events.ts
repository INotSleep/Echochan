import type {
    CacheAssetEventPayload,
    PrefetchEventPayload,
    QueueClearedPayload,
    QueueEntryEventPayload,
    QueueEntryRemovedPayload,
    TrackEventPayload,
    TrackFailedPayload
} from "../playback/types.js";

export interface Events {
    "core.ready": undefined;
    "test": { message: string };

    "queue_entry_added": QueueEntryEventPayload;
    "queue_entry_updated": QueueEntryEventPayload;
    "queue_entry_removed": QueueEntryRemovedPayload;
    "queue_cleared": QueueClearedPayload;

    "track_resolving": TrackEventPayload;
    "track_resolved": TrackEventPayload;
    "track_warming": TrackEventPayload;
    "track_ready": TrackEventPayload;
    "track_started": TrackEventPayload;
    "track_finished": TrackEventPayload;
    "track_failed": TrackFailedPayload;

    "prefetch_started": PrefetchEventPayload;
    "prefetch_cancelled": PrefetchEventPayload;

    "cache_asset_ready": CacheAssetEventPayload;
    "cache_asset_evicted": CacheAssetEventPayload;
}
