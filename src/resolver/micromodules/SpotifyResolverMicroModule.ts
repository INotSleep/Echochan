import https from "node:https";
import { createRequire } from "node:module";
import type { ResolveCandidate, ResolvedEntry, SourceType } from "../contracts.js";
import type { ResolveModuleContext, ResolverMicroModule } from "./contracts.js";
import { parseSpotifyInput, stableId } from "./shared.js";

const require = createRequire(import.meta.url);
const spotify = require("spotify") as SpotifyPackageClient;

type SpotifyResolverMicroModuleOptions = {
    timeoutMs: number;
    maxPlaylistTracks?: number;
};

type SpotifyTokenCache = {
    token: string;
    expiresAtMs: number;
};

type SpotifyPackageClient = {
    lookup(opts: { type: "track" | "album" | "artist"; id: string }, hollaback: SpotifyCallback): void;
    search(opts: { type: "track" | "album" | "artist"; query: string }, hollaback: SpotifyCallback): void;
    get(query: string, hollaback: SpotifyCallback): void;
};

type SpotifyCallback = (err: unknown, data: unknown) => void;

type SpotifyArtist = {
    name: string;
};

type SpotifyImage = {
    url: string;
};

type SpotifyTrack = {
    id: string;
    name: string;
    durationMs: number | null;
    artists: SpotifyArtist[];
    artworkUrl: string | null;
};

class SpotifyResolverMicroModule implements ResolverMicroModule {
    public readonly id = "spotify" as const;
    private readonly timeoutMs: number;
    private readonly maxPlaylistTracks: number;
    private tokenCache: SpotifyTokenCache | null = null;

    constructor(options: SpotifyResolverMicroModuleOptions) {
        this.timeoutMs = Math.max(1_000, options.timeoutMs);
        this.maxPlaylistTracks = options.maxPlaylistTracks ?? 500;
    }

    public canResolve(sourceType: SourceType): boolean {
        return sourceType === "spotify_track" || sourceType === "spotify_album" || sourceType === "spotify_playlist";
    }

    public async resolveByInput(context: ResolveModuleContext): Promise<ResolvedEntry[]> {
        if (!this.canResolve(context.sourceType)) {
            return [];
        }

        const parsed = parseSpotifyInput(context.input);
        if (!parsed) {
            return [];
        }

        try {
            const token = await this.resolveAccessToken();
            const api = this.createSpotifyClient(token);

            if (parsed.kind === "track") {
                const payload = await this.callSpotify((callback) => {
                    api.lookup({ type: "track", id: parsed.id }, callback);
                });
                const track = extractTrack(payload, null);
                if (!track) {
                    return [];
                }
                return [toResolvedEntry(track, context.input)];
            }

            if (parsed.kind === "album") {
                const payload = await this.callSpotify((callback) => {
                    api.lookup({ type: "album", id: parsed.id }, callback);
                });

                const albumObj = asRecord(payload);
                if (!albumObj) {
                    return [];
                }
                const albumArtwork = extractFirstImageUrl(albumObj.images);
                const tracks = extractTracksFromAlbumPayload(albumObj, albumArtwork);
                return tracks.map((track) => toResolvedEntry(track, context.input));
            }

            const tracks = await this.fetchPlaylistTracks(api, parsed.id);
            return tracks.map((track) => toResolvedEntry(track, context.input));
        } catch {
            const fallback = await buildOEmbedFallbackEntry(context.input, context.sourceType, this.timeoutMs);
            return fallback ? [fallback] : [];
        }
    }

    public async search(query: string): Promise<string> {
        const normalized = query.trim();
        if (!normalized) {
            return "ytsearch5:spotify track";
        }
        return `ytsearch5:${normalized}`;
    }

    public async downloadByLink(input: string): Promise<string> {
        return input;
    }

    private async fetchPlaylistTracks(api: SpotifyPackageClient, playlistId: string): Promise<SpotifyTrack[]> {
        const entries: SpotifyTrack[] = [];
        let nextPath: string | null = `/v1/playlists/${playlistId}?limit=100`;

        while (nextPath && entries.length < this.maxPlaylistTracks) {
            const payload = await this.callSpotify((callback) => {
                api.get(nextPath!, callback);
            });

            const root = asRecord(payload);
            if (!root) {
                break;
            }

            const playlistArtwork = extractFirstImageUrl(root.images);
            const tracksObj = asRecord(root.tracks);
            if (!tracksObj) {
                break;
            }

            const pageItems = Array.isArray(tracksObj.items) ? tracksObj.items : [];
            for (const item of pageItems) {
                const itemObj = asRecord(item);
                if (!itemObj) {
                    continue;
                }

                const trackObj = asRecord(itemObj.track);
                if (!trackObj) {
                    continue;
                }

                const parsedTrack = extractTrack(trackObj, playlistArtwork);
                if (!parsedTrack) {
                    continue;
                }

                entries.push(parsedTrack);
                if (entries.length >= this.maxPlaylistTracks) {
                    break;
                }
            }

            const nextRaw = typeof tracksObj.next === "string" ? tracksObj.next.trim() : "";
            nextPath = extractSpotifyApiPath(nextRaw);
        }

        return entries;
    }

