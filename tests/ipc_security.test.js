'use strict';
// ============================================================================
// IPC Security Tests for main.js
// ============================================================================
// Since this runs outside Electron (no IPC), we replicate the validation
// logic from main.js and test it directly. If the logic in main.js changes,
// the replicated validators here must be updated to match.
// ============================================================================

const path = require('path');

let PASS = 0;
let FAIL = 0;

function assert(condition, message) {
    if (condition) { PASS++; } else { FAIL++; console.log(`  FAIL: ${message}`); }
}

// ============================================================================
// Replicated validation logic from main.js
// ============================================================================

const SAVES_DIR = path.resolve('/tmp/metera_test_saves');

// --- nexus-write-sync-file validation ---
function validateNexusWriteSyncFile(worldData) {
    if (worldData === null || worldData === undefined) {
        return { status: 'error', message: 'Invalid input: worldData is required' };
    }
    if (typeof worldData !== 'object' || Array.isArray(worldData)) {
        return { status: 'error', message: 'Invalid input: worldData must be a plain object' };
    }
    const serialized = JSON.stringify(worldData);
    const MAX_SYNC_FILE_SIZE = 64 * 1024 * 1024; // 64MB
    if (serialized.length > MAX_SYNC_FILE_SIZE) {
        return { status: 'error', message: `Data too large: ${serialized.length} bytes exceeds ${MAX_SYNC_FILE_SIZE} limit` };
    }
    return { status: 'ok' };
}

// --- nexus-load-world-file validation ---
function validateNexusLoadWorldFile(filePath) {
    if (typeof filePath !== 'string' || filePath.length === 0) {
        return { status: 'error', message: 'Invalid file path: must be a non-empty string' };
    }
    const resolvedPath = path.resolve(filePath);
    const resolvedSavesDir = path.resolve(SAVES_DIR);
    if (!resolvedPath.toLowerCase().startsWith(resolvedSavesDir.toLowerCase())) {
        return { status: 'error', message: 'Invalid file path: must be within saves directory' };
    }
    if (!resolvedPath.endsWith('.json')) {
        return { status: 'error', message: 'Invalid file path: only .json files are allowed' };
    }
    return { status: 'ok' };
}

// --- save-settings validation ---
function validateSaveSettings(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return false;
    }
    const serialized = JSON.stringify(data, null, 2);
    const MAX_SETTINGS_SIZE = 512 * 1024; // 512KB
    if (serialized.length > MAX_SETTINGS_SIZE) {
        return false;
    }
    return true;
}

// --- save-game filename validation ---
const SAFE_JSON_FILENAME_PATTERN = /^[a-zA-Z0-9_-]+\.json$/;

function isSafeFileName(filename) {
    return typeof filename === 'string' && SAFE_JSON_FILENAME_PATTERN.test(filename);
}

function validateSaveGame(filename) {
    if (!isSafeFileName(filename)) return { success: false };
    return { success: true };
}

// --- Rate limiter ---
const LOCALHOST_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOCAL_RATE_LIMIT_WINDOW_MS = 10000;
const LOCAL_RATE_LIMIT_MAX_REQUESTS = 500;
const REMOTE_RATE_LIMIT_WINDOW_MS = 60000;
const REMOTE_RATE_LIMIT_MAX_REQUESTS = 60;

function createRateLimiter() {
    const rateLimiter = new Map();

    function checkRateLimit(ip) {
        const now = Date.now();
        const isLocal = LOCALHOST_IPS.has(ip);
        const windowMs = isLocal ? LOCAL_RATE_LIMIT_WINDOW_MS : REMOTE_RATE_LIMIT_WINDOW_MS;
        const maxRequests = isLocal ? LOCAL_RATE_LIMIT_MAX_REQUESTS : REMOTE_RATE_LIMIT_MAX_REQUESTS;
        const entry = rateLimiter.get(ip);
        if (!entry || now - entry.start > windowMs) {
            rateLimiter.set(ip, { start: now, count: 1 });
            return true;
        }
        entry.count++;
        if (entry.count > maxRequests) return false;
        return true;
    }

    function reset() { rateLimiter.clear(); }

    // For testing: directly simulate N rapid requests by manipulating count
    function simulateRequests(ip, count) {
        const now = Date.now();
        rateLimiter.set(ip, { start: now, count: count });
    }

    return { checkRateLimit, reset, simulateRequests };
}

