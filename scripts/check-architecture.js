const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const violations = [];

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function expect(condition, message) {
  if (!condition) violations.push(message);
}

const budgets = new Map([
  ['src/renderer/app.js', 3150],
  ['src/renderer/index.html', 700],
  ['src/main/main.js', 700],
  ['src/main/database.js', 900],
]);

for (const [relativePath, maximumLines] of budgets) {
  const lineCount = read(relativePath).split(/\r?\n/).length;
  expect(
    lineCount <= maximumLines,
    relativePath + ' has ' + lineCount + ' lines; keep it at or below ' + maximumLines
  );
}

const rendererHtml = read('src/renderer/index.html');
const rendererApp = read('src/renderer/app.js');
const main = read('src/main/main.js');
const database = read('src/main/database.js');

expect(
  !/<style(?:\s|>)/i.test(rendererHtml),
  'src/renderer/index.html must keep application CSS in styles/app.css'
);
expect(
  /href="\.\/styles\/app\.css"/.test(rendererHtml),
  'src/renderer/index.html must load styles/app.css'
);
expect(
  /AbyssRunSession/.test(rendererApp)
    && /AbyssStatsView/.test(rendererApp)
    && /AbyssHistoryView/.test(rendererApp),
  'renderer/app.js must delegate run lifecycle, history, and statistics rendering'
);
expect(
  !/secureHandle\('[^']+'/.test(main),
  'src/main/main.js must compose IPC registrars instead of registering channels inline'
);
expect(
  /registerAuthSettingsHandlers/.test(main)
    && /registerExternalServiceHandlers/.test(main)
    && /registerRunHandlers/.test(main)
    && /registerSupportHandlers/.test(main),
  'src/main/main.js must compose every IPC registrar'
);
expect(
  /createStatisticsRepository/.test(database)
    && /createRunCsvRepository/.test(database)
    && /createRunRepository/.test(database),
  'src/main/database.js must preserve the run, statistics, and CSV repository boundaries'
);
expect(
  !/parseCsv|security\.validateRunData/.test(database),
  'src/main/database.js must not absorb CSV parsing and validation again'
);

if (violations.length > 0) {
  console.error('Architecture checks failed:');
  for (const violation of violations) console.error('- ' + violation);
  process.exitCode = 1;
} else {
  console.log('Architecture checks passed.');
}
