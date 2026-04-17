import process from 'node:process';
import { ensureFfmpeg } from './installffmpeg.mjs';
import { ensureYtDlp } from './installytdlp.mjs';

async function main() {
    const force = process.argv.includes('--force');

    const ffmpeg = await ensureFfmpeg({ force });
    console.log(`ffmpeg:     ${ffmpeg.ffmpegPath}`);
    console.log(`ffprobe:    ${ffmpeg.ffprobePath}`);

    const ytdlp = await ensureYtDlp({ force });
    console.log(`yt-dlp:     ${ytdlp.binaryPath}`);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exit(1);
});
