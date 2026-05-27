const { app, BrowserWindow, ipcMain, protocol, shell, Menu } = require('electron');
Menu.setApplicationMenu(null); // Remove native menu bar
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

function readElectronRuntimeConfig() {
  const configPath = path.join(__dirname, 'data', 'electron_runtime.json');
  try {
    if (!fs.existsSync(configPath)) return {};
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (error) {
    console.error('[Config] Failed to read data/electron_runtime.json:', error.message);
    return {};
  }
}

const ELECTRON_RUNTIME_CONFIG = readElectronRuntimeConfig();

function getConfigValue(keys, fallback) {
  let cursor = ELECTRON_RUNTIME_CONFIG;
  for (const key of keys) {
    if (!cursor || typeof cursor !== 'object' || !(key in cursor)) return fallback;
    cursor = cursor[key];
  }
  return cursor === undefined || cursor === null ? fallback : cursor;
}

function getConfigObject(keys, fallback = {}) {
  const value = getConfigValue(keys, fallback);
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function getConfigArray(keys, fallback = []) {
  const value = getConfigValue(keys, fallback);
  return Array.isArray(value) ? value : fallback;
}

function getConfigNumber(keys, fallback) {
  const value = Number(getConfigValue(keys, fallback));
  return Number.isFinite(value) ? value : fallback;
}

function getConfigString(keys, fallback) {
  const value = getConfigValue(keys, fallback);
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function getConfigBoolean(keys, fallback) {
  const value = getConfigValue(keys, fallback);
  return typeof value === 'boolean' ? value : fallback;
}

function buildRegExpFromConfig(keys, fallbackPattern) {
  const pattern = getConfigString(keys, fallbackPattern);
  try {
    return new RegExp(pattern);
  } catch (error) {
    console.error(`[Config] Invalid regexp "${pattern}":`, error.message);
    return new RegExp(fallbackPattern);
  }
}

const USER_DATA = app.getPath('userData');
const SAVES_DIR = path.join(USER_DATA, getConfigString(['paths', 'saves_dir'], 'saves'));
const MODS_DIR = path.join(USER_DATA, getConfigString(['paths', 'mods_dir'], 'mods'));
const SETTINGS_FILE = path.join(USER_DATA, getConfigString(['paths', 'settings_file'], 'settings.json'));

const RUNTIME_LOG_FILE = path.join(USER_DATA, 'runtime.log');
if (!fs.existsSync(SAVES_DIR)) fs.mkdirSync(SAVES_DIR, { recursive: true });
if (!fs.existsSync(MODS_DIR)) fs.mkdirSync(MODS_DIR, { recursive: true });
const WORLDS_DIR = path.join(SAVES_DIR, getConfigString(['paths', 'worlds_dir'], 'worlds'));
if (!fs.existsSync(WORLDS_DIR)) fs.mkdirSync(WORLDS_DIR, { recursive: true });

const SERVER_HOST = getConfigString(['server', 'host'], '127.0.0.1');
const PORT = getConfigNumber(['server', 'port'], 30007);
const HTTP_SESSION_TOKEN_BYTES = getConfigNumber(['server', 'session_token_bytes'], 32);
const HTTP_SESSION_TOKEN_ENCODING = getConfigString(['server', 'session_token_encoding'], 'hex');
const LOCALHOST_IPS = new Set(getConfigArray(['server', 'localhost_ips'], ['127.0.0.1', '::1', '::ffff:127.0.0.1']));
const LOCAL_RATE_LIMIT_WINDOW_MS = getConfigNumber(['server', 'local_rate_limit', 'window_ms'], 10000);
const LOCAL_RATE_LIMIT_MAX_REQUESTS = getConfigNumber(['server', 'local_rate_limit', 'max_requests'], 500);
const REMOTE_RATE_LIMIT_WINDOW_MS = getConfigNumber(['server', 'remote_rate_limit', 'window_ms'], 60000);
const REMOTE_RATE_LIMIT_MAX_REQUESTS = getConfigNumber(['server', 'remote_rate_limit', 'max_requests'], 60);
const RATE_LIMIT_ENTRY_TTL_MS = getConfigNumber(['server', 'rate_limit_entry_ttl_ms'], 120000);
const RATE_LIMIT_CLEANUP_INTERVAL_MS = getConfigNumber(['server', 'rate_limit_cleanup_interval_ms'], 300000);
const SAFE_JSON_FILENAME_PATTERN = buildRegExpFromConfig(['server', 'safe_json_filename_pattern'], '^[a-zA-Z0-9_-]+\\.json$');
const SENSITIVE_FILES = new Set(getConfigArray(['server', 'sensitive_files'], ['settings.json', '.env', '.gitignore', 'conversation-', 'project_scan.txt']));
const SENSITIVE_FILE_SUBSTRINGS = getConfigArray(['server', 'sensitive_path_substrings'], ['conversation-']);
const MAX_STATIC_FILE_SIZE_BYTES = getConfigNumber(['server', 'max_static_file_size_bytes'], 50 * 1024 * 1024);
const MAX_APPEND_SAVE_LINE_BYTES = getConfigNumber(['server', 'max_append_save_line_bytes'], 10485760);
const MAX_READ_SAVE_CHUNK_BYTES = getConfigNumber(['server', 'max_read_save_chunk_bytes'], 1048576);
const WORLD_PREVIEW_BYTES = getConfigNumber(['server', 'world_preview_bytes'], 512);
const SAVE_PREVIEW_BYTES = getConfigNumber(['server', 'save_preview_bytes'], 1024);
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.jpeg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  ...getConfigObject(['server', 'mime_types'], {})
};
const CSP_EXTERNAL_SOURCES = getConfigObject(['server', 'csp_external_sources'], {});

const WINDOW_WIDTH = getConfigNumber(['window', 'width'], 1280);
const WINDOW_HEIGHT = getConfigNumber(['window', 'height'], 800);
const WINDOW_NODE_INTEGRATION = getConfigBoolean(['window', 'node_integration'], false);
const WINDOW_CONTEXT_ISOLATION = getConfigBoolean(['window', 'context_isolation'], true);
const WINDOW_DISABLE_WEB_SECURITY_IN_DEVELOPMENT = getConfigBoolean(['window', 'disable_web_security_in_development'], false); // SECURITY: default false
const WINDOW_PRELOAD_FILE = getConfigString(['window', 'preload_file'], 'preload.js');
const EXTERNAL_LINK_PROTOCOLS = getConfigArray(['window', 'external_link_protocols'], ['http://', 'https://']);

const ENGINE_START_TIMEOUT_MS = getConfigNumber(['engine', 'timeouts_ms', 'startup'], 10000);
const DEFAULT_ENGINE_TIMEOUT_MS = getConfigNumber(['engine', 'timeouts_ms', 'default'], 30000);
const ENGINE_TIMEOUT_RECOVERY_MS = getConfigNumber(['engine', 'timeouts_ms', 'timeout_recovery'], 5000);
const PRESIMULATE_MIN_TIMEOUT_MS = getConfigNumber(['engine', 'timeouts_ms', 'pre_simulate_min'], 600000);
const PRESIMULATE_TIMEOUT_MS_PER_TICK = getConfigNumber(['engine', 'timeouts_ms', 'pre_simulate_per_tick'], 10);
const SYNC_TEMP_FILE_NAME = getConfigString(['engine', 'sync_temp_file_name'], '__nexus_sync_temp__.json');
const REALTIME_DEFAULT_INTERVAL_MS = getConfigNumber(['engine', 'realtime_default_interval_ms'], 500);
const ALLOWED_RAW_COMMANDS = new Set(getConfigArray(['engine', 'allowed_raw_commands'], ['getWorldMap', 'getGraphContext', 'getFullState']));
const GEMINI_GENERATION_CONFIG = {
  maxOutputTokens: 8192,
  temperature: 0.8,
  topP: 0.95,
  ...getConfigObject(['gemini', 'generation_config'], {})
};
const GEMINI_DEFAULT_SAFETY_THRESHOLD = getConfigString(['gemini', 'default_safety_threshold'], 'BLOCK_MEDIUM_AND_ABOVE');

function getServerOrigin() {
  return `http://${SERVER_HOST}:${PORT}`;
}

function getEngineCommandTimeout(command, fallback) {
  return getConfigNumber(['engine', 'command_timeouts_ms', command], fallback);
}

function getCspSources(key, fallback) {
  const value = CSP_EXTERNAL_SOURCES[key];
  return Array.isArray(value) ? value.join(' ') : fallback;
}

function buildContentSecurityPolicy() {
  const origin = getServerOrigin();
  const scriptSources = getCspSources('script_src', 'https://cdnjs.cloudflare.com https://cdn.jsdelivr.net');
  const styleSources = getCspSources('style_src', 'https://fonts.googleapis.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net');
  const fontSources = getCspSources('font_src', 'https://fonts.gstatic.com https://cdnjs.cloudflare.com');
  const connectSources = getCspSources('connect_src', 'https://cdnjs.cloudflare.com https://cdn.jsdelivr.net');
  return [
    `default-src 'self' ${origin}`,
    `script-src 'self' 'unsafe-eval' ${origin} ${scriptSources}`,
    `style-src 'self' 'unsafe-inline' ${origin} ${styleSources}`,
    `font-src 'self' ${origin} ${fontSources}`,
    `img-src 'self' data: ${origin} https:`,
    `media-src 'self' ${origin} https:`,
    `connect-src 'self' ${origin} ${connectSources}`
  ].join('; ');
}
 

// ============================================================================
// NEXUS ENGINE PROCESS MANAGEMENT
// ============================================================================

let engineProcess = null;
let engineReady = false;
let commandQueue = [];
let currentResolve = null;
let engineStartResolve = null;

function getEngineBinaryName() {
  const binaryNames = getConfigObject(['engine', 'binary_names'], {});
  return String(binaryNames[process.platform] || binaryNames.default || (process.platform === 'win32' ? 'meterea_engine.exe' : 'meterea_engine'));
}

function getEnginePath() {
  const exeName = getEngineBinaryName();
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'engine', exeName);
  } else {
    return path.join(__dirname, 'engine', exeName);
  }
}

