#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';

let failed = 0;
let skipped = 0;

function rel(projectPath) {
  return String(projectPath || '').replace(/\\/g, '/');
}

function exists(projectPath) {
  return fs.existsSync(path.resolve(ROOT, projectPath));
}

function run(label, command, args, options = {}) {
  const pretty = [command, ...args].join(' ');
  console.log(`\n[RUN] ${label}`);
  console.log(`      ${pretty}`);

  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
    ...options
  });

  if (result.error) {
    console.log(`[FAIL] ${label}: ${result.error.message}`);
    failed += 1;
    return false;
  }

  if (result.status !== 0) {
    console.log(`[FAIL] ${label}: exit code ${result.status}`);
    failed += 1;
    return false;
  }

  console.log(`[OK] ${label}`);
  return true;
}

function runIfExists(label, projectPath, command, args) {
  if (!exists(projectPath)) {
    console.log(`\n[SKIP] ${label}: missing ${rel(projectPath)}`);
    skipped += 1;
    return true;
  }
  return run(label, command, args);
}

function detectPython() {
  const candidates = isWin
    ? [
        { command: 'py', args: ['-3'] },
        { command: 'python', args: [] },
        { command: 'python3', args: [] }
      ]
    : [
        { command: 'python3', args: [] },
        { command: 'python', args: [] }
      ];

  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, [...candidate.args, '--version'], {
      cwd: ROOT,
      encoding: 'utf8',
      shell: false
    });
    if (!result.error && result.status === 0) return candidate;
  }
  return null;
}

function runPythonTest(py, testPath) {
  if (!exists(testPath)) {
    console.log(`\n[SKIP] ${testPath}: file missing`);
    skipped += 1;
    return true;
  }
  return run(`python ${testPath}`, py.command, [...py.args, testPath]);
}

function main() {
  console.log('='.repeat(80));
  console.log('Full project verification');
  console.log('Project:', ROOT);
  console.log('='.repeat(80));

  runIfExists('runtime smoke-check', 'tools/runtime_smoke_check.js', process.execPath, ['tools/runtime_smoke_check.js']);
  runIfExists('runtime data tests', 'tests/runtime_data.test.js', process.execPath, ['tests/runtime_data.test.js']);
  runIfExists('character stats resolver tests', 'tests/character_stats_resolver.test.js', process.execPath, ['tests/character_stats_resolver.test.js']);
  runIfExists('stub game integration tests', 'tests/test_stub_game.js', process.execPath, ['tests/test_stub_game.js']);

  const py = detectPython();
  if (!py) {
    console.log('\n[FAIL] Python was not found. Expected py -3, python, or python3.');
    failed += 1;
  } else {
    console.log(`\n[OK] Python runner: ${py.command} ${py.args.join(' ')}`.trim());
    [
      'engine/test_profession_cluster_refactor.py',
      'engine/test_food_cluster_refactor.py',
      'engine/test_bootstrap_cluster_refactor.py',
      'engine/test_legacy_resource_and_business_refactor.py',
      'engine/test_runtime_bundle.py',
      'engine/test_gameplay_runtime_inventory.py'
    ].forEach(testPath => runPythonTest(py, testPath));
  }

  console.log('\n' + '='.repeat(80));
  console.log(`Full verify summary: ${failed} failed, ${skipped} skipped`);
  console.log('='.repeat(80));

  if (failed > 0) process.exit(1);
}

main();