// ============================================================================
// 1. nexus-write-sync-file input validation
// ============================================================================
console.log('\n=== 1. nexus-write-sync-file input validation ===');

(function testNexusWriteSyncFile() {
    // Rejects null
    var result = validateNexusWriteSyncFile(null);
    assert(result.status === 'error', 'nexus-write-sync-file: rejects null');
    assert(result.message.includes('required'), 'nexus-write-sync-file: null error mentions required');

    // Rejects undefined
    result = validateNexusWriteSyncFile(undefined);
    assert(result.status === 'error', 'nexus-write-sync-file: rejects undefined');

    // Rejects string
    result = validateNexusWriteSyncFile('not an object');
    assert(result.status === 'error', 'nexus-write-sync-file: rejects string input');
    assert(result.message.includes('plain object'), 'nexus-write-sync-file: string error mentions plain object');

    // Rejects number
    result = validateNexusWriteSyncFile(42);
    assert(result.status === 'error', 'nexus-write-sync-file: rejects number input');

    // Rejects array
    result = validateNexusWriteSyncFile([1, 2, 3]);
    assert(result.status === 'error', 'nexus-write-sync-file: rejects array input');
    assert(result.message.includes('plain object'), 'nexus-write-sync-file: array error mentions plain object');

    // Rejects oversized data (> 64MB)
    // Create an object whose JSON serialization exceeds 64MB
    // 64MB = 67108864 bytes. We create a string of length 67108865 (> 64MB)
    var hugeString = 'x'.repeat(64 * 1024 * 1024 + 1);
    var hugeObject = { data: hugeString };
    result = validateNexusWriteSyncFile(hugeObject);
    assert(result.status === 'error', 'nexus-write-sync-file: rejects oversized data (>64MB)');
    assert(result.message.includes('too large') || result.message.includes('exceeds'), 'nexus-write-sync-file: oversized error mentions size limit');

    // Accepts valid object data
    result = validateNexusWriteSyncFile({ world: 'test', tick: 1 });
    assert(result.status === 'ok', 'nexus-write-sync-file: accepts valid object data');

    // Accepts empty object
    result = validateNexusWriteSyncFile({});
    assert(result.status === 'ok', 'nexus-write-sync-file: accepts empty object');

    // Accepts nested object
    result = validateNexusWriteSyncFile({ level1: { level2: { level3: 'deep' } } });
    assert(result.status === 'ok', 'nexus-write-sync-file: accepts nested object');

    // Accepts object just under size limit: compute the exact string length
    // so that JSON.stringify output is exactly 64MB - 1 bytes
    var targetSize = 64 * 1024 * 1024 - 1; // 67108863
    // JSON.stringify({x:"..."}) = '{"x":"' + value + '"}' = 8 + value.length
    var nearLimitString = 'a'.repeat(targetSize - 8);
    var nearLimitObject = { x: nearLimitString };
    result = validateNexusWriteSyncFile(nearLimitObject);
    assert(result.status === 'ok', 'nexus-write-sync-file: accepts data just under 64MB limit');
})();

// ============================================================================
// 2. nexus-load-world-file path traversal
// ============================================================================
console.log('\n=== 2. nexus-load-world-file path traversal ===');