function startEngine() {
    return new Promise((resolve, reject) => {
        const enginePath = getEnginePath();
        console.log(`[Nexus] Запуск движка: ${enginePath}`);
        
        if (!fs.existsSync(enginePath)) {
            const errorMsg = `Движок не найден: ${enginePath}. Скомпилируйте его в папке engine/`;
            console.error(`[Nexus Error] ${errorMsg}`);
            resolve({ status: 'error', message: errorMsg });
            return;
        }

        engineProcess = spawn(enginePath, [], {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: path.join(__dirname),
            windowsHide: true
        });

        engineProcess.stdout.setEncoding('utf8');
        let stdoutBuffer = '';

        engineProcess.stdout.on('data', (data) => {
            stdoutBuffer += data;
            
            // Обрабатываем полные JSON сообщения (разделенные \n)
            const lines = stdoutBuffer.split('\n');
            stdoutBuffer = lines.pop() || ''; // Оставляем неполную строку в буфере

            for (const line of lines) {
                if (!line.trim()) continue;

                // Detect engine ready signal during startup
                if (!engineReady && engineStartResolve && line.toLowerCase().includes('ready')) {
                    engineReady = true;
                    const startResolve = engineStartResolve;
                    engineStartResolve = null;
                    startResolve({ status: 'ok', message: 'Engine started' });
                }

                try {
                    const response = JSON.parse(line);
                    
                    // Если это сообщение о прогрессе, пробрасываем в рендерер и НЕ резолвим промис
                    if (response.status === 'progress') {
                        const wins = BrowserWindow.getAllWindows();
                        if (wins.length > 0) {
                            wins[0].webContents.send('nexus-progress-update', response.message);
                        }
                        continue;
                    }

                    if (response.status === 'hook_request') {
                        const wins = BrowserWindow.getAllWindows();
                        if (wins.length > 0) {
                            wins[0].webContents.send('nexus-hook-request', response.hook, response.world);
                        }
                        continue; // Не резолвим основной промис, ждем hook_response
                    }

                    // Lightweight mod hook event — fire-and-forget, no world sync
                    if (response.status === 'hook_event') {
                        const wins = BrowserWindow.getAllWindows();
                        if (wins.length > 0) {
                            wins[0].webContents.send('nexus-hook-event', response.hook, response.data || {});
                        }
                        continue; // Не резолвим промис — это событие, не ответ на команду
                    }

                    // Realtime update from engine — stream world state to renderer immediately
                    if (response.status === 'realtime_update') {
                        const wins = BrowserWindow.getAllWindows();
                        if (wins.length > 0) {
                            wins[0].webContents.send('nexus-realtime-update', response);
                        }
                        continue; // Не резолвим промис — это стрим, не ответ на команду
                    }

                    if (currentResolve) {
                        const resolve = currentResolve;
                        currentResolve = null;
                        resolve(response);
                        processQueue();
                    }
                } catch (e) {
                    console.error('[Nexus Parse Error]', e.message, line.substring(0, 500) + '... [TRUNCATED]');
                }
            }
        });

        engineProcess.stderr.on('data', (data) => {
            console.error('[Nexus Stderr]', data.toString());
        });

        engineProcess.on('close', (code) => {
            console.log(`[Nexus] Движок завершен с кодом ${code}`);
            if (code !== 0 && code !== null) {
                console.error(`[Nexus CRITICAL] Процесс упал. Если это произошло на ПК без среды разработки, убедитесь, что бинарник собран с флагом -static.`);
            }
            engineProcess = null;
            engineReady = false;
            
            // Отклоняем текущую команду если она была
            if (currentResolve) {
                currentResolve({ status: 'error', message: `Engine connection lost (code ${code})` });
                currentResolve = null;
            }
            // Очищаем очередь, чтобы не блокировать UI
            while (commandQueue.length > 0) {
                const task = commandQueue.shift();
                task.resolve({ status: 'error', message: `Engine crashed before execution (code ${code})` });
            }
        });

        engineProcess.on('error', (err) => {
            console.error('[Nexus Error]', err);
            reject(err);
        });

        // Wait for engine to signal readiness, with 10-second fallback timeout
        let startResolved = false;
        engineStartResolve = (result) => {
            if (startResolved) return;
            startResolved = true;
            engineStartResolve = null;
            resolve(result);
        };

        setTimeout(() => {
            if (!startResolved) {
                startResolved = true;
                engineStartResolve = null;
                engineReady = true;
                resolve({ status: 'ok', message: 'Engine started (ready signal timeout)' });
            }
        }, ENGINE_START_TIMEOUT_MS); }); } function sendCommand(command, params = {}, timeoutMs = DEFAULT_ENGINE_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        if (!engineProcess || !engineReady) {
            resolve({ status: 'error', message: 'Engine not ready' });
            return;
        }

        const message = JSON.stringify({ command, ...params }) + '\n';

        // Configurable timeout — long-running commands like preSimulate need more time
        const timeoutId = setTimeout(() => {
            // CRITICAL: When a command times out, the engine is still processing it.
            // If we just clear currentResolve, the engine's response will be consumed
            // by the NEXT command's resolve (response mismatch). Instead, we mark the
            // engine as "not ready" and flush the queue, forcing a fresh start.
            console.warn(`[Nexus] Command '${command}' timed out (${timeoutMs / 1000}s). Flushing command queue.`);

            // Reject all queued commands — they can't be processed correctly
            while (commandQueue.length > 0) {
                const queued = commandQueue.shift();
                queued.resolve({ status: 'error', message: `Queue flushed: previous command '${command}' timed out` });
            }

            // If this was the currently processing command, mark it as timed out
            // but DON'T clear currentResolve — let the engine's eventual response
            // be silently consumed (it will resolve this promise which is already resolved)
            if (currentResolve === wrappedResolve) {
                currentResolve = null;
                // Mark engine as potentially out-of-sync.
                // The next successful engine response will re-enable it.
                engineReady = false;
                // Re-enable after a short delay — the engine might still be working
                // and will become responsive after it finishes the timed-out command.
                setTimeout(() => {
                    if (!engineReady && engineProcess) {
                        engineReady = true;
                        console.log('[Nexus] Engine re-enabled after timeout recovery.');
                    }
                }, ENGINE_TIMEOUT_RECOVERY_MS); } resolve({ status: 'error', message: `Command timed out (${timeoutMs / 1000}s)` });
        }, timeoutMs);

        const wrappedResolve = (result) => {
            clearTimeout(timeoutId);
            resolve(result);
        };

        commandQueue.push({ message, resolve: wrappedResolve, reject });
        processQueue();
    });
}

