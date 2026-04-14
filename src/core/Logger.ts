import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import type { WriteStream } from "node:fs";
import { join, parse } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import util from "node:util";
import { assert } from "node:console";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
    trace: 10,
    debug: 20,
    info: 30,
    warn: 40,
    error: 50,
    fatal: 60
};

export interface LogRecord {
    timestamp: Date;
    level: LogLevel;
    prefixes: string[];
    args: unknown[];
    message: string;
}

export type LogFormatter = (record: LogRecord) => string;

export interface LoggerOptions {
    name?: string;
    level?: LogLevel;
    logDir?: string;
    fileName?: string;
    writeToConsole?: boolean;
    writeToFile?: boolean;
    rotateDaily?: boolean;
    maxSizeBytes?: number;
    maxArchives?: number;
    maxArchiveAgeDays?: number;
    utcTimestamps?: boolean;
    colorizeConsole?: boolean;
    fileFormatter?: LogFormatter;
    consoleFormatter?: LogFormatter;
}

interface NormalizedLoggerOptions {
    name?: string | undefined;
    level: LogLevel;
    logDir: string;
    fileName: string;
    writeToConsole: boolean;
    writeToFile: boolean;
    rotateDaily: boolean;
    maxSizeBytes: number;
    maxArchives: number;
    maxArchiveAgeDays: number;
    utcTimestamps: boolean;
    colorizeConsole: boolean;
    fileFormatter: LogFormatter;
    consoleFormatter: LogFormatter;
}

class LogBackend {
    private readonly options: NormalizedLoggerOptions;
    private stream: WriteStream | null = null;
    private currentBytes = 0;
    private currentDateKey = "";
    private writeChain: Promise<void> = Promise.resolve();
    private initialized = false;
    private closed = false;

    public constructor(options: LoggerOptions) {
        this.options = {
            name: options.name,
            level: options.level ?? "info",
            logDir: options.logDir ?? join(process.cwd(), "logs"),
            fileName: options.fileName ?? "latest.log",
            writeToConsole: options.writeToConsole ?? true,
            writeToFile: options.writeToFile ?? true,
            rotateDaily: options.rotateDaily ?? true,
            maxSizeBytes: options.maxSizeBytes ?? 20 * 1024 * 1024,
            maxArchives: options.maxArchives ?? 30,
            maxArchiveAgeDays: options.maxArchiveAgeDays ?? 30,
            utcTimestamps: options.utcTimestamps ?? false,
            colorizeConsole: options.colorizeConsole ?? true,
            fileFormatter: options.fileFormatter ?? ((record) => this.minecraftFormatter(record)),
            consoleFormatter: options.consoleFormatter ?? ((record) => this.minecraftFormatter(record))
        };
    }

    public get level(): LogLevel {
        return this.options.level;
    }

    public setLevel(level: LogLevel): void {
        this.options.level = level;
    }

    public async init(): Promise<void> {
        if (this.initialized) {
            return;
        }

        if (this.options.writeToFile) {
            await fs.mkdir(this.options.logDir, { recursive: true });
            await this.openStream();
            await this.cleanupArchives();
        }

        this.initialized = true;
    }

    public async shutdown(): Promise<void> {
        await this.enqueue(async () => {
            this.closed = true;
            await this.closeStream();
        });
    }