(function testNexusLoadWorldFile() {
    // Rejects non-string paths
    var result = validateNexusLoadWorldFile(123);
    assert(result.status === 'error', 'nexus-load-world-file: rejects number path');

    result = validateNexusLoadWorldFile(null);
    assert(result.status === 'error', 'nexus-load-world-file: rejects null path');

    result = validateNexusLoadWorldFile(undefined);
    assert(result.status === 'error', 'nexus-load-world-file: rejects undefined path');

    result = validateNexusLoadWorldFile(true);
    assert(result.status === 'error', 'nexus-load-world-file: rejects boolean path');

    result = validateNexusLoadWorldFile({});
    assert(result.status === 'error', 'nexus-load-world-file: rejects object path');

    // Rejects empty string
    result = validateNexusLoadWorldFile('');
    assert(result.status === 'error', 'nexus-load-world-file: rejects empty string path');

    // Rejects paths outside saves directory (path traversal)
    result = validateNexusLoadWorldFile('../../etc/passwd');
    assert(result.status === 'error', 'nexus-load-world-file: rejects ../../etc/passwd');
    assert(result.message.includes('saves directory'), 'nexus-load-world-file: path traversal error mentions saves directory');

    result = validateNexusLoadWorldFile('/etc/passwd');
    assert(result.status === 'error', 'nexus-load-world-file: rejects /etc/passwd');

    result = validateNexusLoadWorldFile('/tmp/evil.json');
    assert(result.status === 'error', 'nexus-load-world-file: rejects /tmp/evil.json');

    result = validateNexusLoadWorldFile('../../../home/user/.ssh/id_rsa');
    assert(result.status === 'error', 'nexus-load-world-file: rejects deep path traversal');

    // Rejects non-.json file extensions within saves directory
    result = validateNexusLoadWorldFile(path.join(SAVES_DIR, 'world.txt'));
    assert(result.status === 'error', 'nexus-load-world-file: rejects .txt extension');
    assert(result.message.includes('.json'), 'nexus-load-world-file: extension error mentions .json');

    result = validateNexusLoadWorldFile(path.join(SAVES_DIR, 'world.exe'));
    assert(result.status === 'error', 'nexus-load-world-file: rejects .exe extension');

    result = validateNexusLoadWorldFile(path.join(SAVES_DIR, 'world.js'));
    assert(result.status === 'error', 'nexus-load-world-file: rejects .js extension');

    result = validateNexusLoadWorldFile(path.join(SAVES_DIR, 'world'));
    assert(result.status === 'error', 'nexus-load-world-file: rejects no extension');

    // Accepts valid paths within saves directory
    result = validateNexusLoadWorldFile(path.join(SAVES_DIR, 'my_world.json'));
    assert(result.status === 'ok', 'nexus-load-world-file: accepts valid .json path in saves dir');

    result = validateNexusLoadWorldFile(path.join(SAVES_DIR, 'subdir', 'world.json'));
    assert(result.status === 'ok', 'nexus-load-world-file: accepts valid .json path in saves subdir');

    result = validateNexusLoadWorldFile(path.join(SAVES_DIR, 'save_2024.json'));
    assert(result.status === 'ok', 'nexus-load-world-file: accepts save_2024.json');
})();

// ============================================================================
// 3. save-settings input validation
// ============================================================================
console.log('\n=== 3. save-settings input validation ===');