function processQueue() {
    if (commandQueue.length === 0 || currentResolve !== null) return;
    
    const cmd = commandQueue.shift();
    currentResolve = cmd.resolve;
    
    try {
        const canWrite = engineProcess.stdin.write(cmd.message);
        // Handle backpressure: if write() returns false, wait for 'drain' before processing next command
        if (!canWrite) {
            engineProcess.stdin.once('drain', () => {
                // Don't process queue here — the current command's response will trigger processQueue
                console.log('[Nexus] stdin drain event — pipe buffer flushed.');
            });
        }
    } catch (e) {
        currentResolve = null;
        cmd.reject(e);
        processQueue();
    }
}

async function initEngine(forceRestart = false, activeMods = []) {
    if (forceRestart && engineProcess) {
        console.log("[Nexus] Принудительный перезапуск движка для очистки памяти...");
        engineProcess.removeAllListeners('close');
        engineProcess.kill();
        engineProcess = null;
        engineReady = false;
        if (currentResolve) {
            currentResolve({ status: 'error', message: 'Engine restarted' });
            currentResolve = null;
        }
        while (commandQueue.length > 0) {
            commandQueue.shift().resolve({ status: 'error', message: 'Engine restarted' });
        }
    }
    if (!engineProcess) {
        await startEngine();
    }
    return await sendCommand('init', { mods_dir: MODS_DIR, active_mods: activeMods });
}