    public log(level: LogLevel, prefixes: string[], args: unknown[]): void {
        if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.options.level]) {
            return;
        }

        const now = new Date();
        const message = this.formatArgs(args);

        const record: LogRecord = {
            timestamp: now,
            level,
            prefixes,
            args,
            message
        };

        const fileLine = this.options.fileFormatter(record);
        const consoleLine = this.options.consoleFormatter(record);

        if (this.options.writeToConsole) {
            this.writeConsole(level, consoleLine);
        }

        if (this.options.writeToFile) {
            void this.enqueue(async () => {
                if (this.closed) {
                    return;
                }

                await this.ensureRotation(fileLine, now);
                await this.writeLine(fileLine + "\n");
            });
        }
    }

    private async enqueue(task: () => Promise<void>): Promise<void> {
        this.writeChain = this.writeChain.then(task, task);
        await this.writeChain;
    }

    private minecraftFormatter(record: LogRecord): string {
        const time = this.formatMinecraftTime(record.timestamp);
        const levelLabel = record.level.toUpperCase();
        const prefixPart = record.prefixes.length > 0
            ? record.prefixes.map((prefix) => `[${prefix}]`).join(" ") + " "
            : "";

        return `[${time}] [${levelLabel}]: ${prefixPart}${record.message}`;
    }

    private writeConsole(level: LogLevel, line: string): void {
        if (!this.options.colorizeConsole) {
            this.pickConsoleMethod(level)(line);
            return;
        }

        const color = this.getAnsiColor(level);
        const reset = "\u001b[0m";
        this.pickConsoleMethod(level)(`${color}${line}${reset}`);
    }

    private pickConsoleMethod(level: LogLevel): (...data: unknown[]) => void {
        if (level === "warn") {
            return console.warn;
        }

        if (level === "error" || level === "fatal") {
            return console.error;
        }

        return console.log;
    }

    private getAnsiColor(level: LogLevel): string {
        switch (level) {
            case "trace":
                return "\u001b[90m";
            case "debug":
                return "\u001b[36m";
            case "info":
                return "\u001b[32m";
            case "warn":
                return "\u001b[33m";
            case "error":
                return "\u001b[31m";
            case "fatal":
                return "\u001b[35m";
        }
    }

    private formatArgs(args: unknown[]): string {
        if (args.length === 0) {
            return "";
        }

        return util.formatWithOptions(
            {
                colors: false,
                depth: 8,
                breakLength: 120,
                compact: false
            },
            ...args
        );
    }

    private formatMinecraftTime(date: Date): string {
        const hours = this.options.utcTimestamps ? date.getUTCHours() : date.getHours();
        const minutes = this.options.utcTimestamps ? date.getUTCMinutes() : date.getMinutes();
        const seconds = this.options.utcTimestamps ? date.getUTCSeconds() : date.getSeconds();

        return `${this.pad2(hours)}:${this.pad2(minutes)}:${this.pad2(seconds)}`;
    }

    private getDateKey(date: Date): string {
        const year = this.options.utcTimestamps ? date.getUTCFullYear() : date.getFullYear();
        const month = (this.options.utcTimestamps ? date.getUTCMonth() : date.getMonth()) + 1;
        const day = this.options.utcTimestamps ? date.getUTCDate() : date.getDate();

        return `${year}-${this.pad2(month)}-${this.pad2(day)}`;
    }

    private getArchiveTimestamp(date: Date): string {
        const year = this.options.utcTimestamps ? date.getUTCFullYear() : date.getFullYear();
        const month = (this.options.utcTimestamps ? date.getUTCMonth() : date.getMonth()) + 1;
        const day = this.options.utcTimestamps ? date.getUTCDate() : date.getDate();
        const hours = this.options.utcTimestamps ? date.getUTCHours() : date.getHours();
        const minutes = this.options.utcTimestamps ? date.getUTCMinutes() : date.getMinutes();
        const seconds = this.options.utcTimestamps ? date.getUTCSeconds() : date.getSeconds();

        return `${year}-${this.pad2(month)}-${this.pad2(day)}_${this.pad2(hours)}-${this.pad2(minutes)}-${this.pad2(seconds)}`;
    }

    private pad2(value: number): string {
        return String(value).padStart(2, "0");
    }

    private getCurrentLogPath(): string {
        return join(this.options.logDir, this.options.fileName);
    }

    private getArchiveBaseName(): string {
        const parsed = parse(this.options.fileName);
        return parsed.name || "latest";
    }

    private async openStream(): Promise<void> {
        const logPath = this.getCurrentLogPath();

        this.stream = createWriteStream(logPath, {
            flags: "a",
            encoding: "utf8"
        });

        try {
            const stat = await fs.stat(logPath);
            this.currentBytes = stat.size;
        } catch {
            this.currentBytes = 0;
        }

        this.currentDateKey = this.getDateKey(new Date());
    }

    private async closeStream(): Promise<void> {
        if (!this.stream) {
            return;
        }

        const stream = this.stream;
        this.stream = null;

        await new Promise<void>((resolve, reject) => {
            stream.end((error: Error | null) => {
                if (error) {
                    reject(error);
                    return;
                }

                resolve();
            });
        });
    }

    private async writeLine(line: string): Promise<void> {
        if (!this.stream) {
            await this.openStream();
        }

        await new Promise<void>((resolve, reject) => {
            this.stream!.write(line, "utf8", (error) => {
                if (error) {
                    reject(error);
                    return;
                }

                resolve();
            });
        });

        this.currentBytes += Buffer.byteLength(line, "utf8");
    }

    private async ensureRotation(nextLine: string, now: Date): Promise<void> {
        if (!this.stream) {
            await this.openStream();
            return;
        }

        const nextSize = Buffer.byteLength(nextLine + "\n", "utf8");
        const nextDateKey = this.getDateKey(now);

        const shouldRotateByDate =
            this.options.rotateDaily &&
            this.currentDateKey !== "" &&
            this.currentDateKey !== nextDateKey;

        const shouldRotateBySize =
            this.options.maxSizeBytes > 0 &&
            this.currentBytes + nextSize > this.options.maxSizeBytes;

        if (!shouldRotateByDate && !shouldRotateBySize) {
            return;
        }

        const reason = shouldRotateByDate ? "date" : "size";
        await this.rotate(reason, now);
    }

    private async rotate(reason: "date" | "size", now: Date): Promise<void> {
        const currentLogPath = this.getCurrentLogPath();
        const archiveBaseName = this.getArchiveBaseName();
        const archiveStamp = this.getArchiveTimestamp(now);
        const archivePlainName = `${archiveBaseName}-${archiveStamp}-${reason}.log`;
        const archivePlainPath = join(this.options.logDir, archivePlainName);
        const archiveGzipPath = `${archivePlainPath}.gz`;

        await this.closeStream();

        let currentExists = false;
        let currentSize = 0;

        try {
            const stat = await fs.stat(currentLogPath);
            currentExists = true;
            currentSize = stat.size;
        } catch {
            currentExists = false;
        }

        if (currentExists && currentSize > 0) {
            await fs.rename(currentLogPath, archivePlainPath);
            await this.gzipFile(archivePlainPath, archiveGzipPath);
            await fs.unlink(archivePlainPath).catch(() => undefined);
        }

        this.currentBytes = 0;
        this.currentDateKey = this.getDateKey(now);
        await this.openStream();
        await this.cleanupArchives();
    }

    private async gzipFile(sourcePath: string, destinationPath: string): Promise<void> {
        await pipeline(
            createReadStream(sourcePath),
            createGzip({ level: 9 }),
            createWriteStream(destinationPath)
        );
    }

    private async cleanupArchives(): Promise<void> {
        const entries = await fs.readdir(this.options.logDir, { withFileTypes: true });
        const archiveBaseName = this.getArchiveBaseName();
        const archiveFiles: Array<{
            fullPath: string;
            mtimeMs: number;
        }> = [];

        for (const entry of entries) {
            if (!entry.isFile()) {
                continue;
            }

            if (!entry.name.startsWith(`${archiveBaseName}-`) || !entry.name.endsWith(".log.gz")) {
                continue;
            }

            const fullPath = join(this.options.logDir, entry.name);

            try {
                const stat = await fs.stat(fullPath);
                archiveFiles.push({
                    fullPath,
                    mtimeMs: stat.mtimeMs
                });
            } catch {
                continue;
            }
        }

        archiveFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);

        const now = Date.now();
        const maxAgeMs = this.options.maxArchiveAgeDays * 24 * 60 * 60 * 1000;

        for (let i = 0; i < archiveFiles.length; i++) {
            const archive = archiveFiles[i] as { fullPath: string; mtimeMs: number };
            const tooMany = i >= this.options.maxArchives;
            const tooOld = maxAgeMs > 0 && now - archive.mtimeMs > maxAgeMs;

            if (!tooMany && !tooOld) {
                continue;
            }

            await fs.unlink(archive.fullPath).catch(() => undefined);
        }
    }
}