(function testSaveSettings() {
    // Rejects null
    var result = validateSaveSettings(null);
    assert(result === false, 'save-settings: rejects null');

    // Rejects undefined
    result = validateSaveSettings(undefined);
    assert(result === false, 'save-settings: rejects undefined');

    // Rejects string
    result = validateSaveSettings('settings');
    assert(result === false, 'save-settings: rejects string input');

    // Rejects number
    result = validateSaveSettings(123);
    assert(result === false, 'save-settings: rejects number input');

    // Rejects array
    result = validateSaveSettings([1, 2, 3]);
    assert(result === false, 'save-settings: rejects array input');

    // Rejects boolean
    result = validateSaveSettings(true);
    assert(result === false, 'save-settings: rejects boolean input');

    // Rejects oversized settings (> 512KB)
    // 512KB = 524288 bytes. JSON.stringify with 2-space indent adds overhead.
    // Create a string value large enough that the serialized form exceeds 512KB
    var bigSettings = { key: 'x'.repeat(512 * 1024) };
    result = validateSaveSettings(bigSettings);
    assert(result === false, 'save-settings: rejects oversized settings (>512KB)');

    // Accepts valid object
    result = validateSaveSettings({ volume: 80, theme: 'dark' });
    assert(result === true, 'save-settings: accepts valid object');

    // Accepts empty object
    result = validateSaveSettings({});
    assert(result === true, 'save-settings: accepts empty object');

    // Accepts nested settings
    result = validateSaveSettings({ audio: { music: 50, sfx: 80 }, display: { fullscreen: true } });
    assert(result === true, 'save-settings: accepts nested settings object');

    // Accepts settings just under 512KB limit
    // With indent=2, JSON.stringify({k:"..."}) = '{\n  "k": "..."\n}' = 14 + value length
    // So value length = 524288 - 14 = 524274
    var nearLimitSettings = { k: 'a'.repeat(524288 - 14) };
    result = validateSaveSettings(nearLimitSettings);
    assert(result === true, 'save-settings: accepts settings just under 512KB limit');
})();

// ============================================================================
// 4. save-game filename validation
// ============================================================================
console.log('\n=== 4. save-game filename validation ===');

(function testSaveGameFilename() {
    // Only allows safe filenames matching ^[a-zA-Z0-9_-]+\.json$

    // Accepts valid filenames
    var result = validateSaveGame('save.json');
    assert(result.success === true, 'save-game: accepts save.json');

    result = validateSaveGame('my_save_1.json');
    assert(result.success === true, 'save-game: accepts my_save_1.json');

    result = validateSaveGame('save-2024-01.json');
    assert(result.success === true, 'save-game: accepts save-2024-01.json');

    result = validateSaveGame('SAVE.json');
    assert(result.success === true, 'save-game: accepts SAVE.json (uppercase)');

    result = validateSaveGame('a.json');
    assert(result.success === true, 'save-game: accepts a.json (single char)');

    result = validateSaveGame('_private.json');
    assert(result.success === true, 'save-game: accepts _private.json (underscore prefix)');

    result = validateSaveGame('2024.json');
    assert(result.success === true, 'save-game: accepts 2024.json (numeric name)');

    // Rejects path traversal filenames
    result = validateSaveGame('../etc/passwd.json');
    assert(result.success === false, 'save-game: rejects ../etc/passwd.json');

    result = validateSaveGame('../../etc/passwd.json');
    assert(result.success === false, 'save-game: rejects ../../etc/passwd.json');

    result = validateSaveGame('..\\windows\\system32.json');
    assert(result.success === false, 'save-game: rejects ..\\windows\\system32.json');

    // Rejects filenames with slashes
    result = validateSaveGame('subdir/save.json');
    assert(result.success === false, 'save-game: rejects subdir/save.json');

    result = validateSaveGame('/absolute/save.json');
    assert(result.success === false, 'save-game: rejects /absolute/save.json');

    // Rejects filenames with dots (other than .json)
    result = validateSaveGame('save.backup.json');
    assert(result.success === false, 'save-game: rejects save.backup.json (extra dot)');

    result = validateSaveGame('.hidden.json');
    assert(result.success === false, 'save-game: rejects .hidden.json (dot prefix)');

    // Rejects non-.json extensions
    result = validateSaveGame('save.txt');
    assert(result.success === false, 'save-game: rejects save.txt');

    result = validateSaveGame('save.js');
    assert(result.success === false, 'save-game: rejects save.js');

    result = validateSaveGame('save');
    assert(result.success === false, 'save-game: rejects save (no extension)');

    // Rejects filenames with spaces
    result = validateSaveGame('my save.json');
    assert(result.success === false, 'save-game: rejects filename with spaces');

    // Rejects filenames with special characters
    result = validateSaveGame('save@2.json');
    assert(result.success === false, 'save-game: rejects save@2.json');

    result = validateSaveGame('save#1.json');
    assert(result.success === false, 'save-game: rejects save#1.json');

    result = validateSaveGame('save!.json');
    assert(result.success === false, 'save-game: rejects save!.json');

    // Rejects non-string types
    result = validateSaveGame(null);
    assert(result.success === false, 'save-game: rejects null filename');

    result = validateSaveGame(undefined);
    assert(result.success === false, 'save-game: rejects undefined filename');

    result = validateSaveGame(123);
    assert(result.success === false, 'save-game: rejects number filename');

    result = validateSaveGame({});
    assert(result.success === false, 'save-game: rejects object filename');

    // Rejects empty string
    result = validateSaveGame('');
    assert(result.success === false, 'save-game: rejects empty string filename');
})();

