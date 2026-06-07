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
        const asset = this.assets.get(cacheKey) ?? this.discoverReadyAsset(cacheKey);
        if (!asset || asset.state !== "ready") {
            return null;
        }
        if (this.isReadyAssetExpired(asset)) {
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
        void safeTouchFile(asset.filePath, new Date());
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

    public async cleanup(): Promise<void> {
        await fs.promises.mkdir(this.cacheDir, { recursive: true });

        const nowMs = Date.now();
        const evictedAssets: CacheAsset[] = [];

        for (const [cacheKey, asset] of this.assets.entries()) {
            if (asset.refCount > 0) {
                continue;
            }

            const shouldDelete =
                asset.state === "broken"
                || (asset.state === "temp" && this.isTempAssetExpired(asset, nowMs))
                || (asset.state === "ready" && this.isReadyAssetExpired(asset, nowMs));

            if (!shouldDelete) {
                continue;
            }

            await safeUnlink(asset.filePath);
            this.assets.delete(cacheKey);
            evictedAssets.push(this.cloneAsset(asset));
        }

        const trackedPaths = new Set(
            [...this.assets.values()].map((asset) => path.resolve(asset.filePath).toLowerCase())
        );
        const diskSweepDeleted = await this.cleanupOrphanedDiskFiles(nowMs, trackedPaths);

        for (const asset of evictedAssets) {
            void this.events.emit("cache_asset_evicted", {
                cacheKey: asset.cacheKey,
                asset
            });
        }

        if (evictedAssets.length > 0 || diskSweepDeleted > 0) {
            this.logger.info(
                `Cache cleanup finished. evicted=${evictedAssets.length} orphaned_deleted=${diskSweepDeleted}`
            );
        }
    }

    private cloneAsset(asset: CacheAsset): CacheAsset {
        return {
            ...asset
        };
    }

    private discoverReadyAsset(cacheKey: string): CacheAsset | null {
        const prefix = `${cacheKey}.`;
        let fileNames: string[] = [];
        try {
            fileNames = fs.readdirSync(this.cacheDir);
        } catch {
            return null;
        }

        const match = fileNames.find((fileName) => fileName.startsWith(prefix) && !fileName.includes(".tmp."));
        if (!match) {
            return null;
        }

        const filePath = path.join(this.cacheDir, match);
        const stat = safeStatSync(filePath);
        if (!stat?.isFile()) {
            return null;
        }

        const nowMs = Date.now();
        if (nowMs - stat.mtimeMs > this.readyTtlMs) {
            return null;
        }

        const timestampIso = new Date(stat.mtimeMs).toISOString();
        const asset: CacheAsset = {
            cacheKey,
            filePath,
            format: path.extname(filePath).replace(".", "") || "bin",
            sizeBytes: stat.size,
            state: "ready",
            producer: "ytdlp",
            lastAccessAt: timestampIso,
            refCount: 0,
            expiresAt: new Date(stat.mtimeMs + this.readyTtlMs).toISOString(),
            createdAt: timestampIso,
            updatedAt: timestampIso
        };
        this.assets.set(cacheKey, asset);
        return asset;
    }

    private isReadyAssetExpired(asset: CacheAsset, nowMs: number = Date.now()): boolean {
        const expiresAtMs = Date.parse(asset.expiresAt ?? "");
        if (Number.isFinite(expiresAtMs)) {
            return expiresAtMs <= nowMs;
        }

        const fileStat = safeStatSync(asset.filePath);
        if (fileStat?.isFile()) {
            return nowMs - fileStat.mtimeMs > this.readyTtlMs;
        }

        return true;
    }

    private isTempAssetExpired(asset: CacheAsset, nowMs: number): boolean {
        const fileStat = safeStatSync(asset.filePath);
        if (fileStat?.isFile()) {
            return nowMs - fileStat.mtimeMs > this.tempTtlMs;
        }

        return nowMs - Date.parse(asset.updatedAt) > this.tempTtlMs;
    }

    private async cleanupOrphanedDiskFiles(nowMs: number, trackedPaths: Set<string>): Promise<number> {
        const entries = await fs.promises.readdir(this.cacheDir, { withFileTypes: true }).catch(() => []);
        let deleted = 0;

        for (const entry of entries) {
            if (!entry.isFile()) {
                continue;
            }

            const filePath = path.join(this.cacheDir, entry.name);
            if (trackedPaths.has(path.resolve(filePath).toLowerCase())) {
                continue;
            }

            const stat = await fs.promises.stat(filePath).catch(() => null);
            if (!stat?.isFile()) {
                continue;
            }

            const ttlMs = entry.name.includes(".tmp.") ? this.tempTtlMs : this.readyTtlMs;
            if (nowMs - stat.mtimeMs <= ttlMs) {
                continue;
            }

            await safeUnlink(filePath);
            deleted += 1;
        }

        return deleted;
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

function safeStatSync(filePath: string): fs.Stats | null {
    try {
        return fs.statSync(filePath);
    } catch {
        return null;
    }
}

async function safeUnlink(filePath: string): Promise<void> {
    if (!filePath) {
        return;
    }
    await fs.promises.unlink(filePath).catch(() => undefined);
}

async function safeTouchFile(filePath: string, date: Date): Promise<void> {
    if (!filePath) {
        return;
    }
    await fs.promises.utimes(filePath, date, date).catch(() => undefined);
}

export type {
    CacheProducer,
    CacheManagerOptions
};

export {
    CacheManager
};