export class Logger {
    private readonly backend: LogBackend;
    private readonly prefixes: string[];

    private constructor(backend: LogBackend, prefixes: string[]) {
        this.backend = backend;
        this.prefixes = prefixes;
    }

    public static async create(options: LoggerOptions = {}): Promise<Logger> {
        const backend = new LogBackend(options);
        await backend.init();

        const rootPrefixes = options.name ? [options.name] : [];
        return new Logger(backend, rootPrefixes);
    }

    public child(prefix: string): Logger {
        return new Logger(this.backend, [...this.prefixes, prefix]);
    }

    public setLevel(level: LogLevel): void {
        this.backend.setLevel(level);
    }

    public trace(...args: unknown[]): void {
        this.backend.log("trace", this.prefixes, args);
    }

    public debug(...args: unknown[]): void {
        this.backend.log("debug", this.prefixes, args);
    }

    public info(...args: unknown[]): void {
        this.backend.log("info", this.prefixes, args);
    }

    public warn(...args: unknown[]): void {
        this.backend.log("warn", this.prefixes, args);
    }

    public error(...args: unknown[]): void {
        this.backend.log("error", this.prefixes, args);
    }

    public fatal(...args: unknown[]): void {
        this.backend.log("fatal", this.prefixes, args);
    }

    public async shutdown(): Promise<void> {
        await this.backend.shutdown();
    }
}