// ============================================================================
// 5. Rate limiter
// ============================================================================
console.log('\n=== 5. Rate limiter ===');

(function testRateLimiter() {
    var limiter = createRateLimiter();

    // Allows localhost requests within limits
    var result = limiter.checkRateLimit('127.0.0.1');
    assert(result === true, 'rate-limiter: allows first localhost request');

    result = limiter.checkRateLimit('127.0.0.1');
    assert(result === true, 'rate-limiter: allows second localhost request');

    result = limiter.checkRateLimit('::1');
    assert(result === true, 'rate-limiter: allows IPv6 localhost request');

    result = limiter.checkRateLimit('::ffff:127.0.0.1');
    assert(result === true, 'rate-limiter: allows mapped IPv4 localhost request');

    // Allows remote requests within limits
    limiter.reset();
    result = limiter.checkRateLimit('192.168.1.1');
    assert(result === true, 'rate-limiter: allows first remote request');

    result = limiter.checkRateLimit('192.168.1.1');
    assert(result === true, 'rate-limiter: allows second remote request');

    // Blocks requests exceeding limits — localhost (500 per 10s window)
    limiter.reset();
    // Simulate 499 prior requests, then the 500th should pass, 501st should fail
    limiter.simulateRequests('127.0.0.1', 499);
    result = limiter.checkRateLimit('127.0.0.1');
    assert(result === true, 'rate-limiter: allows 500th localhost request (count becomes 500)');

    result = limiter.checkRateLimit('127.0.0.1');
    assert(result === false, 'rate-limiter: blocks 501st localhost request');

    // Blocks requests exceeding limits — remote (60 per 60s window)
    limiter.reset();
    limiter.simulateRequests('10.0.0.1', 59);
    result = limiter.checkRateLimit('10.0.0.1');
    assert(result === true, 'rate-limiter: allows 60th remote request (count becomes 60)');

    result = limiter.checkRateLimit('10.0.0.1');
    assert(result === false, 'rate-limiter: blocks 61st remote request');

    // Different IPs have independent rate limits
    limiter.reset();
    limiter.simulateRequests('192.168.1.100', 500); // Exhaust limit for this IP
    result = limiter.checkRateLimit('192.168.1.100');
    assert(result === false, 'rate-limiter: blocks exhausted IP');

    result = limiter.checkRateLimit('192.168.1.101');
    assert(result === true, 'rate-limiter: allows different IP (independent limit)');

    // Localhost has higher limits than remote
    limiter.reset();
    limiter.simulateRequests('10.0.0.1', 60);
    result = limiter.checkRateLimit('10.0.0.1');
    assert(result === false, 'rate-limiter: remote blocked at 60 requests');

    limiter.reset();
    limiter.simulateRequests('127.0.0.1', 60);
    result = limiter.checkRateLimit('127.0.0.1');
    assert(result === true, 'rate-limiter: localhost still allowed at 60 requests (limit is 500)');
})();

// ============================================================================
// Results
// ============================================================================
console.log(`\nResults: ${PASS} passed, ${FAIL} failed`);
if (FAIL > 0) process.exit(1);
