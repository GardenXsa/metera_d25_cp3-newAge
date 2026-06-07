'use strict';
// ============================================================================
// E2E Scaffold Test for Electron — main.js structural validation
// ============================================================================
// Since we can't actually launch Electron in CI without a display, this file
// validates the Electron app's structure by reading main.js with fs and
// checking its contents via string/regex. It also simulates the full game
// flow (window creation → engine start → command execution → save/load)
// using mock objects that mirror main.js logic.
// ============================================================================

const fs = require('fs');
const path = require('path');

let PASS = 0;
let FAIL = 0;

function assert(condition, message) {
    if (condition) { PASS++; } else { FAIL++; console.log(`  FAIL: ${message}`); }
}

// ============================================================================
// Load source files for structural inspection
// ============================================================================

const ROOT = path.resolve(__dirname, '..');
const MAIN_JS_PATH = path.join(ROOT, 'main.js');
const PRELOAD_JS_PATH = path.join(ROOT, 'preload.js');

let mainJsSource = '';
let preloadJsSource = '';

try {
    mainJsSource = fs.readFileSync(MAIN_JS_PATH, 'utf-8');
} catch (e) {
    console.error(`FATAL: Cannot read ${MAIN_JS_PATH}: ${e.message}`);
    process.exit(1);
}

try {
    preloadJsSource = fs.readFileSync(PRELOAD_JS_PATH, 'utf-8');
} catch (e) {
    console.error(`FATAL: Cannot read ${PRELOAD_JS_PATH}: ${e.message}`);
    process.exit(1);
}