    private async resolveAccessToken(): Promise<string | null> {
        const explicit = process.env.SPOTIFY_ACCESS_TOKEN?.trim();
        if (explicit) {
            return explicit;
        }

        const nowMs = Date.now();
        if (this.tokenCache && this.tokenCache.expiresAtMs > nowMs + 15_000) {
            return this.tokenCache.token;
        }

        const clientId = process.env.SPOTIFY_CLIENT_ID?.trim() ?? "";
        const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim() ?? "";
        if (!clientId || !clientSecret) {
            return null;
        }

        const body = new URLSearchParams({
            grant_type: "client_credentials"
        }).toString();
        const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

        const response = await fetch("https://accounts.spotify.com/api/token", {
            method: "POST",
            headers: {
                "Authorization": `Basic ${basic}`,
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body
        });

        if (!response.ok) {
            return null;
        }

        const payload = await response.json() as {
            access_token?: unknown;
            expires_in?: unknown;
        };
        const token = typeof payload.access_token === "string" ? payload.access_token.trim() : "";
        const expiresIn = Number(payload.expires_in);
        if (!token || !Number.isFinite(expiresIn) || expiresIn <= 0) {
            return null;
        }

        const expiresAtMs = nowMs + Math.floor(expiresIn * 1000);
        this.tokenCache = {
            token,
            expiresAtMs
        };
        return token;
    }

    private createSpotifyClient(token: string | null): SpotifyPackageClient {
        if (!token) {
            return spotify;
        }

        return {
            lookup: spotify.lookup,
            search: spotify.search,
            get: (query: string, hollaback: SpotifyCallback) => {
                requestSpotifyJsonWithToken(query, token, hollaback, this.timeoutMs);
            }
        };
    }

    private async callSpotify(caller: (callback: SpotifyCallback) => void): Promise<unknown> {
        return await new Promise<unknown>((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) {
                    return;
                }
                settled = true;
                reject(new Error("Spotify request timed out."));
            }, this.timeoutMs);

            const callback: SpotifyCallback = (err, data) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);

                if (err) {
                    reject(err instanceof Error ? err : new Error(String(err)));
                    return;
                }

                const errorPayload = extractSpotifyError(data);
                if (errorPayload) {
                    reject(new Error(`Spotify API error ${errorPayload.status}: ${errorPayload.message}`));
                    return;
                }

                resolve(data);
            };

            try {
                caller(callback);
            } catch (error) {
                clearTimeout(timer);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }
}

function toResolvedEntry(track: SpotifyTrack, originalInput: string): ResolvedEntry {
    const canonical = `spotify:track:${track.id}`;
    const entryId = stableId("entry", canonical);
    const query = buildYtSearchQuery(track);
    const scQuery = buildSoundCloudSearchQuery(track);
    const commonMetadata = {
        spotifyTrackId: track.id,
        expectedTitle: track.name,
        expectedArtists: track.artists.map((artist) => artist.name),
        expectedDurationMs: track.durationMs,
        expectedChannel: track.artists[0]?.name ? `${track.artists[0].name} - Topic` : null,
        ext: "mp3"
    };
    const candidates: ResolveCandidate[] = [
        {
            id: stableId("candidate", `${entryId}:ytdlp:download`),
            provider: "ytdlp",
            kind: "download",
            quality: "lossy",
            url: query,
            metadata: {
                source: "spotify_metadata_search",
                ...commonMetadata
            }
        }
    ];

    if (scQuery) {
        candidates.push({
            id: stableId("candidate", `${entryId}:scdl:download`),
            provider: "ytdlp",
            kind: "download",
            quality: "lossy",
            url: scQuery,
            metadata: {
                source: "spotify_metadata_search_soundcloud",
                ...commonMetadata,
                ext: "mp3",
                preferredPlatform: "soundcloud"
            }
        });
    }

    return {
        id: entryId,
        title: track.name,
        artists: track.artists.map((artist) => artist.name),
        durationMs: track.durationMs,
        artworkUrl: track.artworkUrl,
        originalInput,
        canonicalId: canonical,
        candidates
    };
}

