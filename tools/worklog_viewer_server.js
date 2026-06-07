const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ALLOWED_DIR = path.resolve(__dirname); // Only serve files from tools/ directory
const PORT = Number(process.env.WORKLOG_VIEWER_PORT || 45173);
const HOST = '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function openBrowser(url) {
  const command = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(command, () => {});
}

const SENSITIVE_FILES = ['.env', '.env.', 'credentials', 'secret', 'api_key', 'apikey'];

function isSensitive(filepath) {
  const lower = path.basename(filepath).toLowerCase();
  return SENSITIVE_FILES.some(s => lower.startsWith(s) || lower.includes(s));
}

const server = http.createServer((req, res) => {
  try {
    const parsed = new URL(req.url, `http://${HOST}:${PORT}`);
    let pathname = decodeURIComponent(parsed.pathname);
    if (pathname === '/') pathname = '/worklog_viewer.html';

    const requested = path.resolve(ALLOWED_DIR, '.' + pathname);
    // Restrict to ALLOWED_DIR (tools/) only — no project root traversal
    if (!requested.startsWith(ALLOWED_DIR + path.sep) && requested !== ALLOWED_DIR) {
      return send(res, 403, 'Forbidden: access restricted to tools/ directory');
    }
    if (isSensitive(requested)) {
      return send(res, 403, 'Forbidden: sensitive file');
    }

    fs.readFile(requested, (error, data) => {
      if (error) return send(res, 404, 'Not found: ' + pathname);
      const type = MIME[path.extname(requested).toLowerCase()] || 'application/octet-stream';
      send(res, 200, data, type);
    });
  } catch (error) {
    send(res, 500, error.message);
  }
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}/tools/worklog_viewer.html`;
  console.log('AI Patcher Worklog Viewer');
  console.log('Root:', ROOT);
  console.log('URL:', url);
  console.log('Close this window to stop the viewer.');
  openBrowser(url);
});
