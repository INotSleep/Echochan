type ResolveInput = {
    input: string;
    requestedBy?: string;
    requestId?: string;
};

type SourceType =
    | "spotify_track"
    | "spotify_album"
    | "spotify_playlist"
    | "youtube"
    | "direct_url"
    | "unknown";

type ResolveProvider = "spotify" | "ytdlp";
type ResolveKind = "stream" | "download";
type ResolveQuality = "lossless" | "lossy" | "unknown";

type ResolveCandidate = {
    id: string;
    provider: ResolveProvider;
    kind: ResolveKind;
    quality: ResolveQuality;
    url: string | null;
    metadata: Record<string, unknown>;
};

type ResolvedEntry = {
    id: string;
    title: string | null;
    artists: string[];
    durationMs: number | null;
    artworkUrl: string | null;
    originalInput: string;
    canonicalId: string | null;
    candidates: ResolveCandidate[];
};

type ResolveResult = {
    requestId: string | null;
    sourceType: SourceType;
    entries: ResolvedEntry[];
};

type ResolveErrorCode =
    | "INVALID_INPUT"
    | "UNSUPPORTED_SOURCE"
    | "NOT_FOUND"
    | "PROVIDER_FAILED"
    | "TIMEOUT"
    | "INTERNAL_ERROR";

type ResolveError = {
    code: ResolveErrorCode;
    message: string;
    requestId: string | null;
};

export type {
    ResolveInput,
    SourceType,
    ResolveProvider,
    ResolveKind,
    ResolveQuality,
    ResolveCandidate,
    ResolvedEntry,
    ResolveResult,
    ResolveErrorCode,
    ResolveError
};