function buildYtSearchQuery(track: SpotifyTrack): string {
    const artist = track.artists[0]?.name ?? "";
    const query = `${track.name} ${artist} audio`.trim();
    if (!query) {
        return "ytsearch5:spotify track";
    }
    return `ytsearch5:${query}`;
}

function buildSoundCloudSearchQuery(track: SpotifyTrack): string | null {
    const artist = track.artists[0]?.name ?? "";
    const query = `${track.name} ${artist}`.trim();
    if (!query) {
        return null;
    }
    return `scsearch1:${query}`;
}

function extractTracksFromAlbumPayload(payload: Record<string, unknown>, fallbackArtwork: string | null): SpotifyTrack[] {
    const tracksObj = asRecord(payload.tracks);
    if (!tracksObj || !Array.isArray(tracksObj.items)) {
        const single = extractTrack(payload, fallbackArtwork);
        return single ? [single] : [];
    }

    const tracks: SpotifyTrack[] = [];
    for (const item of tracksObj.items) {
        const itemObj = asRecord(item);
        if (!itemObj) {
            continue;
        }

        const track = extractTrack(itemObj, fallbackArtwork);
        if (track) {
            tracks.push(track);
        }
    }

    return tracks;
}

function extractTrack(raw: unknown, fallbackArtwork: string | null): SpotifyTrack | null {
    const obj = asRecord(raw);
    if (!obj) {
        return null;
    }

    const id = readStringValue(obj.id);
    const name = readStringValue(obj.name);
    if (!id || !name) {
        return null;
    }

    const durationMs = readDurationMs(obj.duration_ms);
    const artists = readArtists(obj.artists);

    const albumObj = asRecord(obj.album);
    const albumArtwork = albumObj ? extractFirstImageUrl(albumObj.images) : null;

    return {
        id,
        name,
        durationMs,
        artists,
        artworkUrl: albumArtwork ?? fallbackArtwork
    };
}

function readArtists(value: unknown): SpotifyArtist[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const artists: SpotifyArtist[] = [];
    for (const item of value) {
        const artistObj = asRecord(item);
        if (!artistObj) {
            continue;
        }
        const name = readStringValue(artistObj.name);
        if (!name) {
            continue;
        }
        artists.push({ name });
    }
    return artists;
}

function extractFirstImageUrl(value: unknown): string | null {
    if (!Array.isArray(value)) {
        return null;
    }

    for (const item of value) {
        const imageObj = asRecord(item);
        if (!imageObj) {
            continue;
        }
        const url = readStringValue(imageObj.url);
        if (url) {
            return url;
        }
    }
    return null;
}

function readDurationMs(value: unknown): number | null {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return null;
    }
    return Math.floor(numeric);
}

function readStringValue(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function extractSpotifyError(data: unknown): { status: number; message: string } | null {
    const obj = asRecord(data);
    if (!obj) {
        return null;
    }
    const errorObj = asRecord(obj.error);
    if (!errorObj) {
        return null;
    }

    const statusRaw = typeof errorObj.status === "number" ? errorObj.status : Number(errorObj.status);
    const message = readStringValue(errorObj.message) ?? "Unknown Spotify error";
    const status = Number.isFinite(statusRaw) ? statusRaw : 500;
    return { status, message };
}

function extractSpotifyApiPath(nextUrl: string): string | null {
    if (!nextUrl) {
        return null;
    }

    try {
        const url = new URL(nextUrl);
        const path = `${url.pathname}${url.search}`;
        return path || null;
    } catch {
        if (nextUrl.startsWith("/")) {
            return nextUrl;
        }
        return null;
    }
}

function requestSpotifyJsonWithToken(
    query: string,
    token: string,
    hollaback: SpotifyCallback,
    timeoutMs: number
): void {
    const request = https.request({
        host: "api.spotify.com",
        path: encodeURI(query),
        method: "GET",
        headers: {
            "Accept": "application/json",
            "Authorization": `Bearer ${token}`
        }
    }, (response) => {
        let chunks = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
            chunks += chunk;
        });
        response.on("end", () => {
            try {
                const parsed = JSON.parse(chunks);
                hollaback(null, parsed);
            } catch (error) {
                hollaback(error instanceof Error ? error : new Error("Invalid Spotify JSON response"), null);
            }
        });
    });

    request.setTimeout(timeoutMs, () => {
        request.destroy(new Error("Spotify request timed out."));
    });

    request.on("error", (error: Error) => {
        hollaback(error, null);
    });

    request.end();
}