async function buildWorld(playerId, era, initialAgents, globalLocations, startDay) {
    // buildWorld generates 256x256 terrain (Perlin noise), A* roads, NPCs — heavy computation.
    // 30s default timeout is too short; use 5 minutes like bootstrapWorld.
    return await sendCommand('buildWorld', { player_id: playerId, era: era, initial_agents: initialAgents, global_locations: globalLocations, start_day: startDay }, getEngineCommandTimeout('buildWorld', 300000));
}

async function bootstrapWorld(days, startDay) {
    // Bootstrap can take a while for many days — use 5-minute timeout
    return await sendCommand('bootstrapWorld', { days: days, start_day: startDay }, getEngineCommandTimeout('bootstrapWorld', 300000));
}

async function simulateTicks(world, ticks, playerLocation = "") {
    // Don't send world back to engine — it already has it in memory after buildWorld.
    // Sending a huge World JSON (1.5MB+) through stdin causes the engine to hang.
    // Only sync world if the client explicitly needs to push changes (use syncState for that).
    return await sendCommand('simulateTicks', { ticks, player_location: playerLocation || "" });
}

async function preSimulate(world, ticks) {
    // Don't send world back to engine — it already has it in memory after buildWorld.
    // Sending a huge World JSON (1.5MB+) through stdin causes the engine to hang/timeout.
    // Pre-simulation can take minutes for large tick counts — use 10-minute timeout.
    const timeoutMs = Math.max(PRESIMULATE_MIN_TIMEOUT_MS, ticks * PRESIMULATE_TIMEOUT_MS_PER_TICK); // At least 10 min, or 10ms per tick
    return await sendCommand('preSimulate', { ticks }, timeoutMs);
}

async function syncState(world, items, containers) {
    // syncState can involve huge World JSON (1.5MB+) that takes time to parse.
    // Use 5-minute timeout like bootstrapWorld.
    return await sendCommand('syncState', { world, items, containers }, getEngineCommandTimeout('syncState', 300000));
}

async function loadWorldFile(filePath) {
    // Load world state from a file — bypasses the 64KB stdin pipe buffer limit.
    // The C++ engine reads the file directly, avoiding pipe buffer overflow for large worlds.
    // The file should contain: { "world": {...}, "items": [...], "containers": [...] }
    return await sendCommand('loadWorldFile', { path: filePath }, getEngineCommandTimeout('loadWorldFile', 300000));
}

async function getGraphContext(queryIds) {
    return await sendCommand('getGraphContext', { query_ids: queryIds });
}


async function getFullState(playerLocation = "") {
    return await sendCommand('getFullState', { player_location: playerLocation });
}

async function gmIntervention(commandObj, playerLocation = "") {
    return await sendCommand('gmIntervention', { args: commandObj, player_location: playerLocation });
}

async function startTrek(startId, destinationId) {
    return await sendCommand('startTrek', { start_id: startId, destination_id: destinationId });
}
async function pauseTrek() { return await sendCommand('pauseTrek'); }
async function resumeTrek() { return await sendCommand('resumeTrek'); }
async function cancelTrek() { return await sendCommand('cancelTrek'); }
async function interactTrekObject(objType, simId) {
    return await sendCommand('interactWithObject', { object_type: objType, sim_object_id: simId });
}

// ============================================================================
// IPC HANDLERS FOR NEXUS ENGINE
// ============================================================================

ipcMain.handle('nexus-hook-response', async (event, world) => {
    // Route through the command queue to avoid stdin write race conditions.
    // Previously this bypassed the queue, which could interleave with queued commands
    // and corrupt the newline-delimited protocol.
    if (engineProcess && engineReady) {
        return await sendCommand('hook_response', { world: world }, getEngineCommandTimeout('hook_response', 60000));
    }
    return { status: 'error', message: 'Engine not ready for hook response' };
});

ipcMain.handle('nexus-register-hooks', async (event, hooks) => {
    return await sendCommand('registerHooks', { hooks: hooks });
});

ipcMain.handle('nexus-init', async (event, forceRestart = false, activeMods = []) => {
    return await initEngine(forceRestart, activeMods);
});


ipcMain.handle('nexus-load-database', async (event, databaseString) => {
    let dbObj;
    try {
        dbObj = JSON.parse(databaseString);
    } catch (e) {
        return { status: 'error', message: 'Invalid JSON: ' + e.message };
    }
    return await sendCommand('loadDatabase', dbObj);
});

ipcMain.handle('nexus-build-world', async (event, playerId, era, initialAgents, globalLocations, startDay) => {
    return await buildWorld(playerId, era, initialAgents, globalLocations, startDay);
});

ipcMain.handle('nexus-bootstrap', async (event, days, startDay) => {
    return await bootstrapWorld(days, startDay);
});

ipcMain.handle('nexus-simulate', async (event, world, ticks, playerLocation) => {
    return await sendCommand('simulateTicks', { ticks: ticks, player_location: playerLocation || "" });
});

ipcMain.handle('nexus-presimulate', async (event, world, ticks) => {
    return await preSimulate(world, ticks);
});

ipcMain.handle('nexus-sync-state', async (event, world, items, containers) => {
    return await syncState(world, items, containers);
});

ipcMain.handle('nexus-load-world-file', async (event, filePath) => {
    // Validate filePath is within SAVES_DIR to prevent path traversal
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(path.resolve(SAVES_DIR))) {
        return { status: 'error', message: 'Invalid file path: must be within saves directory' };
    }
    return await loadWorldFile(filePath);
});

ipcMain.handle('nexus-write-sync-file', async (event, worldData) => {
    // Write world data to a temp file for the engine to read via loadWorldFile.
    // Returns the full file path on success.
    try {
        const tempFileName = SYNC_TEMP_FILE_NAME;
        const tempFilePath = path.join(SAVES_DIR, tempFileName);
        fs.writeFileSync(tempFilePath, JSON.stringify(worldData));
        return { status: 'ok', path: tempFilePath };
    } catch (error) {
        return { status: 'error', message: error.message };
    }
});

