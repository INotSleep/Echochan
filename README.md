# Echochan

Discord music-бот с очередью `per-guild`, поддержкой YouTube/Spotify, автокомплитом поиска и управлением через slash-команды и кнопки.

## Возможности

- Воспроизведение по ссылке (YouTube, прямые URL, Spotify track/album/playlist).
- Поиск по тексту через `/play` с автокомплитом и выбором найденного трека.
- Отдельная очередь и отдельный плеер для каждого сервера (`per-guild`).
- Управление очередью: пауза, продолжение, skip, shuffle, loop, move, remove, stop.
- Автоустановка `ffmpeg` и `yt-dlp` при `npm install`.

## Требования

- Node.js 20+ (рекомендуется актуальная LTS).
- npm 10+.
- Discord-бот с включенными intents для гильдий/голоса.

## Установка

```bash
npm install
```

`postinstall` автоматически запускает установку бинарей:

- `ffmpeg` в `.ffmpeg`
- `yt-dlp` в `.yt-dlp`

## Настройка `.env`

Создай `.env` в корне проекта:

```env
BOT_TOKEN=your_bot_token
BOT_CLIENT_ID=your_application_id
DEV_GUILD=your_dev_guild_id

LOG_LEVEL=info
PROVIDER_TIMEOUT_MS=15000
DOWNLOAD_TIMEOUT_MS=120000

FFMPEG_INSTALL_DIR=.ffmpeg
YTDLP_INSTALL_DIR=.yt-dlp
YTDLP_BIN=

SPOTIFY_ACCESS_TOKEN=
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=

POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=echochan
```

Примечания:

- Для Spotify желательно заполнить `SPOTIFY_CLIENT_ID` и `SPOTIFY_CLIENT_SECRET`.

## Запуск

```bash
npm run dev:start
```

Это соберет TypeScript и запустит `dist/index.js`.

## Деплой slash-команд

### Быстро в dev guild

```bash
npm run dev:deploy
```

### Глобально

```bash
npm run deploy
```

Примечания:

- `dev:deploy` обновляется почти сразу.
- `deploy` (global) может применяться дольше.

## Команды

Актуальный набор команд:

- `/ping` - проверка, что бот онлайн.
- `/join` - подключить бота к вашему голосовому каналу.
- `/play input:<ссылка_или_текст>` - добавить трек в очередь (с автокомплитом по тексту).
- `/nowplaying` - показать текущий трек и прогресс.
- `/queue [limit]` - показать очередь.
- `/move from to` - переместить трек в очереди.
- `/remove position` - удалить трек по позиции.
- `/skip` - пропустить текущий трек.
- `/pause` - поставить на паузу.
- `/resume` - продолжить воспроизведение.
- `/shuffle` - перемешать очередь.
- `/loop mode` - режим повтора (`off`, `track`, `queue`).
- `/stop` - остановить воспроизведение (очередь остается).
- `/leave` - отключиться от голосового канала.

Также есть кнопки управления под embed очереди: пауза/пропуск/цикл/шафл/обновить/стоп.

## Примеры `/play`

- `/play input:https://www.youtube.com/watch?v=dQw4w9WgXcQ`
- `/play input:https://open.spotify.com/track/...`
- `/play input:Daft Punk - Get Lucky`

## Полезные npm-скрипты

- `npm run build` - сборка TypeScript.
- `npm run dev:start` - сборка и запуск бота.
- `npm run dev:deploy` - деплой команд в `DEV_GUILD`.
- `npm run deploy` - глобальный деплой команд.
- `npm run installbinaries` - ручная установка `ffmpeg` + `yt-dlp`.

## Замечания по архитектуре

- Очередь и воспроизведение организованы по `guildId`.
- Кэш аудио-файлов хранится локально в `.cache/media`.
- Локальное воспроизведение файлов через команду отключено.
