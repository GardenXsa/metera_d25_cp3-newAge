const { app, BrowserWindow, ipcMain, protocol, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const USER_DATA = app.getPath('userData');
const SAVES_DIR = path.join(USER_DATA, 'saves');
const MODS_DIR = path.join(USER_DATA, 'mods');
const SETTINGS_FILE = path.join(USER_DATA, 'settings.json');

if (!fs.existsSync(SAVES_DIR)) fs.mkdirSync(SAVES_DIR, { recursive: true });
if (!fs.existsSync(MODS_DIR)) fs.mkdirSync(MODS_DIR, { recursive: true });

const WORLDS_DIR = path.join(SAVES_DIR, 'worlds');
if (!fs.existsSync(WORLDS_DIR)) fs.mkdirSync(WORLDS_DIR, { recursive: true });

const PORT = 30007; 

// ============================================================================
// NEXUS ENGINE PROCESS MANAGEMENT
// ============================================================================

let engineProcess = null;
let engineReady = false;
let commandQueue = [];
let currentResolve = null;
let engineStartResolve = null;

function getEnginePath() {
    const exeName = process.platform === 'win32' ? 'meterea_engine.exe' : 'meterea_engine';
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
        }, 10000);
    });
}

function sendCommand(command, params = {}, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        if (!engineProcess || !engineReady) {
            resolve({ status: 'error', message: 'Engine not ready' });
            return;
        }

        const message = JSON.stringify({ command, ...params }) + '\n';

        // Configurable timeout — long-running commands like preSimulate need more time
        const timeoutId = setTimeout(() => {
            // If this command is currently pending, clear it so queue can proceed
            if (currentResolve === wrappedResolve) {
                currentResolve = null;
                processQueue();
            }
            // Remove from queue if not yet processed
            const idx = commandQueue.findIndex(t => t.resolve === wrappedResolve);
            if (idx !== -1) commandQueue.splice(idx, 1);
            resolve({ status: 'error', message: `Command timed out (${timeoutMs / 1000}s)` });
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
        engineProcess.stdin.write(cmd.message);
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
    return await sendCommand('buildWorld', { player_id: playerId, era: era, initial_agents: initialAgents, global_locations: globalLocations, start_day: startDay });
}

async function bootstrapWorld(days, startDay) {
    // Bootstrap can take a while for many days — use 5-minute timeout
    return await sendCommand('bootstrapWorld', { days: days, start_day: startDay }, 300000);
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
    const timeoutMs = Math.max(600000, ticks * 10); // At least 10 min, or 10ms per tick
    return await sendCommand('preSimulate', { ticks }, timeoutMs);
}

async function syncState(world, items, containers) {
    return await sendCommand('syncState', { world, items, containers });
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
    if (engineProcess) {
        const msg = JSON.stringify({ command: 'hook_response', world: world }) + '\n';
        engineProcess.stdin.write(msg);
    }
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

// Whitelist of allowed commands for nexus-send-raw-command (security: prevents arbitrary command execution)
const ALLOWED_RAW_COMMANDS = new Set([
    'getWorldMap',
    'getGraphContext',
    'getFullState'
]);

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

function isSafeFileName(filename) {
    return /^[a-zA-Z0-9_-]+\.json$/.test(filename);
}

// Session token for HTTP server authentication — prevents other localhost apps from accessing
const HTTP_SESSION_TOKEN = require('crypto').randomBytes(32).toString('hex');

// Rate limiter: generous limits for localhost (desktop app, single user).
// External connections remain restricted (defense-in-depth for exposed ports).
// NOTE: CTRL+SHIFT+R triggers ~10-15 requests at once (all JS/CSS/HTML files),
// plus ongoing simulation/API calls. Need high limit for localhost.
const rateLimiter = new Map();
function checkRateLimit(ip) {
    const now = Date.now();
    // Localhost (this app itself) — very generous: 500 requests per 10 seconds
    // Non-local (shouldn't happen but just in case) — strict: 60 per 60 seconds
    const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    const window = isLocal ? 10000 : 60000;
    const maxRequests = isLocal ? 500 : 60;
    const entry = rateLimiter.get(ip);
    if (!entry || now - entry.start > window) {
        rateLimiter.set(ip, { start: now, count: 1 });
        return true;
    }
    entry.count++;
    if (entry.count > maxRequests) return false;
    return true;
}
// Clean up rate limiter every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimiter) {
        if (now - entry.start > 120000) rateLimiter.delete(ip);
    }
}, 300000);

