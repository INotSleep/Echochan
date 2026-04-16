import process from 'node:process';
import { ensureFfmpeg } from './installffmpeg.mjs';
import { ensureYtDlp } from './installytdlp.mjs';
import { ensureSpotiFlac } from './installspotiflac.mjs';

async function main() {
    const force = process.argv.includes('--force');

    const ffmpeg = await ensureFfmpeg({ force });
    console.log(`ffmpeg:     ${ffmpeg.ffmpegPath}`);
    console.log(`ffprobe:    ${ffmpeg.ffprobePath}`);

    const ytdlp = await ensureYtDlp({ force });
    console.log(`yt-dlp:     ${ytdlp.binaryPath}`);

    const spotiflac = await ensureSpotiFlac({ force });
    console.log(`spotiflac:  ${spotiflac.binaryPath}`);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exit(1);
});