ipcMain.handle('nexus-get-full-state', async (event, playerLocation) => {
    return await getFullState(playerLocation || "");
});

ipcMain.handle('nexus-get-graph-context', async (event, queryIds) => {
    return await getGraphContext(queryIds);
});


ipcMain.handle('nexus-get-world-map', async () => {
    return await sendCommand('getWorldMap', {});
});

ipcMain.handle('nexus-gm-intervention', async (event, commandObj, playerLocation) => {
    return await gmIntervention(commandObj, playerLocation || "");
});

ipcMain.handle('nexus-inventory-command', async (event, params) => {
    return await sendCommand('inventoryCommand', params);
});


ipcMain.handle('nexus-start-trek', async (event, startId, destId) => await startTrek(startId, destId));
ipcMain.handle('nexus-pause-trek', async () => await pauseTrek());
ipcMain.handle('nexus-resume-trek', async () => await resumeTrek());
ipcMain.handle('nexus-cancel-trek', async () => await cancelTrek());
ipcMain.handle('nexus-interact-trek-object', async (event, type, id) => await interactTrekObject(type, id));

ipcMain.handle('nexus-transport-command', async (event, params) => {
    return await sendCommand('transportCommand', params);
});

ipcMain.handle('nexus-manage-business', async (event, params) => {
    return await sendCommand('playerManageBusiness', params);
});

ipcMain.handle('nexus-start-realtime', async (event, intervalMs = REALTIME_DEFAULT_INTERVAL_MS) => {
    return await sendCommand('startRealtime', { interval: intervalMs });
});

ipcMain.handle('nexus-stop-realtime', async () => {
    return await sendCommand('stopRealtime', {});
});

// Whitelist of allowed commands for nexus-send-raw-command (security: prevents arbitrary command execution)


ipcMain.handle('nexus-send-raw-command', async (event, command, params) => {
    if (!ALLOWED_RAW_COMMANDS.has(command)) {
        console.error(`[Security] Blocked raw command: "${command}". Not in whitelist.`);
        return { status: 'error', message: `Command "${command}" is not allowed. Use specific IPC handlers.` };
    }
    return await sendCommand(command, params);
});

// ============================================================================
// EXISTING CODE...
// ============================================================================ 

function isSafeFileName(filename) { return typeof filename === 'string' && SAFE_JSON_FILENAME_PATTERN.test(filename); }

// Session token for HTTP server authentication — prevents other localhost apps from accessing
const HTTP_SESSION_TOKEN = require('crypto').randomBytes(HTTP_SESSION_TOKEN_BYTES).toString(HTTP_SESSION_TOKEN_ENCODING);

// Rate limiter: generous limits for localhost (desktop app, single user).
// External connections remain restricted (defense-in-depth for exposed ports).
// NOTE: CTRL+SHIFT+R triggers ~10-15 requests at once (all JS/CSS/HTML files),
// plus ongoing simulation/API calls. Need high limit for localhost.
const rateLimiter = new Map(); function checkRateLimit(ip) { const now = Date.now(); const isLocal = LOCALHOST_IPS.has(ip); const windowMs = isLocal ? LOCAL_RATE_LIMIT_WINDOW_MS : REMOTE_RATE_LIMIT_WINDOW_MS; const maxRequests = isLocal ? LOCAL_RATE_LIMIT_MAX_REQUESTS : REMOTE_RATE_LIMIT_MAX_REQUESTS; const entry = rateLimiter.get(ip); if (!entry || now - entry.start > windowMs) { rateLimiter.set(ip, { start: now, count: 1 }); return true; } entry.count++; if (entry.count > maxRequests) return false; return true; } setInterval(() => { const now = Date.now(); for (const [ip, entry] of rateLimiter) { if (now - entry.start > RATE_LIMIT_ENTRY_TTL_MS) rateLimiter.delete(ip); } }, RATE_LIMIT_CLEANUP_INTERVAL_MS);

const server = http.createServer((req, res) => {
    // Rate limit check
    const clientIp = req.socket.remoteAddress || '127.0.0.1';
    if (!checkRateLimit(clientIp)) {
        res.statusCode = 429;
        res.end('Too Many Requests');
        return;
    }

    // Auth check: validate session token in URL query param
    const urlObj = new URL(req.url, getServerOrigin());
    const token = urlObj.searchParams.get('token');
    if (token !== HTTP_SESSION_TOKEN) {
        // Also allow requests from our own Electron origin without token (for initial load)
        const origin = req.headers.origin || req.headers.referer || '';
        if (!origin.includes(`${SERVER_HOST}:${PORT}`)) {
            res.statusCode = 403;
            res.end('Forbidden');
            return;
        }
    }

    let urlPath;
    try {
        urlPath = decodeURI(req.url.split('?')[0]);
    } catch (e) {
        // Malformed URI (e.g. %E0%A4%A or other invalid percent-encoding)
        res.statusCode = 400;
        res.end('Bad Request');
        return;
    }
    let filePath = path.join(__dirname, urlPath === '/' ? 'index.html' : urlPath);

    // Path traversal protection: ensure resolved path stays within __dirname
    filePath = path.resolve(filePath);
    if (!filePath.startsWith(path.resolve(__dirname))) {
        res.statusCode = 403;
        res.end('Forbidden');
        return;
    }

    // Deny access to sensitive files
    const basename = path.basename(filePath);
    if (SENSITIVE_FILES.has(basename) || SENSITIVE_FILE_SUBSTRINGS.some(part => filePath.includes(part))) {
        res.statusCode = 403;
        res.end('Forbidden');
        return;
    }

    // Only allow GET and HEAD methods
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.statusCode = 405;
        res.end('Method Not Allowed');
        return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.statusCode = 404;
            res.end('Not Found');
            return;
        }
        // Limit file size to 50MB to prevent memory exhaustion
        if (data.length > MAX_STATIC_FILE_SIZE_BYTES) {
            res.statusCode = 413;
            res.end('Payload Too Large');
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
        res.setHeader('Access-Control-Allow-Origin', getServerOrigin());
        // Security headers
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        // Content Security Policy — suppress Electron CSP warning, allow necessary directives
        if (ext === '.html') { res.setHeader('Content-Security-Policy', buildContentSecurityPolicy()); }
        res.end(data);
    });
});