const server = http.createServer((req, res) => {
    // Rate limit check
    const clientIp = req.socket.remoteAddress || '127.0.0.1';
    if (!checkRateLimit(clientIp)) {
        res.statusCode = 429;
        res.end('Too Many Requests');
        return;
    }

    // Auth check: validate session token in URL query param
    const urlObj = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const token = urlObj.searchParams.get('token');
    if (token !== HTTP_SESSION_TOKEN) {
        // Also allow requests from our own Electron origin without token (for initial load)
        const origin = req.headers.origin || req.headers.referer || '';
        if (!origin.includes(`127.0.0.1:${PORT}`)) {
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
    const SENSITIVE_FILES = new Set([
        'settings.json', '.env', '.gitignore', 'conversation-', 'project_scan.txt'
    ]);
    if (SENSITIVE_FILES.has(basename) || filePath.includes('conversation-')) {
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
        if (data.length > 50 * 1024 * 1024) {
            res.statusCode = 413;
            res.end('Payload Too Large');
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
            '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
            '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpg',
            '.jpeg': 'image/jpeg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav'
        };
        res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
        res.setHeader('Access-Control-Allow-Origin', `http://127.0.0.1:${PORT}`);
        // Security headers
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        // Content Security Policy — suppress Electron CSP warning, allow necessary directives
        if (ext === '.html') {
            res.setHeader('Content-Security-Policy',
                "default-src 'self' http://127.0.0.1:" + PORT + "; " +
                "script-src 'self' 'unsafe-eval' http://127.0.0.1:" + PORT + " https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; " +
                "style-src 'self' 'unsafe-inline' http://127.0.0.1:" + PORT + " https://fonts.googleapis.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; " +
                "font-src 'self' http://127.0.0.1:" + PORT + " https://fonts.gstatic.com https://cdnjs.cloudflare.com; " +
                "img-src 'self' data: http://127.0.0.1:" + PORT + " https:; " +
                "media-src 'self' http://127.0.0.1:" + PORT + " https:; " +
                "connect-src 'self' http://127.0.0.1:" + PORT + " https://cdnjs.cloudflare.com https://cdn.jsdelivr.net;"
            );
        }
        res.end(data);
    });
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`[SERVER] Static origin: http://127.0.0.1:${PORT}`);
});

function createWindow () {
  const win = new BrowserWindow({
    width: 1280, height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      ...(process.env.NODE_ENV === 'development' ? { webSecurity: false } : {}),
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Перехватываем открытие новых окон (внешних ссылок _blank)
  // и принудительно открываем их в браузере по умолчанию (Chrome, Firefox и т.д.)
  win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http://') || url.startsWith('https://')) {
          require('electron').shell.openExternal(url);
          return { action: 'deny' };
      }
      return { action: 'allow' };
  });

  // Pass HTTP session token to renderer for authenticated API requests
  win.loadURL(`http://127.0.0.1:${PORT}?token=${HTTP_SESSION_TOKEN}`);

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

ipcMain.handle('save-settings', async (event, data) => {
    try {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
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
                const buffer = Buffer.alloc(512);
                const bytesRead = fs.readSync(fd, buffer, 0, 512, 0);
                fs.closeSync(fd);
                const chunk = buffer.toString('utf-8', 0, bytesRead);
                const nameMatch = chunk.match(/"name"\s*:\s*"([^"]+)"/);
                const eraMatch = chunk.match(/"era"\s*:\s*"([^"]+)"/);
                results.push({ 
                    filename: file, 
                    timestamp: stats.mtime.toISOString(), 
                    name: nameMatch ? nameMatch[1] : "Неизвестный мир",
                    era: eraMatch ? eraMatch[1] : "rebirth"
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

ipcMain.handle('read-save-chunk', async (event, filename, position, size) => {
    if (!isSafeFileName(filename)) return "";
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
                const buffer = Buffer.alloc(1024);
                const bytesRead = fs.readSync(fd, buffer, 0, 1024, 0);
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
        let apiKey = '';
        try {
            if (fs.existsSync(SETTINGS_FILE)) {
                const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
                apiKey = settings.geminiApiKey || settings.apiKey || '';
            }
        } catch (e) {
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
        const defaultThreshold = "BLOCK_MEDIUM_AND_ABOVE";
        const savedThresholds = (settings && settings.safetyThresholds) || {};
        const safetySettings = [ 
            { category: "HARM_CATEGORY_HARASSMENT", threshold: savedThresholds.harassment || defaultThreshold }, 
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: savedThresholds.hateSpeech || defaultThreshold }, 
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: savedThresholds.sexuallyExplicit || defaultThreshold }, 
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: savedThresholds.dangerousContent || defaultThreshold } 
        ];
        const requestBody = JSON.stringify({ 
            contents, 
            generationConfig: { maxOutputTokens: 8192, temperature: 0.8, topP: 0.95 }, 
            safetySettings
        });
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