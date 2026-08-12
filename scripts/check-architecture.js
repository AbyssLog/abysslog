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
  ['src/main/main.js', 600],
  ['src/main/database.js', 40],
  ['src/main/database/facade.js', 100],
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
const databaseFacade = read('src/main/database/facade.js');
const databaseSchema = read('src/main/database/schema.js');
const credentialService = read('src/main/credential-service.js');
const ipcGuard = read('src/main/ipc-guard.js');

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
    && /AbyssHistoryView/.test(rendererApp)
    && /AbyssNavigation/.test(rendererApp)
    && /AbyssModals/.test(rendererApp)
    && /AbyssUiFormatters/.test(rendererApp),
  'renderer/app.js must delegate feature views, navigation, modal behavior, and formatting'
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
  /createCredentialService/.test(main) && /createIpcGuard/.test(main),
  'src/main/main.js must delegate credential storage and guarded IPC registration'
);
expect(
  /database\/facade/.test(database) && !/better-sqlite3|parseCsv/.test(database),
  'src/main/database.js must remain a small stable facade entry point'
);
expect(
  /createDatabaseLifecycle/.test(databaseFacade)
    && /createBackupService/.test(databaseFacade)
    && /createCharacterSettingsRepository/.test(databaseFacade)
    && /createInventoryBaselineRepository/.test(databaseFacade)
    && /createRunRepository/.test(databaseFacade)
    && /createStatisticsRepository/.test(databaseFacade)
    && /createRunCsvRepository/.test(databaseFacade),
  'database/facade.js must compose lifecycle, backup, settings, inventory, run, statistics, and CSV ownership'
);
expect(
  /SCHEMA_VERSION = 4/.test(databaseSchema)
    && /ALTER TABLE runs RENAME COLUMN ship_name TO hull_name/.test(databaseSchema),
  'database/schema.js must own the versioned ship_name-to-hull_name migration'
);
expect(
  /safeStorage/.test(credentialService) && /clearTokens/.test(credentialService),
  'credential-service.js must own encrypted credential persistence'
);
expect(
  /validateSender/.test(ipcGuard) && /validateObjectPayload/.test(ipcGuard),
  'ipc-guard.js must own sender and bounded-payload validation'
);

if (violations.length > 0) {
  console.error('Architecture checks failed:');
  for (const violation of violations) console.error('- ' + violation);
  process.exitCode = 1;
} else {
  console.log('Architecture checks passed.');
}