server.listen(PORT, SERVER_HOST, () => { console.log(`[SERVER] Static origin: ${getServerOrigin()}`); });

function createWindow () { const win = new BrowserWindow({ width: WINDOW_WIDTH, height: WINDOW_HEIGHT, webPreferences: { nodeIntegration: WINDOW_NODE_INTEGRATION, contextIsolation: WINDOW_CONTEXT_ISOLATION, ...(process.env.NODE_ENV === 'development' && WINDOW_DISABLE_WEB_SECURITY_IN_DEVELOPMENT ? { webSecurity: false } : {}), preload: path.join(__dirname, WINDOW_PRELOAD_FILE) } });

  // Перехватываем открытие новых окон (внешних ссылок _blank)
  // и принудительно открываем их в браузере по умолчанию (Chrome, Firefox и т.д.)
  win.webContents.setWindowOpenHandler(({ url }) => {
      if (EXTERNAL_LINK_PROTOCOLS.some(protocol => url.startsWith(protocol))) {
          require('electron').shell.openExternal(url);
          return { action: 'deny' };
      }
      return { action: 'allow' };
  });

  // Pass HTTP session token to renderer for authenticated API requests
  win.loadURL(`${getServerOrigin()}?token=${HTTP_SESSION_TOKEN}`);

  // Reset rate limiter on page reload (CTRL+SHIFT+R triggers many concurrent requests)
  win.webContents.on('did-navigate', () => {
      rateLimiter.clear();
  });
  win.webContents.on('did-navigate-in-page', () => {
      rateLimiter.clear();
  });
}

app.whenReady().then(createWindow);

// Expose HTTP session token to renderer (needed for fetch calls from game)
ipcMain.handle('get-http-token', () => HTTP_SESSION_TOKEN);


ipcMain.handle('app-relaunch', async () => {
    try {
        console.log('[App] Relaunch requested from renderer.');
        setImmediate(() => {
            app.relaunch();
            app.exit(0);
        });
        return { success: true };
    } catch (error) {
        console.error('[App] Relaunch failed:', error.message);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('save-settings', async (event, data) => {
    try {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            return false;
        }
        const serialized = JSON.stringify(data, null, 2);
        const MAX_SETTINGS_SIZE = 512 * 1024; // 512 KB limit
        if (serialized.length > MAX_SETTINGS_SIZE) {
            console.warn('[IPC] save-settings rejected: payload exceeds 512KB limit');
            return false;
        }
        fs.writeFileSync(SETTINGS_FILE, serialized);
        return true;
    } catch (e) { return false; }
});

ipcMain.handle('load-settings', async () => {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
        }
    } catch (e) { return null; }
    return null;
});