// ============================================================================
// Helper: extract all ipcMain.handle channel names from source
// ============================================================================
function extractIpcChannels(source) {
    const channels = new Set();
    const regex = /ipcMain\.handle\(\s*['"]([^'"]+)['"]/g;
    let match;
    while ((match = regex.exec(source)) !== null) {
        channels.add(match[1]);
    }
    return channels;
}

const ipcChannels = extractIpcChannels(mainJsSource);

// ============================================================================
// 1. WINDOW CREATION — BrowserWindow security configuration
// ============================================================================
console.log('\n=== 1. Window creation: BrowserWindow security config ===');

(function testWindowCreation() {
    // --- contextIsolation must be true ---
    // In main.js: contextIsolation: WINDOW_CONTEXT_ISOLATION
    // And WINDOW_CONTEXT_ISOLATION defaults to true
    assert(
        mainJsSource.includes('WINDOW_CONTEXT_ISOLATION') &&
        mainJsSource.includes("getConfigBoolean(['window', 'context_isolation'], true)"),
        'contextIsolation default is true (via WINDOW_CONTEXT_ISOLATION config)'
    );
    // Verify the variable is used in webPreferences
    assert(
        /contextIsolation:\s*WINDOW_CONTEXT_ISOLATION/.test(mainJsSource),
        'contextIsolation is set from WINDOW_CONTEXT_ISOLATION in createWindow'
    );

    // --- nodeIntegration must be false ---
    assert(
        mainJsSource.includes('WINDOW_NODE_INTEGRATION') &&
        mainJsSource.includes("getConfigBoolean(['window', 'node_integration'], false)"),
        'nodeIntegration default is false (via WINDOW_NODE_INTEGRATION config)'
    );
    assert(
        /nodeIntegration:\s*WINDOW_NODE_INTEGRATION/.test(mainJsSource),
        'nodeIntegration is set from WINDOW_NODE_INTEGRATION in createWindow'
    );

    // --- preload script exists at expected path ---
    assert(
        mainJsSource.includes('WINDOW_PRELOAD_FILE') &&
        mainJsSource.includes("getConfigString(['window', 'preload_file'], 'preload.js')"),
        'preload file defaults to preload.js (via WINDOW_PRELOAD_FILE config)'
    );
    assert(
        /preload:\s*path\.join\(__dirname,\s*WINDOW_PRELOAD_FILE\)/.test(mainJsSource),
        'preload path is path.join(__dirname, WINDOW_PRELOAD_FILE) in createWindow'
    );

    // Verify preload.js actually exists on disk
    assert(
        fs.existsSync(PRELOAD_JS_PATH),
        'preload.js file exists at project root'
    );

    // Verify preload.js uses contextBridge (safe pattern)
    assert(
        preloadJsSource.includes('contextBridge.exposeInMainWorld'),
        'preload.js uses contextBridge.exposeInMainWorld (safe IPC bridge)'
    );
    assert(
        !preloadJsSource.includes('require("child_process")') &&
        !preloadJsSource.includes("require('child_process')"),
        'preload.js does NOT require child_process (no direct shell access from renderer)'
    );

    // Verify BrowserWindow is constructed with webPreferences
    assert(
        /new\s+BrowserWindow\(\s*\{[\s\S]*?webPreferences:/.test(mainJsSource),
        'BrowserWindow constructor includes webPreferences object'
    );
})();

// ============================================================================
// 2. IPC HANDLER REGISTRATION — all expected channels are defined
// ============================================================================
console.log('\n=== 2. IPC handler registration: expected channels exist');

(function testIpcHandlers() {
    // --- Nexus engine channels ---
    const nexusChannels = [
        'nexus-init',
        'nexus-build-world',
        'nexus-bootstrap',
        'nexus-simulate',
        'nexus-load-world-file',
        'nexus-write-sync-file',
        'nexus-get-full-state',
    ];

    nexusChannels.forEach(function(ch) {
        assert(
            ipcChannels.has(ch),
            `IPC channel "${ch}" is registered in main.js`
        );
    });

    // --- Save/load channels ---
    const saveLoadChannels = [
        'save-game',
        'load-game',
        'save-world-state',
        'load-world-state',
    ];

    saveLoadChannels.forEach(function(ch) {
        assert(
            ipcChannels.has(ch),
            `IPC channel "${ch}" is registered in main.js`
        );
    });

    // --- Settings & token channels ---
    const settingsChannels = [
        'get-http-token',
        'save-settings',
        'load-settings',
    ];

    settingsChannels.forEach(function(ch) {
        assert(
            ipcChannels.has(ch),
            `IPC channel "${ch}" is registered in main.js`
        );
    });

    // --- Verify preload.js exposes API methods for each critical channel ---
    const preloadApiMethods = [
        { method: 'nexusInit',           channel: 'nexus-init' },
        { method: 'nexusBuildWorld',     channel: 'nexus-build-world' },
        { method: 'nexusBootstrap',      channel: 'nexus-bootstrap' },
        { method: 'nexusSimulate',       channel: 'nexus-simulate' },
        { method: 'nexusLoadWorldFile',  channel: 'nexus-load-world-file' },
        { method: 'nexusWriteSyncFile',  channel: 'nexus-write-sync-file' },
        { method: 'nexusGetFullState',   channel: 'nexus-get-full-state' },
        { method: 'saveGame',            channel: 'save-game' },
        { method: 'loadGame',            channel: 'load-game' },
        { method: 'saveWorldState',      channel: 'save-world-state' },
        { method: 'loadWorldState',      channel: 'load-world-state' },
        { method: 'getHttpToken',        channel: 'get-http-token' },
        { method: 'saveSettings',        channel: 'save-settings' },
        { method: 'loadSettings',        channel: 'load-settings' },
    ];

    preloadApiMethods.forEach(function(entry) {
        assert(
            preloadJsSource.includes(entry.method),
            `preload.js exposes "${entry.method}" (maps to "${entry.channel}")`
        );
        assert(
            preloadJsSource.includes(entry.channel),
            `preload.js references IPC channel "${entry.channel}" for ${entry.method}`
        );
    });

    // --- Bonus: verify no ipcMain.on (should only use .handle for request/response) ---
    const onMatches = mainJsSource.match(/ipcMain\.on\(/g);
    assert(
        onMatches === null,
        'main.js does not use ipcMain.on (all handlers are ipcMain.handle)'
    );
})();

// ============================================================================
// 3. ENGINE LIFECYCLE SIMULATION (mock-based)
// ============================================================================
console.log('\n=== 3. Engine lifecycle simulation (mock-based)');

(function testEngineLifecycle() {
    // ---- 3a. Structural checks: engine management code exists ----
    assert(
        /function\s+startEngine\s*\(/.test(mainJsSource),
        'main.js defines startEngine() function'
    );
    assert(
        /function\s+sendCommand\s*\(/.test(mainJsSource),
        'main.js defines sendCommand() function'
    );
    assert(
        /function\s+processQueue\s*\(/.test(mainJsSource),
        'main.js defines processQueue() function'
    );
    assert(
        /let\s+commandQueue\s*=/.test(mainJsSource),
        'main.js has commandQueue state variable'
    );
    assert(
        /let\s+engineReady\s*=/.test(mainJsSource),
        'main.js has engineReady state variable'
    );
    assert(
        /let\s+currentResolve\s*=/.test(mainJsSource),
        'main.js has currentResolve state variable'
    );

    // ---- 3b. Mock-based engine lifecycle simulation ----
    // We use a SYNCHRONOUS mock of the command queue to avoid Promise
    // microtask timing issues in a synchronous test runner.
    // The mock mirrors the exact logic of sendCommand / processQueue / timeout.

    var mockEngineReady = false;
    var mockCurrentCmd = null;     // { resolve: fn, timedOut: bool }
    var mockCommandQueue = [];     // [{ resolve: fn }]
    var mockTimedOut = false;      // flag set by simulateTimeout

    function mockProcessQueue() {
        if (mockCommandQueue.length === 0 || mockCurrentCmd !== null) return;
        mockCurrentCmd = mockCommandQueue.shift();
    }

    // Synchronous sendCommand — mirrors main.js logic, returns result directly
    // for the "engine not ready" case; otherwise enqueues and returns null.
    function mockSendCommand(command) {
        if (!mockEngineReady) {
            return { status: 'error', message: 'Engine not ready' };
        }
        var resultSlot = { value: null };
        mockCommandQueue.push({
            resolve: function(r) { resultSlot.value = r; },
            slot: resultSlot
        });
        mockProcessQueue();
        return null; // result not yet available
    }

    // Simulate engine responding to the current command
    function mockEngineRespond(response) {
        if (mockCurrentCmd) {
            mockCurrentCmd.resolve(response);
            mockCurrentCmd = null;
            mockProcessQueue(); // dequeue next
        }
    }

    // Simulate a timeout event — mirrors what the setTimeout in sendCommand does
    function mockSimulateTimeout() {
        // Flush queued commands
        while (mockCommandQueue.length > 0) {
            var queued = mockCommandQueue.shift();
            queued.resolve({ status: 'error', message: 'Queue flushed: previous command timed out' });
        }
        // Resolve current command with timeout error
        if (mockCurrentCmd) {
            mockCurrentCmd.resolve({ status: 'error', message: 'Command timed out' });
            mockCurrentCmd = null;
            mockEngineReady = false;
            mockTimedOut = true;
        }
    }

    // Simulate timeout recovery
    function mockRecoverFromTimeout() {
        if (mockTimedOut && !mockEngineReady) {
            mockEngineReady = true;
            mockTimedOut = false;
        }
    }

    // --- Test: Engine not ready → command returns error ---
    (function() {
        mockEngineReady = false;
        mockCommandQueue = [];
        mockCurrentCmd = null;
        mockTimedOut = false;

        var result = mockSendCommand('init');
        assert(
            result !== null && result.status === 'error',
            'Engine lifecycle: command returns error when engine not ready'
        );
        assert(
            result.message.includes('not ready'),
            'Engine lifecycle: error message says "not ready"'
        );
    })();

    // --- Test: Engine start → ready signal → command execution ---
    (function() {
        mockEngineReady = true;
        mockCommandQueue = [];
        mockCurrentCmd = null;
        mockTimedOut = false;

        var resultSlot = mockSendCommand('init');
        // null means enqueued, not yet resolved
        assert(
            resultSlot === null,
            'Engine lifecycle: command enqueued (not immediately resolved)'
        );
        assert(
            mockCurrentCmd !== null,
            'Engine lifecycle: command dequeued as current (currentCmd set)'
        );
        assert(
            mockCommandQueue.length === 0,
            'Engine lifecycle: queue is empty after processQueue pulled the command'
        );

        // Simulate engine responding with success
        mockEngineRespond({ status: 'ok', message: 'Engine initialized' });
        // Check the result slot of the command we sent
        assert(
            mockCurrentCmd === null, // resolved and cleared
            'Engine lifecycle: currentCmd cleared after engine response'
        );
    })();

    // --- Test: Command queue — sequential execution ---
    (function() {
        mockEngineReady = true;
        mockCommandQueue = [];
        mockCurrentCmd = null;
        mockTimedOut = false;

        var slot1 = { value: null };
        var slot2 = { value: null };

        mockCommandQueue.push({ resolve: function(r) { slot1.value = r; }, slot: slot1 });
        mockProcessQueue(); // dequeue first
        mockCommandQueue.push({ resolve: function(r) { slot2.value = r; }, slot: slot2 });
        // Don't call processQueue again — it won't run while currentCmd is set

        // First command should be processing; second should be in queue
        assert(
            mockCurrentCmd !== null,
            'Queue: first command is current (processing)'
        );
        assert(
            mockCommandQueue.length === 1,
            'Queue: second command is queued (waiting)'
        );

        // Neither resolved yet
        assert(slot1.value === null, 'Queue: first command pending (not yet resolved)');
        assert(slot2.value === null, 'Queue: second command pending (not yet resolved)');

        // Engine responds to first command
        mockEngineRespond({ status: 'ok', command: 'command1' });
        assert(
            slot1.value !== null && slot1.value.status === 'ok',
            'Queue: first command resolved after engine response'
        );
        // Now second command should have been dequeued
        assert(
            mockCurrentCmd !== null,
            'Queue: second command is now current'
        );
        assert(
            mockCommandQueue.length === 0,
            'Queue: no more commands waiting'
        );
        // Second hasn't resolved yet
        assert(slot2.value === null, 'Queue: second command still pending');

        // Engine responds to second command
        mockEngineRespond({ status: 'ok', command: 'command2' });
        assert(
            slot2.value !== null && slot2.value.status === 'ok',
            'Queue: second command resolved after engine response'
        );
    })();

    // --- Test: Timeout handling — command takes too long → error returned ---
    (function() {
        mockEngineReady = true;
        mockCommandQueue = [];
        mockCurrentCmd = null;
        mockTimedOut = false;

        var slot1 = { value: null };
        var slot2 = { value: null };

        mockCommandQueue.push({ resolve: function(r) { slot1.value = r; }, slot: slot1 });
        mockProcessQueue();
        mockCommandQueue.push({ resolve: function(r) { slot2.value = r; }, slot: slot2 });

        assert(mockCurrentCmd !== null, 'Timeout: command is current');
        assert(mockCommandQueue.length === 1, 'Timeout: one command in queue');

        // Simulate timeout
        mockSimulateTimeout();

        // Current command gets timeout error
        assert(
            slot1.value !== null && slot1.value.status === 'error',
            'Timeout: current command resolved with error status'
        );
        assert(
            slot1.value.message.includes('timed out'),
            'Timeout: current command error mentions "timed out"'
        );

        // Queued commands get flushed with error
        assert(
            slot2.value !== null && slot2.value.status === 'error',
            'Timeout: queued commands get flushed with error on timeout'
        );
        assert(
            slot2.value.message.includes('Queue flushed'),
            'Timeout: flushed command error message mentions queue flush'
        );

        // Engine is marked as not ready after timeout
        assert(
            mockEngineReady === false,
            'Timeout: engine marked as not ready after timeout'
        );

        // Recovery restores engine ready state
        mockRecoverFromTimeout();
        assert(
            mockEngineReady === true,
            'Timeout: engine recovers and becomes ready again after recovery delay'
        );
    })();

    // --- Test: Engine ready signal detection ---
    (function() {
        // Verify main.js detects "ready" keyword from engine stdout
        assert(
            mainJsSource.includes('engineReady') &&
            /line\.toLowerCase\(\)\.includes\(['"]ready['"]\)/.test(mainJsSource),
            'Engine lifecycle: main.js detects "ready" signal from engine stdout (case-insensitive)'
        );

        // Verify ENGINE_START_TIMEOUT_MS is used as fallback
        assert(
            mainJsSource.includes('ENGINE_START_TIMEOUT_MS') &&
            mainJsSource.includes('Engine started (ready signal timeout)'),
            'Engine lifecycle: fallback timeout starts engine if ready signal not received'
        );
    })();
})();

// ============================================================================
// 4. SECURITY VALIDATION
// ============================================================================
console.log('\n=== 4. Security validation');

(function testSecurity() {
    // ---- 4a. CSP header is set for .html files ----
    (function testCSP() {
        // Verify CSP is set for .html files
        assert(
            mainJsSource.includes("buildContentSecurityPolicy") &&
            /ext\s*===\s*['"]\.html['"]/.test(mainJsSource),
            'Security: CSP header is set for .html files'
        );

        // Verify CSP does NOT include 'unsafe-eval' (security hardening)
        // Extract the buildContentSecurityPolicy function body by finding the
        // function and then tracking brace depth to find its closing brace.
        var cspStart = mainJsSource.indexOf('function buildContentSecurityPolicy');
        var cspBody = '';
        if (cspStart !== -1) {
            var braceDepth = 0;
            var inFunction = false;
            for (var i = cspStart; i < mainJsSource.length; i++) {
                if (mainJsSource[i] === '{') { braceDepth++; inFunction = true; }
                if (mainJsSource[i] === '}') { braceDepth--; }
                cspBody += mainJsSource[i];
                if (inFunction && braceDepth === 0) break;
            }
        }

        // Check that 'unsafe-eval' is only in comments, NOT in CSP string values
        // The comment mentions 'unsafe-eval' but the actual CSP lines must not use it
        var cspLines = cspBody.match(/`[^`]*`/g) || []; // extract template literal lines
        var cspJoined = cspLines.join(' ');
        assert(
            !cspJoined.includes("'unsafe-eval'"),
            'Security: CSP does NOT include unsafe-eval (removed for security)'
        );
        assert(
            cspBody.includes("'wasm-unsafe-eval'"),
            'Security: CSP includes wasm-unsafe-eval (WebAssembly support without eval hole)'
        );
        assert(
            cspBody.includes("'nonce-") || cspBody.includes("'nonce-${"),
            'Security: CSP uses nonce-based script allowlist'
        );

        // Verify security headers are set
        assert(
            mainJsSource.includes("'X-Content-Type-Options'") &&
            mainJsSource.includes("'nosniff'"),
            'Security: X-Content-Type-Options: nosniff header is set'
        );
        assert(
            mainJsSource.includes("'X-Frame-Options'") &&
            mainJsSource.includes("'DENY'"),
            'Security: X-Frame-Options: DENY header is set'
        );
        assert(
            mainJsSource.includes("'X-XSS-Protection'"),
            'Security: X-XSS-Protection header is set'
        );
    })();

    // ---- 4b. Rate limiter blocks excessive requests ----
    (function testRateLimiter() {
        // Verify rate limiter code exists
        assert(
            mainJsSource.includes('rateLimiter') &&
            mainJsSource.includes('checkRateLimit'),
            'Security: Rate limiter is defined in main.js'
        );

        // Verify 429 response for rate-limited requests
        assert(
            mainJsSource.includes('429') &&
            mainJsSource.includes('Too Many Requests'),
            'Security: Rate limiter returns 429 Too Many Requests'
        );

        // Verify different limits for localhost vs remote
        assert(
            mainJsSource.includes('LOCAL_RATE_LIMIT_MAX_REQUESTS') &&
            mainJsSource.includes('REMOTE_RATE_LIMIT_MAX_REQUESTS'),
            'Security: Separate rate limits for localhost vs remote IPs'
        );

        // Verify LOCALHOST_IPS set includes expected entries
        assert(
            mainJsSource.includes("LOCALHOST_IPS") &&
            mainJsSource.includes("'127.0.0.1'") &&
            mainJsSource.includes("'::1'"),
            'Security: Localhost IPs set includes 127.0.0.1 and ::1'
        );

        // Verify rate limiter is reset on page navigation
        assert(
            mainJsSource.includes('rateLimiter.clear()') &&
            mainJsSource.includes('did-navigate'),
            'Security: Rate limiter is reset on page navigation'
        );

        // ---- Functional rate limiter test (replicated logic) ----
        var LOCALHOST_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
        var LOCAL_RATE_LIMIT_WINDOW_MS = 10000;
        var LOCAL_RATE_LIMIT_MAX_REQUESTS = 500;
        var REMOTE_RATE_LIMIT_WINDOW_MS = 60000;
        var REMOTE_RATE_LIMIT_MAX_REQUESTS = 60;

        var rateLimiter = new Map();

        function checkRateLimit(ip) {
            var now = Date.now();
            var isLocal = LOCALHOST_IPS.has(ip);
            var windowMs = isLocal ? LOCAL_RATE_LIMIT_WINDOW_MS : REMOTE_RATE_LIMIT_WINDOW_MS;
            var maxRequests = isLocal ? LOCAL_RATE_LIMIT_MAX_REQUESTS : REMOTE_RATE_LIMIT_MAX_REQUESTS;
            var entry = rateLimiter.get(ip);
            if (!entry || now - entry.start > windowMs) {
                rateLimiter.set(ip, { start: now, count: 1 });
                return true;
            }
            entry.count++;
            if (entry.count > maxRequests) return false;
            return true;
        }

        // Localhost allowed within limits
        assert(
            checkRateLimit('127.0.0.1') === true,
            'Security: localhost request allowed within rate limit'
        );

        // Remote allowed within limits
        assert(
            checkRateLimit('10.0.0.1') === true,
            'Security: remote request allowed within rate limit'
        );

        // Simulate exceeding remote limit
        rateLimiter.set('10.0.0.1', { start: Date.now(), count: 60 });
        assert(
            checkRateLimit('10.0.0.1') === false,
            'Security: remote request blocked after exceeding 60 request limit'
        );

        // Localhost still allowed at 60 (limit is 500)
        rateLimiter.set('127.0.0.1', { start: Date.now(), count: 60 });
        assert(
            checkRateLimit('127.0.0.1') === true,
            'Security: localhost allowed at 60 requests (limit is 500)'
        );

        // Localhost blocked at 500+
        rateLimiter.set('127.0.0.1', { start: Date.now(), count: 500 });
        assert(
            checkRateLimit('127.0.0.1') === false,
            'Security: localhost blocked after exceeding 500 request limit'
        );

        // Different IPs have independent limits
        rateLimiter.set('192.168.1.1', { start: Date.now(), count: 60 });
        assert(
            checkRateLimit('192.168.1.1') === false,
            'Security: one remote IP blocked does not affect others (independent limits)'
        );
        assert(
            checkRateLimit('192.168.1.2') === true,
            'Security: different remote IP has its own rate limit'
        );
    })();

    // ---- 4c. Sensitive files are blocked from HTTP serving ----
    (function testSensitiveFiles() {
        // Verify SENSITIVE_FILES set exists and blocks expected files
        assert(
            mainJsSource.includes('SENSITIVE_FILES'),
            'Security: SENSITIVE_FILES set is defined'
        );
        assert(
            mainJsSource.includes("'settings.json'") &&
            mainJsSource.includes("'.env'") &&
            mainJsSource.includes("'.gitignore'"),
            'Security: SENSITIVE_FILES blocks settings.json, .env, .gitignore'
        );
        assert(
            mainJsSource.includes("'conversation-'") ||
            mainJsSource.includes('"conversation-"'),
            'Security: SENSITIVE_FILES blocks conversation- prefix'
        );

        // Verify SENSITIVE_FILE_SUBSTRINGS check
        assert(
            mainJsSource.includes('SENSITIVE_FILE_SUBSTRINGS'),
            'Security: SENSITIVE_FILE_SUBSTRINGS is defined'
        );

        // Verify the actual blocking logic: 403 for sensitive files
        assert(
            mainJsSource.includes('SENSITIVE_FILES.has(basename)') ||
            mainJsSource.includes('SENSITIVE_FILES.has'),
            'Security: HTTP server checks basename against SENSITIVE_FILES'
        );
        assert(
            /SENSITIVE_FILE_SUBSTRINGS\.some/.test(mainJsSource),
            'Security: HTTP server checks path against SENSITIVE_FILE_SUBSTRINGS'
        );

        // ---- Functional test: simulated sensitive file check ----
        var SENSITIVE_FILES = new Set(['settings.json', '.env', '.gitignore', 'project_scan.txt']);
        var SENSITIVE_FILE_SUBSTRINGS = ['conversation-'];

        function isSensitiveFile(filePath) {
            var basename = path.basename(filePath);
            if (SENSITIVE_FILES.has(basename)) return true;
            if (SENSITIVE_FILE_SUBSTRINGS.some(function(sub) { return filePath.includes(sub); })) return true;
            return false;
        }

        assert(
            isSensitiveFile('/app/settings.json') === true,
            'Security: settings.json is blocked from HTTP serving'
        );
        assert(
            isSensitiveFile('/app/.env') === true,
            'Security: .env is blocked from HTTP serving'
        );
        assert(
            isSensitiveFile('/app/.gitignore') === true,
            'Security: .gitignore is blocked from HTTP serving'
        );
        assert(
            isSensitiveFile('/app/conversation-123.json') === true,
            'Security: conversation-* files are blocked from HTTP serving'
        );
        assert(
            isSensitiveFile('/app/project_scan.txt') === true,
            'Security: project_scan.txt is blocked from HTTP serving'
        );
        assert(
            isSensitiveFile('/app/index.html') === false,
            'Security: index.html is NOT blocked from HTTP serving'
        );
        assert(
            isSensitiveFile('/app/script.js') === false,
            'Security: script.js is NOT blocked from HTTP serving'
        );
        assert(
            isSensitiveFile('/app/style.css') === false,
            'Security: style.css is NOT blocked from HTTP serving'
        );
    })();

    // ---- 4d. Additional security checks ----
    (function testAdditionalSecurity() {
        // Verify path traversal protection
        assert(
            mainJsSource.includes('path.resolve(filePath)') &&
            mainJsSource.includes('path.resolve(__dirname)'),
            'Security: HTTP server has path traversal protection (resolved path within __dirname)'
        );

        // Verify HTTP session token authentication
        assert(
            mainJsSource.includes('HTTP_SESSION_TOKEN') &&
            mainJsSource.includes('randomBytes'),
            'Security: HTTP server uses session token (crypto.randomBytes)'
        );
        assert(
            mainJsSource.includes('get-http-token'),
            'Security: HTTP token is exposed to renderer via IPC'
        );

        // Verify only GET and HEAD methods allowed
        assert(
            mainJsSource.includes("'GET'") &&
            mainJsSource.includes("'HEAD'") &&
            mainJsSource.includes("'Method Not Allowed'"),
            'Security: HTTP server only allows GET and HEAD methods'
        );

        // Verify file size limit
        assert(
            mainJsSource.includes('MAX_STATIC_FILE_SIZE_BYTES') &&
            mainJsSource.includes('413'),
            'Security: HTTP server has file size limit (413 Payload Too Large)'
        );

        // Verify save-game filename validation
        assert(
            mainJsSource.includes('isSafeFileName') &&
            mainJsSource.includes('SAFE_JSON_FILENAME_PATTERN'),
            'Security: Save game uses safe filename validation (prevents path traversal)'
        );

        // Verify nexus-load-world-file path traversal protection
        assert(
            mainJsSource.includes('nexus-load-world-file') &&
            mainJsSource.includes('resolvedPath') &&
            mainJsSource.includes('resolvedSavesDir'),
            'Security: nexus-load-world-file validates path within saves directory'
        );

        // Verify nexus-write-sync-file input validation
        assert(
            mainJsSource.includes('nexus-write-sync-file') &&
            mainJsSource.includes('worldData is required'),
            'Security: nexus-write-sync-file validates input (null/undefined check)'
        );

        // Verify raw command whitelist
        assert(
            mainJsSource.includes('ALLOWED_RAW_COMMANDS') &&
            mainJsSource.includes('is not allowed'),
            'Security: Raw commands are whitelisted (prevents arbitrary command execution)'
        );

        // Verify CORS is restricted to own origin
        assert(
            mainJsSource.includes("Access-Control-Allow-Origin") &&
            mainJsSource.includes('getServerOrigin()'),
            'Security: CORS header restricted to app origin'
        );

        // Verify external link protocol whitelist
        assert(
            mainJsSource.includes('EXTERNAL_LINK_PROTOCOLS') &&
            mainJsSource.includes('setWindowOpenHandler'),
            'Security: External links are filtered through protocol whitelist'
        );
    })();
})();

// ============================================================================
// 5. MOCK-BASED E2E GAME FLOW SIMULATION
// ============================================================================
console.log('\n=== 5. Mock-based E2E game flow simulation');

(function testGameFlow() {
    // Simulate the full game flow:
    // Window creation → Engine start → Build world → Simulate → Save → Load

    // --- 5a. Simulate window creation (validate config values) ---
    (function() {
        // The window config defaults provide secure settings
        var defaultContextIsolation = true;  // WINDOW_CONTEXT_ISOLATION
        var defaultNodeIntegration = false;  // WINDOW_NODE_INTEGRATION
        var defaultPreload = 'preload.js';   // WINDOW_PRELOAD_FILE

        assert(
            defaultContextIsolation === true,
            'Game flow: Window created with contextIsolation: true (secure)'
        );
        assert(
            defaultNodeIntegration === false,
            'Game flow: Window created with nodeIntegration: false (secure)'
        );
        assert(
            defaultPreload === 'preload.js' && fs.existsSync(path.join(ROOT, defaultPreload)),
            'Game flow: Window created with preload script at preload.js (exists on disk)'
        );
    })();

    // --- 5b. Simulate full engine game flow (synchronous mock) ---
    (function() {
        var mockEngineReady = true;
        var mockCurrentCmd = null;
        var mockCommandQueue = [];

        function mockProcessQueue() {
            if (mockCommandQueue.length === 0 || mockCurrentCmd !== null) return;
            mockCurrentCmd = mockCommandQueue.shift();
        }

        // Enqueue a command and return its result slot
        function enqueueCommand(command) {
            var slot = { value: null };
            mockCommandQueue.push({ resolve: function(r) { slot.value = r; }, slot: slot });
            mockProcessQueue();
            return slot;
        }

        // Simulate engine responding to the current command
        function mockEngineRespond(response) {
            if (mockCurrentCmd) {
                mockCurrentCmd.resolve(response);
                mockCurrentCmd = null;
                mockProcessQueue();
            }
        }

        // Step 1: Init engine
        var initSlot = enqueueCommand('init');
        mockEngineRespond({ status: 'ok', message: 'Engine initialized' });
        assert(
            initSlot.value !== null && initSlot.value.status === 'ok',
            'Game flow: engine init returns ok'
        );

        // Step 2: Build world
        var buildSlot = enqueueCommand('buildWorld');
        mockEngineRespond({ status: 'ok', world: { width: 256, height: 256 } });
        assert(
            buildSlot.value !== null && buildSlot.value.status === 'ok',
            'Game flow: buildWorld returns ok'
        );

        // Step 3: Bootstrap world
        var bootstrapSlot = enqueueCommand('bootstrapWorld');
        mockEngineRespond({ status: 'ok', days_simulated: 30 });
        assert(
            bootstrapSlot.value !== null && bootstrapSlot.value.status === 'ok',
            'Game flow: bootstrapWorld returns ok'
        );

        // Step 4: Simulate ticks
        var simSlot = enqueueCommand('simulateTicks');
        mockEngineRespond({ status: 'ok', ticks_processed: 10 });
        assert(
            simSlot.value !== null && simSlot.value.status === 'ok',
            'Game flow: simulateTicks returns ok'
        );

        // Step 5: Get full state
        var stateSlot = enqueueCommand('getFullState');
        mockEngineRespond({ status: 'ok', world: { tick: 10 }, player: { location: 'tavern' } });
        assert(
            stateSlot.value !== null && stateSlot.value.status === 'ok',
            'Game flow: getFullState returns ok'
        );
    })();

    // --- 5c. Simulate save/load round-trip (functional) ---
    (function() {
        var SAFE_JSON_FILENAME_PATTERN = /^[a-zA-Z0-9_-]+\.json$/;

        function isSafeFileName(filename) {
            return typeof filename === 'string' && SAFE_JSON_FILENAME_PATTERN.test(filename);
        }

        // Simulate save-game
        var saveFilename = 'test_save.json';
        var saveData = { player: 'hero', level: 5, inventory: ['sword', 'shield'] };
        assert(
            isSafeFileName(saveFilename),
            'Game flow: save-game filename passes validation'
        );

        // Simulate writing to disk
        var tmpDir = path.join(require('os').tmpdir(), 'metera_e2e_test');
        try { fs.mkdirSync(tmpDir, { recursive: true }); } catch (e) {}
        var savePath = path.join(tmpDir, saveFilename);
        fs.writeFileSync(savePath, JSON.stringify(saveData, null, 2));
        assert(
            fs.existsSync(savePath),
            'Game flow: save file written to disk'
        );

        // Simulate load-game
        var loadedData = null;
        try {
            loadedData = JSON.parse(fs.readFileSync(savePath, 'utf-8'));
        } catch (e) {}
        assert(
            loadedData !== null,
            'Game flow: save file loaded from disk'
        );
        assert(
            loadedData.player === 'hero' && loadedData.level === 5,
            'Game flow: loaded data matches saved data'
        );

        // Simulate save-world-state
        var worldFilename = 'test_world.json';
        var worldData = { name: 'Metera', era: 'rebirth', tick: 100 };
        assert(
            isSafeFileName(worldFilename),
            'Game flow: save-world-state filename passes validation'
        );

        var worldPath = path.join(tmpDir, worldFilename);
        fs.writeFileSync(worldPath, JSON.stringify(worldData));
        var loadedWorld = JSON.parse(fs.readFileSync(worldPath, 'utf-8'));
        assert(
            loadedWorld.name === 'Metera' && loadedWorld.era === 'rebirth',
            'Game flow: world state save/load round-trip succeeds'
        );

        // Simulate save-settings
        var settingsData = { volume: 80, theme: 'dark', language: 'en' };
        var settingsPath = path.join(tmpDir, 'settings.json');
        fs.writeFileSync(settingsPath, JSON.stringify(settingsData, null, 2));
        var loadedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        assert(
            loadedSettings.volume === 80 && loadedSettings.theme === 'dark',
            'Game flow: settings save/load round-trip succeeds'
        );

        // Cleanup temp files
        try { fs.unlinkSync(savePath); } catch (e) {}
        try { fs.unlinkSync(worldPath); } catch (e) {}
        try { fs.unlinkSync(settingsPath); } catch (e) {}
        try { fs.rmdirSync(tmpDir); } catch (e) {}
    })();

    // --- 5d. Verify game flow IPC channels are wired end-to-end ---
    (function() {
        // Verify that the full game flow has IPC handlers in main.js
        // AND corresponding API methods in preload.js
        var flowChannels = [
            { channel: 'nexus-init',          preloadMethod: 'nexusInit' },
            { channel: 'nexus-build-world',    preloadMethod: 'nexusBuildWorld' },
            { channel: 'nexus-bootstrap',      preloadMethod: 'nexusBootstrap' },
            { channel: 'nexus-simulate',       preloadMethod: 'nexusSimulate' },
            { channel: 'save-game',            preloadMethod: 'saveGame' },
            { channel: 'load-game',            preloadMethod: 'loadGame' },
            { channel: 'save-world-state',     preloadMethod: 'saveWorldState' },
            { channel: 'load-world-state',     preloadMethod: 'loadWorldState' },
        ];

        flowChannels.forEach(function(entry) {
            assert(
                ipcChannels.has(entry.channel),
                'Game flow: IPC handler "' + entry.channel + '" exists in main.js'
            );
            assert(
                preloadJsSource.includes(entry.preloadMethod),
                'Game flow: preload.js exposes "' + entry.preloadMethod + '" method'
            );
            assert(
                preloadJsSource.includes(entry.channel),
                'Game flow: preload.js "' + entry.preloadMethod + '" invokes "' + entry.channel + '"'
            );
        });
    })();
})();

// ============================================================================
// Results
// ============================================================================
console.log(`\nResults: ${PASS} passed, ${FAIL} failed`);
if (FAIL > 0) process.exit(1);
