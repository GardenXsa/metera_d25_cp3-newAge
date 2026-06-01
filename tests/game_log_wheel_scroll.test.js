const assert = require('assert');
const fs = require('fs');
const path = require('path');

const scriptPath = path.join(__dirname, '..', 'script.js');
const script = fs.readFileSync(scriptPath, 'utf8');

assert.match(
  script,
  /function installGameLogWheelScroll\(\)/,
  'script.js should install a dedicated wheel handler for the game log'
);

assert.match(
  script,
  /document\.addEventListener\('wheel',[\s\S]+capture:\s*true[\s\S]+passive:\s*false/,
  'game log wheel handler should run in capture phase and be non-passive so it can prevent page-level swallowing'
);

assert.match(
  script,
  /gameLog\.scrollTop\s*\+=\s*event\.deltaY/,
  'wheel handler should manually advance gameLog.scrollTop'
);

assert.match(
  script,
  /event\.preventDefault\(\)/,
  'wheel handler should prevent the hidden body scroll default while over the log'
);