ipcMain.handle('runtime-log-append', async (event, entry) => {
    try {
        const safeEntry = {
            ts: new Date().toISOString(),
            level: typeof entry?.level === 'string' ? entry.level : 'info',
            scope: typeof entry?.scope === 'string' ? entry.scope : 'runtime',
            message: typeof entry?.message === 'string' ? entry.message.slice(0, 4000) : String(entry?.message || ''),
            detail: entry?.detail === undefined ? null : entry.detail
        };
        const line = JSON.stringify(safeEntry) + '\n';
        await fs.promises.appendFile(RUNTIME_LOG_FILE, line, 'utf-8');
        return { success: true, path: RUNTIME_LOG_FILE };
    } catch (error) {
        console.error('[RuntimeLog] Failed to append runtime log:', error.message);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('save-game', async (event, filename, data) => {
    if (!isSafeFileName(filename)) return { success: false };
    try {
        fs.writeFileSync(path.join(SAVES_DIR, filename), JSON.stringify(data, null, 2));
        return { success: true };
    } catch (error) { return { success: false }; }
});

ipcMain.handle('load-game', async (event, filename) => {
    if (!isSafeFileName(filename)) return null;
    try {
        const filePath = path.join(SAVES_DIR, filename);
        if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (e) { return null; }
});

ipcMain.handle('save-world-state', async (event, filename, data) => {
    if (!isSafeFileName(filename)) return { success: false };
    try {
        const name = data.name || "Неизвестный мир";
        const era = data.era || "rebirth";
        delete data.name;
        delete data.era;
        const orderedData = { name, era, ...data };
        fs.writeFileSync(path.join(WORLDS_DIR, filename), JSON.stringify(orderedData));
        return { success: true };
    } catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('load-world-state', async (event, filename) => {
    if (!isSafeFileName(filename)) return null;
    try {
        const filePath = path.join(WORLDS_DIR, filename);
        if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (e) { return null; }
});

ipcMain.handle('list-worlds', async () => {
    try {
        const files = fs.readdirSync(WORLDS_DIR).filter(f => f.endsWith('.json'));
        const results = [];
        for (const file of files) {
            try {
                const filePath = path.join(WORLDS_DIR, file);
                const stats = fs.statSync(filePath);
                const fd = fs.openSync(filePath, 'r');
                const buffer = Buffer.alloc(WORLD_PREVIEW_BYTES); const bytesRead = fs.readSync(fd, buffer, 0, WORLD_PREVIEW_BYTES, 0);
                fs.closeSync(fd);
                const chunk = buffer.toString('utf-8', 0, bytesRead);
                const nameMatch = chunk.match(/"name"\s*:\s*"([^"]+)"/);
                const eraMatch = chunk.match(/"era"\s*:\s*"([^"]+)"/);
                const modListMatch = chunk.match(/"mod_list"\s*:\s*(\[[\s\S]*?\])/);
                let modList = [];
                if (modListMatch) {
                    try {
                        const parsedModList = JSON.parse(modListMatch[1]);
                        if (Array.isArray(parsedModList)) {
                            modList = parsedModList.filter(m => typeof m === 'string');
                        }
                    } catch (parseError) {
                        console.warn(`[World] Не удалось прочитать mod_list из ${file}:`, parseError.message);
                    }
                }
                results.push({ 
                    filename: file, 
                    timestamp: stats.mtime.toISOString(), 
                    name: nameMatch ? nameMatch[1] : "Неизвестный мир",
                    era: eraMatch ? eraMatch[1] : "rebirth",
                    mod_list: modList
                });
            } catch (err) {
                console.error(`[World] Ошибка чтения файла ${file}:`, err.message);
            }
        }
        return results;
    } catch (e) { 
        console.error("[World] Ошибка чтения папки:", e);
        return []; 
    }
});

ipcMain.handle('delete-world', async (event, filename) => {
    if (!isSafeFileName(filename)) return false;
    try {
        const filePath = path.join(WORLDS_DIR, filename);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            return true;
        }
    } catch (e) { return false; }
    return false;
});

// --- НОВЫЕ ПОТОКОВЫЕ МЕТОДЫ (STREAMING) ---
ipcMain.handle('init-save-file', async (event, filename) => {
    if (!isSafeFileName(filename)) return false;
    try {
        await fs.promises.writeFile(path.join(SAVES_DIR, filename), '');
        return true;
    } catch (e) { return false; }
});

ipcMain.handle('append-save-line', async (event, filename, line) => {
    if (!isSafeFileName(filename)) return false;
    // Limit line size to prevent memory exhaustion (10MB max)
    if (typeof line !== 'string' || line.length > MAX_APPEND_SAVE_LINE_BYTES) return false;
    try {
        await fs.promises.appendFile(path.join(SAVES_DIR, filename), line);
        return true;
    } catch (e) { return false; }
});

ipcMain.handle('get-file-size', async (event, filename) => {
    if (!isSafeFileName(filename)) return 0;
    try {
        const stats = await fs.promises.stat(path.join(SAVES_DIR, filename));
        return stats.size;
    } catch (e) { return 0; }
});

ipcMain.handle('get-save-path', async () => {
    return SAVES_DIR;
});

ipcMain.handle('read-save-chunk', async (event, filename, position, size) => {
    if (!isSafeFileName(filename)) return "";
    // Validate bounds
    if (typeof position !== 'number' || position < 0) return "";
    if (typeof size !== 'number' || size <= 0 || size > MAX_READ_SAVE_CHUNK_BYTES) return ""; // Max 1MB per chunk
    try {
        const fd = await fs.promises.open(path.join(SAVES_DIR, filename), 'r');
        const buffer = Buffer.alloc(size);
        const { bytesRead } = await fd.read(buffer, 0, size, position);
        await fd.close();
        return buffer.toString('utf-8', 0, bytesRead);
    } catch (e) { return ""; }
});

ipcMain.handle('list-saves', async () => {
    try {
        const files = fs.readdirSync(SAVES_DIR).filter(f => f.endsWith('.json'));
        const results = [];
        for (const file of files) {
            try {
                const filePath = path.join(SAVES_DIR, file);
                const stats = fs.statSync(filePath);
                
                const fd = fs.openSync(filePath, 'r');
                const buffer = Buffer.alloc(SAVE_PREVIEW_BYTES); const bytesRead = fs.readSync(fd, buffer, 0, SAVE_PREVIEW_BYTES, 0);
                fs.closeSync(fd);
                
                const chunk = buffer.toString('utf-8', 0, bytesRead);
                
                if (chunk.startsWith('{"block":"meta"')) {
                    const firstLine = chunk.split('\n')[0];
                    const meta = JSON.parse(firstLine).data;
                    results.push({ filename: file, timestamp: meta.timestamp, playerData: meta.playerData });
                } else {
                    const nameMatch = chunk.match(/"name"\s*:\s*"([^"]+)"/);
                    const levelMatch = chunk.match(/"level"\s*:\s*(\d+)/);
                    const tsMatch = chunk.match(/"timestamp"\s*:\s*"([^"]+)"/);
                    
                    results.push({ 
                        filename: file, 
                        timestamp: tsMatch ? tsMatch[1] : stats.mtime.toISOString(), 
                        playerData: {
                            name: nameMatch ? nameMatch[1] : "Герой",
                            stats: { level: levelMatch ? parseInt(levelMatch[1]) : "?" }
                        }
                    });
                }
            } catch (err) {
                console.error(`[Save] Ошибка чтения превью файла ${file}:`, err.message);
            }
        }
        return results;
    } catch (e) { 
        console.error("[Save] Ошибка чтения папки:", e);
        return []; 
    }
});

ipcMain.handle('delete-save', async (event, filename) => {
    if (!isSafeFileName(filename)) return false;
    try {
        const filePath = path.join(SAVES_DIR, filename);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            return true;
        }
    } catch (e) { return false; }
    return false;
});

// ============================================================================
// MODDING SYSTEM IPC HANDLERS
// ============================================================================

ipcMain.handle('mods-get-list', async () => {
    try {
        if (!fs.existsSync(MODS_DIR)) {
            return { success: true, mods: [] };
        }
        const modFolders = fs.readdirSync(MODS_DIR, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        const modsData = [];
        for (const modFolder of modFolders) {
            const modJsonPath = path.join(MODS_DIR, modFolder, 'mod.json');
            if (fs.existsSync(modJsonPath)) {
                try {
                    const modJsonContent = fs.readFileSync(modJsonPath, 'utf-8');
                    const modMeta = JSON.parse(modJsonContent);
                    // Add folder for reference, useful for loading data later
                    modMeta.folder = modFolder; 
                    modsData.push(modMeta);
                } catch (e) {
                    console.error(`[Mods] Error parsing mod.json for ${modFolder}:`, e.message);
                    // Optionally, return malformed mods so UI can show an error
                    modsData.push({ id: modFolder, name: modFolder, error: 'Invalid mod.json' });
                }
            }
        }
        return { success: true, mods: modsData };
    } catch (e) {
        console.error('[Mods] Error reading mods directory:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('mods-open-folder', () => {
    shell.openPath(MODS_DIR).catch(e => console.error('Failed to open mods folder:', e));
});

ipcMain.handle('mods-read-file', async (event, { modFolder, fileName }) => {
    // Security: Normalize and resolve paths to prevent traversal
    const safeModFolder = path.normalize(modFolder).replace(/^(\.\.(\/|\\|$))+/, '');
    const safeFileName = path.normalize(fileName).replace(/^(\.\.(\/|\\|$))+/, '');
    
    let fullPath = path.join(MODS_DIR, safeModFolder, safeFileName);
    if (!fs.existsSync(fullPath)) {
        // Fallback for older mods that assumed the root was the data folder
        fullPath = path.join(MODS_DIR, safeModFolder, 'data', safeFileName);
    }

    // Security: Resolve the full path and verify it stays within MODS_DIR
    const resolvedPath = path.resolve(fullPath);
    if (!resolvedPath.startsWith(path.resolve(MODS_DIR))) {
        return { success: false, error: 'Access denied' };
    }

    try {
        if (fs.existsSync(resolvedPath)) {
            const content = await fs.promises.readFile(resolvedPath, 'utf-8');
            return { success: true, content };
        } else {
            return { success: false, error: 'File not found (ENOENT)' };
        }
    } catch (e) {
        return { success: false, error: e.message };
    }
});



ipcMain.handle('speak-text', async (event, text, voiceModel) => {
    const { spawn } = require('child_process');
    const path = require('path');
    const fs = require('fs');

    return new Promise((resolve) => {
        // Validate voiceModel to prevent path traversal
        if (!voiceModel || !/^[a-zA-Z0-9_.\-]+\.onnx$/.test(voiceModel)) {
            resolve({ success: false, error: 'Invalid voice model name' });
            return;
        }
        
        let ttsDir;
        if (app.isPackaged) {
            ttsDir = path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'tts');
        } else {
            ttsDir = path.join(__dirname, 'assets', 'tts');
        }
        
        const piperExe = path.join(ttsDir, process.platform === 'win32' ? 'piper.exe' : 'piper');
        const modelPath = path.join(ttsDir, voiceModel);
        const outputPath = path.join(app.getPath('temp'), `tts_${Date.now()}.wav`);

        if (!fs.existsSync(piperExe)) {
            resolve({ success: false, error: `Piper не найден: ${piperExe}` });
            return;
        }
        
        if (!fs.existsSync(modelPath)) {
            resolve({ success: false, error: `Модель не найдена: ${modelPath}` });
            return;
        }

        let errorOutput = '';

        const env = {
            ...process.env,
            ESPEAK_DATA_PATH: ttsDir
        };
        if (process.platform === 'win32') {
            env.PATH = `${ttsDir};${process.env.PATH || ''}`;
        } else {
            env.LD_LIBRARY_PATH = `${ttsDir}:${process.env.LD_LIBRARY_PATH || ''}`;
        }

        const piper = spawn(piperExe, [
            '--model', modelPath, 
            '--output_file', outputPath
        ], { 
            cwd: ttsDir, 
            env: env,
            windowsHide: true 
        });

        piper.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        piper.stdin.setDefaultEncoding('utf-8');
        piper.stdin.write(text);
        piper.stdin.end();

        piper.on('close', (code) => {
            if (code === 0) {
                resolve({ success: true, audioPath: `file://${outputPath}` });
            } else {
                console.error(`[Piper Error] Code: ${code}, Details: ${errorOutput}`);
                resolve({ success: false, error: `Piper exit code: ${code}. Details: ${errorOutput}` });
            }
        });
        
        piper.on('error', (err) => resolve({ success: false, error: err.message }));
    });
});

ipcMain.handle('gemini-request', async (event, model, contents) => {
    const { net } = require('electron');
    return new Promise((resolve, reject) => {
        // Read API key from settings instead of accepting from renderer
        let apiKey = ''; let settings = {}; try { if (fs.existsSync(SETTINGS_FILE)) { settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')); apiKey = settings.geminiApiKey || settings.apiKey || ''; } } catch (e) {
            console.error('[gemini-request] Failed to read settings.json:', e.message);
            return reject(new Error('Failed to read API key from settings: ' + e.message));
        }
        if (!apiKey) {
            return reject(new Error('API key not configured in settings'));
        }
        // Safety settings: configurable via settings.json "safetyThresholds".
        // Defaults are moderate (BLOCK_MEDIUM_AND_ABOVE) instead of BLOCK_NONE.
        // Valid thresholds: BLOCK_LOW_AND_ABOVE, BLOCK_MEDIUM_AND_ABOVE,
        //                  BLOCK_ONLY_HIGH, BLOCK_NONE
        const defaultThreshold = GEMINI_DEFAULT_SAFETY_THRESHOLD; const savedThresholds = (settings && settings.safetyThresholds) || {};
        const safetySettings = [ 
            { category: "HARM_CATEGORY_HARASSMENT", threshold: savedThresholds.harassment || defaultThreshold }, 
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: savedThresholds.hateSpeech || defaultThreshold }, 
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: savedThresholds.sexuallyExplicit || defaultThreshold }, 
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: savedThresholds.dangerousContent || defaultThreshold } 
        ];
        const requestBody = JSON.stringify({ contents, generationConfig: GEMINI_GENERATION_CONFIG, safetySettings });
        const request = net.request({
            method: 'POST', protocol: 'https:', hostname: 'generativelanguage.googleapis.com',
            path: `/v1beta/models/${model}:generateContent`,
            headers: { 
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey
            }
        });
        request.on('response', (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve(JSON.parse(body)));
        });
        request.on('error', e => reject(e));
        request.write(requestBody);
        request.end();
    });
});