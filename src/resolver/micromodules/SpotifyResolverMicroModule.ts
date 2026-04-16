import type { ResolvedEntry, SourceType } from "../contracts.js";
import type { ResolveModuleContext, ResolverMicroModule } from "./contracts.js";
import { getCanonicalId, parseSpotifyInput, readString, stableId } from "./shared.js";

type SpotifyResolverMicroModuleOptions = {
    timeoutMs: number;
};

type SpotifyMetadata = {
    title: string | null;
    artists: string[];
    artworkUrl: string | null;
};

class SpotifyResolverMicroModule implements ResolverMicroModule {
    public readonly id = "spotiflac" as const;
    private readonly timeoutMs: number;

    constructor(options: SpotifyResolverMicroModuleOptions) {
        this.timeoutMs = options.timeoutMs;
    }

    public canResolve(sourceType: SourceType): boolean {
        return sourceType === "spotify_track" || sourceType === "spotify_album" || sourceType === "spotify_playlist";
    }

    public async resolveByInput(context: ResolveModuleContext): Promise<ResolvedEntry[]> {
        if (!this.canResolve(context.sourceType)) {
            return [];
        }

        const metadata = await fetchSpotifyMetadata(context.input, this.timeoutMs);
        return [createSyntheticSpotifyEntry(context.input, context.sourceType, metadata)];
    }

    public async search(query: string): Promise<string> {
        const normalized = query.trim();
        if (!normalized) {
            return "ytsearch1:spotify track";
        }
        return `ytsearch1:${normalized}`;
    }

    public async downloadByLink(input: string): Promise<string> {
        return input;
    }
}

function createSyntheticSpotifyEntry(
    input: string,
    sourceType: SourceType,
    metadata: SpotifyMetadata | null
): ResolvedEntry {
    const canonical = getCanonicalId(sourceType, input) ?? `spotify:unknown:${stableId("spotify", input)}`;
    const entryId = stableId("entry", canonical);
    const searchQuery = buildYtSearchQuery(metadata);

    return {
        id: entryId,
        title: metadata?.title ?? null,
        artists: metadata?.artists ?? [],
        durationMs: null,
        artworkUrl: metadata?.artworkUrl ?? null,
        originalInput: input,
        canonicalId: canonical,
        candidates: [
            {
                id: stableId("candidate", `${entryId}:spotiflac:download`),
                provider: "spotiflac",
                kind: "download",
                quality: "lossless",
                url: input,
                metadata: {
                    synthetic: true
                }
            },
            {
                id: stableId("candidate", `${entryId}:ytdlp:download`),
                provider: "ytdlp",
                kind: "download",
                quality: "lossy",
                url: searchQuery,
                metadata: {
                    synthetic: true,
                    strategy: "spotify_fallback_search"
                }
            }
        ]
    };
}

async function fetchSpotifyMetadata(input: string, timeoutMs: number): Promise<SpotifyMetadata | null> {
    const parsed = parseSpotifyInput(input);
    if (!parsed) {
        return null;
    }

    const canonicalUrl = `https://open.spotify.com/${parsed.kind}/${parsed.id}`;
    const oembedEndpoint = `https://open.spotify.com/oembed?url=${encodeURIComponent(canonicalUrl)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => {
        controller.abort();
    }, Math.max(1_000, timeoutMs));

    try {
        const response = await fetch(oembedEndpoint, {
            method: "GET",
            signal: controller.signal
        });
        if (!response.ok) {
            return null;
        }

        const payload = await response.json() as {
            title?: unknown;
            thumbnail_url?: unknown;
        };

        const titleRaw = readString(payload.title);
        const thumbnail = readString(payload.thumbnail_url);
        const parsedTitle = normalizeSpotifyTitle(titleRaw);
        const htmlMetadata = await fetchSpotifyHtmlMetadata(canonicalUrl, controller.signal);
        const artists = htmlMetadata.artists;
        const mergedTitle = htmlMetadata.title ?? parsedTitle;
        const mergedArtwork = htmlMetadata.artworkUrl ?? thumbnail;

        return {
            title: mergedTitle,
            artists,
            artworkUrl: mergedArtwork
        };
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function fetchSpotifyHtmlMetadata(url: string, signal: AbortSignal): Promise<SpotifyMetadata> {
    const response = await fetch(url, {
        method: "GET",
        signal
    });
    if (!response.ok) {
        return {
            title: null,
            artists: [],
            artworkUrl: null
        };
    }

    const html = await response.text();
    const metaTitle = readString(extractMetaContent(html, "og:title"));
    const ogDescription = readString(extractMetaContent(html, "og:description"));
    const musician = readString(extractMetaContent(html, "music:musician_description"));
    const thumbnail = readString(extractMetaContent(html, "og:image"));

    const artists: string[] = [];
    if (musician) {
        artists.push(musician);
    } else if (ogDescription) {
        const firstPart = ogDescription.split("·")[0]?.trim();
        if (firstPart) {
            artists.push(firstPart);
        }
    }

    return {
        title: normalizeSpotifyTitle(metaTitle),
        artists,
        artworkUrl: thumbnail
    };
}

function extractMetaContent(html: string, propertyOrName: string): string | null {
    const escaped = escapeRegex(propertyOrName);
    const propertyPattern = new RegExp(
        `<meta\\s+[^>]*property=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`,
        "i"
    );
    const namePattern = new RegExp(
        `<meta\\s+[^>]*name=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`,
        "i"
    );
    const propertyMatch = html.match(propertyPattern);
    if (propertyMatch?.[1]) {
        return propertyMatch[1];
    }
    const nameMatch = html.match(namePattern);
    return nameMatch?.[1] ?? null;
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSpotifyTitle(raw: string | null): string | null {
    if (!raw) {
        return null;
    }
    const cleaned = raw.replace(/\s*\|\s*Spotify$/i, "").trim();
    return cleaned || null;
}

function buildYtSearchQuery(metadata: SpotifyMetadata | null): string {
    const artistPart = metadata?.artists?.[0] ?? "";
    const titlePart = metadata?.title ?? "";
    const query = `${titlePart} ${artistPart} audio`.trim();
    if (!query) {
        return "ytsearch1:spotify track";
    }
    return `ytsearch1:${query}`;
}

export type {
    SpotifyResolverMicroModuleOptions
};

export {
    SpotifyResolverMicroModule
};
