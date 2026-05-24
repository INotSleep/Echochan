import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { EventBus } from "../core/EventBus.js";
import type { Events as EchochanEvents } from "../core/Events.js";
import type { Logger } from "../core/Logger.js";
import type { CacheAsset } from "./types.js";

type CacheProducer = "spotify" | "ytdlp";

type CacheManagerOptions = {
    cacheDir?: string;
    readyTtlMs?: number;
    tempTtlMs?: number;
};

class CacheManager {
    private readonly logger: Logger;
    private readonly events: EventBus<EchochanEvents>;
    private readonly cacheDir: string;
    private readonly readyTtlMs: number;
    private readonly tempTtlMs: number;
    private readonly assets = new Map<string, CacheAsset>();

    constructor(
        events: EventBus<EchochanEvents>,
        logger: Logger,
        options: CacheManagerOptions = {}
    ) {
        this.events = events;
        this.logger = logger.child("Cache");
        this.cacheDir = path.resolve(process.cwd(), options.cacheDir ?? ".cache", "media");
        this.readyTtlMs = options.readyTtlMs ?? 7 * 24 * 60 * 60 * 1000;
        this.tempTtlMs = options.tempTtlMs ?? 2 * 60 * 60 * 1000;
    }

    public getCacheDir(): string {
        return this.cacheDir;
    }

    public buildCacheKey(params: {
        canonicalId: string | null;
        provider: CacheProducer;
        kind: "stream" | "download";
        quality: "lossless" | "lossy" | "unknown";
        url: string | null;
        formatHint?: string | null;
    }): string {
        const identity = params.canonicalId ?? params.url ?? "unknown";
        const normalized = [
            identity.trim().toLowerCase(),
            params.provider,
            params.kind,
            params.quality,
            (params.formatHint ?? "unknown").trim().toLowerCase()
        ].join("|");
        const digest = createHash("sha1").update(normalized).digest("hex");
        return digest;
    }

    public getAsset(cacheKey: string): CacheAsset | null {
        const asset = this.assets.get(cacheKey);
        return asset ? this.cloneAsset(asset) : null;
    }

    public getReadyAsset(cacheKey: string): CacheAsset | null {
        const asset = this.assets.get(cacheKey);
        if (!asset || asset.state !== "ready") {
            return null;
        }
        this.touch(cacheKey);
        return this.cloneAsset(asset);
    }

    public touch(cacheKey: string): void {
        const asset = this.assets.get(cacheKey);
        if (!asset) {
            return;
        }
        const nowIso = new Date().toISOString();
        asset.lastAccessAt = nowIso;
        asset.updatedAt = nowIso;
    }

    public retain(cacheKey: string): void {
        const asset = this.assets.get(cacheKey);
        if (!asset) {
            return;
        }
        asset.refCount += 1;
        asset.lastAccessAt = new Date().toISOString();
        asset.updatedAt = asset.lastAccessAt;
    }

    public release(cacheKey: string): void {
        const asset = this.assets.get(cacheKey);
        if (!asset) {
            return;
        }
        asset.refCount = Math.max(0, asset.refCount - 1);
        asset.lastAccessAt = new Date().toISOString();
        asset.updatedAt = asset.lastAccessAt;
    }

    public async reserveTempAsset(params: {
        cacheKey: string;
        extension: string;
        producer: CacheProducer;
    }): Promise<{ tempPath: string; finalPath: string; asset: CacheAsset }> {
        await fs.promises.mkdir(this.cacheDir, { recursive: true });

        const ext = sanitizeExtension(params.extension);
        const finalPath = path.join(this.cacheDir, `${params.cacheKey}${ext}`);
        const tempPath = path.join(this.cacheDir, `${params.cacheKey}.tmp${ext}`);
        const nowIso = new Date().toISOString();
        const expiresAt = new Date(Date.now() + this.tempTtlMs).toISOString();

        const existing = this.assets.get(params.cacheKey);
        if (existing) {
            existing.filePath = tempPath;
            existing.state = "temp";
            existing.producer = params.producer;
            existing.expiresAt = expiresAt;
            existing.lastAccessAt = nowIso;
            existing.updatedAt = nowIso;
            existing.format = ext.replace(".", "") || "bin";
            existing.sizeBytes = 0;
            return { tempPath, finalPath, asset: this.cloneAsset(existing) };
        }

        const created: CacheAsset = {
            cacheKey: params.cacheKey,
            filePath: tempPath,
            format: ext.replace(".", "") || "bin",
            sizeBytes: 0,
            state: "temp",
            producer: params.producer,
            lastAccessAt: nowIso,
            refCount: 0,
            expiresAt,
            createdAt: nowIso,
            updatedAt: nowIso
        };
        this.assets.set(params.cacheKey, created);
        return { tempPath, finalPath, asset: this.cloneAsset(created) };
    }

    public async markReady(params: {
        cacheKey: string;
        finalPath: string;
    }): Promise<CacheAsset | null> {
        const asset = this.assets.get(params.cacheKey);
        if (!asset) {
            return null;
        }

        const stat = await fs.promises.stat(params.finalPath).catch(() => null);
        if (!stat || !stat.isFile()) {
            asset.state = "broken";
            asset.expiresAt = new Date(Date.now() + this.tempTtlMs).toISOString();
            asset.updatedAt = new Date().toISOString();
            return this.cloneAsset(asset);
        }

        const nowIso = new Date().toISOString();
        asset.state = "ready";
        asset.filePath = params.finalPath;
        asset.sizeBytes = stat.size;
        asset.lastAccessAt = nowIso;
        asset.updatedAt = nowIso;
        asset.expiresAt = new Date(Date.now() + this.readyTtlMs).toISOString();

        void this.events.emit("cache_asset_ready", {
            cacheKey: params.cacheKey,
            asset: this.cloneAsset(asset)
        });

        return this.cloneAsset(asset);
    }

    public markBroken(cacheKey: string): CacheAsset | null {
        const asset = this.assets.get(cacheKey);
        if (!asset) {
            return null;
        }
        asset.state = "broken";
        asset.expiresAt = new Date(Date.now() + this.tempTtlMs).toISOString();
        asset.updatedAt = new Date().toISOString();
        return this.cloneAsset(asset);
    }

    public listAssets(): CacheAsset[] {
        return [...this.assets.values()].map((asset) => this.cloneAsset(asset));
    }

    private cloneAsset(asset: CacheAsset): CacheAsset {
        return {
            ...asset
        };
    }
}

function sanitizeExtension(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
        return ".bin";
    }
    if (trimmed.startsWith(".")) {
        return trimmed.toLowerCase();
    }
    return `.${trimmed.toLowerCase()}`;
}

export type {
    CacheProducer,
    CacheManagerOptions
};

export {
    CacheManager
};
