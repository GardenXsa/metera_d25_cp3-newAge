#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const results = [];

function relPath(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function resolveProjectPath(projectPath) {
  const normalized = String(projectPath || '').replace(/^\.\//, '');
  return path.resolve(ROOT, normalized);
}

function addResult(name, status, details = '') {
  results.push({ name, status, details });
}

function fileExists(projectPath) {
  return fs.existsSync(resolveProjectPath(projectPath));
}

function readJson(projectPath) {
  const absolute = resolveProjectPath(projectPath);
  const text = fs.readFileSync(absolute, 'utf8');
  return JSON.parse(text);
}

function checkJson(projectPath) {
  try {
    readJson(projectPath);
    addResult(`JSON ${projectPath}`, 'OK');
    return true;
  } catch (error) {
    addResult(`JSON ${projectPath}`, 'FAIL', error.message);
    return false;
  }
}

function collectManifestPaths(node, trail = [], out = []) {
  if (!node || typeof node !== 'object') return out;
  if (typeof node.path === 'string') {
    out.push({ key: trail.join('.') || '(root)', projectPath: node.path });
  }
  for (const [key, value] of Object.entries(node)) {
    if (value && typeof value === 'object') collectManifestPaths(value, [...trail, key], out);
  }
  return out;
}

function checkManifestFiles() {
  let manifest;
  try {
    manifest = readJson('data/runtime_manifest.json');
    addResult('runtime_manifest parse', 'OK');
  } catch (error) {
    addResult('runtime_manifest parse', 'FAIL', error.message);
    return;
  }

  const entries = collectManifestPaths(manifest);
  if (entries.length === 0) {
    addResult('runtime_manifest entries', 'WARN', 'No entries with a path field were found.');
    return;
  }

  for (const entry of entries) {
    const projectPath = entry.projectPath.replace(/^\.\//, '');
    const absolute = resolveProjectPath(projectPath);
    if (!absolute.startsWith(ROOT + path.sep) && absolute !== ROOT) {
      addResult(`manifest ${entry.key}`, 'FAIL', `Path escapes project root: ${entry.projectPath}`);
      continue;
    }
    if (!fs.existsSync(absolute)) {
      addResult(`manifest ${entry.key}`, 'FAIL', `Missing file: ${projectPath}`);
      continue;
    }
    if (path.extname(projectPath).toLowerCase() === '.json') {
      try {
        JSON.parse(fs.readFileSync(absolute, 'utf8'));
        addResult(`manifest ${entry.key}`, 'OK', projectPath);
      } catch (error) {
        addResult(`manifest ${entry.key}`, 'FAIL', `${projectPath}: ${error.message}`);
      }
    } else {
      addResult(`manifest ${entry.key}`, 'OK', projectPath);
    }
  }
}

function checkJsSyntax(projectPath) {
  if (!fileExists(projectPath)) {
    addResult(`syntax ${projectPath}`, 'SKIP', 'File does not exist.');
    return;
  }
  const result = spawnSync(process.execPath, ['--check', resolveProjectPath(projectPath)], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  if (result.status === 0) {
    addResult(`syntax ${projectPath}`, 'OK');
  } else {
    addResult(`syntax ${projectPath}`, 'FAIL', (result.stderr || result.stdout || '').trim());
  }
}


function runNodeTool(projectPath, label) {
  if (!fileExists(projectPath)) {
    addResult(label, 'SKIP', 'File does not exist.');
    return;
  }
  const result = spawnSync(process.execPath, [resolveProjectPath(projectPath)], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  if (result.status === 0) {
    addResult(label, 'OK', (result.stdout || '').trim());
  } else {
    addResult(label, 'FAIL', (result.stderr || result.stdout || '').trim());
  }
}

function checkExpectedFiles() {
  const expected = [
    'docs/AI_PATCHER_WORKLOG.md',

    'docs/DATA_DRIVEN_MIGRATION_PLAN.md',
    'tools/worklog_viewer.html',
    'tools/worklog_viewer_server.js',
    'tools/open_worklog_viewer.bat',

    'tools/validate_runtime_configs.js',

    'tools/validate_data_integrity.js',
    'data/runtime_manifest.json',
    'data/ui_runtime.json',
    'data/electron_runtime.json',
    'data/prompt_runtime.json',
    'data/gameplay_runtime.json'
  ];

  for (const projectPath of expected) {
    addResult(`file ${projectPath}`, fileExists(projectPath) ? 'OK' : 'FAIL');
  }
}

function printResults() {
  const statusRank = { FAIL: 0, WARN: 1, SKIP: 2, OK: 3 };
  const ordered = [...results].sort((a, b) => statusRank[a.status] - statusRank[b.status]);
  const width = Math.max(...ordered.map(r => r.name.length), 10);

  console.log('\nAI Patcher Runtime Smoke Check');
  console.log('Project:', ROOT);
  console.log('='.repeat(80));

  for (const result of ordered) {
    const icon = result.status === 'OK' ? '[OK]' : result.status === 'WARN' ? '[WARN]' : result.status === 'SKIP' ? '[SKIP]' : '[FAIL]';
    const line = `${icon.padEnd(7)} ${result.name.padEnd(width)} ${result.details || ''}`;
    console.log(line.trimEnd());
  }

  const fails = results.filter(r => r.status === 'FAIL').length;
  const warns = results.filter(r => r.status === 'WARN').length;
  console.log('='.repeat(80));
  console.log(`Summary: ${results.length} checks, ${fails} failed, ${warns} warnings`);

  if (fails > 0) process.exit(1);
}

function main() {
  checkExpectedFiles();
  checkJson('package.json');
  checkManifestFiles();

  [
    'main.js',
    'script.js',
    'preload.js',
    'js/core/constants.js',
    'js/mods/ModLoaderIntegration.js',
    'tools/worklog_viewer_server.js',
    'tools/runtime_smoke_check.js',
    'tools/validate_runtime_configs.js',
    'tools/validate_data_integrity.js'
  ].forEach(checkJsSyntax);

  runNodeTool('tools/validate_runtime_configs.js', 'runtime config contracts');
  runNodeTool('tools/validate_data_integrity.js', 'data integrity links');

  printResults();
}

main();