async function buildOEmbedFallbackEntry(
    input: string,
    sourceType: SourceType,
    timeoutMs: number
): Promise<ResolvedEntry | null> {
    const canonicalUrl = toCanonicalSpotifyUrl(input);
    if (!canonicalUrl) {
        return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
        controller.abort();
    }, timeoutMs);

    try {
        const endpoint = `https://open.spotify.com/oembed?url=${encodeURIComponent(canonicalUrl)}`;
        const response = await fetch(endpoint, {
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
        const oembedTitle = readStringValue(payload.title) ?? deriveFallbackTitle(sourceType);
        const artworkUrl = readStringValue(payload.thumbnail_url);
        const pageMeta = await fetchSpotifyPageFallbackMetadata(canonicalUrl, controller.signal).catch(() => ({
            title: null,
            artists: [] as string[]
        }));
        const title = pageMeta.title ?? oembedTitle;
        const artists = pageMeta.artists;
        const canonicalId = getSpotifyCanonicalId(input);
        const entryId = stableId("entry", canonicalId ?? input);
        const queryCore = [title, artists[0]].filter((part): part is string => Boolean(part)).join(" ");
        const query = queryCore ? `ytsearch5:${queryCore} audio` : "ytsearch5:spotify track";
        const scQuery = queryCore ? `scsearch1:${queryCore}` : null;
        const commonMetadata = {
            expectedTitle: title,
            expectedArtists: artists,
            expectedDurationMs: null,
            expectedChannel: artists[0] ? `${artists[0]} - Topic` : null,
            ext: "mp3"
        };
        const candidates: ResolveCandidate[] = [
            {
                id: stableId("candidate", `${entryId}:ytdlp:download`),
                provider: "ytdlp",
                kind: "download",
                quality: "lossy",
                url: query,
                metadata: {
                    source: "spotify_oembed_fallback",
                    ...commonMetadata
                }
            }
        ];

        if (scQuery) {
            candidates.push({
                id: stableId("candidate", `${entryId}:scdl:download`),
                provider: "ytdlp",
                kind: "download",
                quality: "lossy",
                url: scQuery,
                metadata: {
                    source: "spotify_oembed_fallback_soundcloud",
                    ...commonMetadata,
                    preferredPlatform: "soundcloud"
                }
            });
        }

        return {
            id: entryId,
            title,
            artists,
            durationMs: null,
            artworkUrl,
            originalInput: input,
            canonicalId,
            candidates
        };
    } catch {
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

function toCanonicalSpotifyUrl(input: string): string | null {
    const parsed = parseSpotifyInput(input);
    if (!parsed) {
        return null;
    }
    return `https://open.spotify.com/${parsed.kind}/${parsed.id}`;
}

function getSpotifyCanonicalId(input: string): string | null {
    const parsed = parseSpotifyInput(input);
    if (!parsed) {
        return null;
    }
    return `spotify:${parsed.kind}:${parsed.id}`;
}

function deriveFallbackTitle(sourceType: SourceType): string {
    if (sourceType === "spotify_track") {
        return "Spotify Track";
    }
    if (sourceType === "spotify_album") {
        return "Spotify Album";
    }
    if (sourceType === "spotify_playlist") {
        return "Spotify Playlist";
    }
    return "Spotify Audio";
}

async function fetchSpotifyPageFallbackMetadata(
    url: string,
    signal: AbortSignal
): Promise<{ title: string | null; artists: string[] }> {
    const response = await fetch(url, {
        method: "GET",
        signal
    });
    if (!response.ok) {
        return {
            title: null,
            artists: []
        };
    }

    const html = await response.text();
    const ogTitle = readStringValue(extractMetaContent(html, "og:title"));
    const musician = readStringValue(extractMetaContent(html, "music:musician_description"));
    const description = readStringValue(extractMetaContent(html, "og:description"));
    const artists: string[] = [];
    if (musician) {
        artists.push(musician);
    } else if (description) {
        const firstPart = description.split("·")[0]?.trim();
        if (firstPart) {
            artists.push(firstPart);
        }
    }

    return {
        title: normalizeSpotifyTitle(ogTitle),
        artists
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

export type {
    SpotifyResolverMicroModuleOptions
};

export {
    SpotifyResolverMicroModule
};
