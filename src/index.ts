import path from 'node:path';
import process from 'node:process';

const runtimeBinaryDirs = [
    path.resolve(process.cwd(), process.env.FFMPEG_INSTALL_DIR || '.ffmpeg'),
    path.resolve(process.cwd(), process.env.YTDLP_INSTALL_DIR || '.yt-dlp'),
    path.resolve(process.cwd(), process.env.SPOTIFLAC_INSTALL_DIR || '.spotiflac')
];
process.env.PATH = `${runtimeBinaryDirs.join(path.delimiter)}${path.delimiter}${process.env.PATH ?? ''}`;

import dotenv from 'dotenv';
import { generateDependencyReport } from '@discordjs/voice';
import { Logger } from './core/Logger.js';
import { BotClient } from './core/BotClient.js';
import { Storage } from './core/Storage.js';
import { EventBus } from './core/EventBus.js';
import { ServiceRegistry } from './core/ServiceRegistry.js';
import type { Events } from './core/Events.js';

dotenv.config();
console.log(generateDependencyReport());

const logger = Logger.create({
    name: "Echochan",
    level: (process.env.LOG_LEVEL as "trace" | "debug" | "info" | "warn" | "error" | "fatal" | undefined) ?? "info",
    logDir: path.resolve(process.cwd(), 'logs'),
    writeToConsole: true,
    writeToFile: true,
    rotateDaily: true,
    maxArchives: 7,
    colorizeConsole: true
})

const storage = new Storage();

logger.then((logger: Logger) => {
    logger.info("Logger initialized");

    storage.init().then(() => {
        logger.info("Storage initialized");

        const events = new EventBus<Events>();
        const services = new ServiceRegistry();

        const client = new BotClient(logger, storage, events, services);
        client.login();
    }).catch((err) => {
        logger.error("Failed to initialize storage:", err);
    })


})
