import path from 'node:path';
import process from 'node:process';

const ffmpegDir = path.resolve(process.cwd(), '.ffmpeg');
process.env.PATH = `${ffmpegDir}${path.delimiter}${process.env.PATH ?? ''}`;

import dotenv from 'dotenv';
import { generateDependencyReport } from '@discordjs/voice';
import { Logger } from './core/Logger.js';
import { BotClient } from './core/BotClient.js';
import { Storage } from './core/Storage.js';

dotenv.config();
console.log(generateDependencyReport());

const logger = Logger.create({
    name: "Echochan",
    level: "info",
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
    }).catch((err) => {
        logger.error("Failed to initialize storage:", err);
    })

    const client = new BotClient(logger, storage);
    client.login();
})