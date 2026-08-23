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
  ['src/renderer/app.js', 1950],
  ['src/renderer/index.html', 750],
  ['src/renderer/run-details-controller.js', 500],
  ['src/renderer/support-settings-controller.js', 310],
  ['src/renderer/loadout-controller.js', 200],
  ['src/renderer/ui-task-controller.js', 80],
  ['src/renderer/fit-name-controller.js', 80],
  ['src/renderer/manual-run-controller.js', 420],
  ['src/renderer/character-controller.js', 280],
  ['src/main/main.js', 480],
  ['src/main/oauth-service.js', 180],
  ['src/main/database.js', 40],
  ['src/main/database/facade.js', 100],
  ['src/main/database/schema.js', 380],
  ['src/main/database/schema-contract.js', 160],
  ['src/main/database/lifecycle-service.js', 180],
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
const databaseSchemaContract = read('src/main/database/schema-contract.js');
const databaseLifecycle = read('src/main/database/lifecycle-service.js');
const backupService = read('src/main/database/backup-service.js');
const credentialService = read('src/main/credential-service.js');
const credentialRepository = read('src/main/database/credential-repository.js');
const oauthService = read('src/main/oauth-service.js');
const ipcGuard = read('src/main/ipc-guard.js');
const electronSetup = read('scripts/setup-electron.js');
const packageJson = JSON.parse(read('package.json'));
const buildWorkflow = read('.github/workflows/build.yml');
const releaseWorkflow = read('.github/workflows/release.yml');

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
    && /AbyssUiFormatters/.test(rendererApp)
    && /AbyssLoadoutController/.test(rendererApp)
    && /AbyssSupportSettings/.test(rendererApp)
    && /AbyssRunDetails/.test(rendererApp)
    && /AbyssUiTasks/.test(rendererApp)
    && /AbyssFitNames/.test(rendererApp)
    && /AbyssManualRuns/.test(rendererApp)
    && /AbyssCharacters/.test(rendererApp),
  'renderer/app.js must delegate feature views, navigation, modal behavior, formatting, and focused controllers'
);
expect(
  !/function (?:runUiTask|loadSettingsPage|saveLoadoutPreset|showRunDetail|submitManualEntry|renderCharList)\b/.test(rendererApp),
  'renderer/app.js must compose extracted controller ownership instead of reimplementing it'
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
  /createOAuthService/.test(main)
    && !/pendingAuth|function startSso|function handleOAuthCallback/.test(main)
    && /pendingAuthorization/.test(oauthService)
    && /code_challenge_method/.test(oauthService),
  'src/main/main.js must delegate PKCE and OAuth transaction ownership to oauth-service.js'
);
expect(
  /database\/facade/.test(database) && !/better-sqlite3|parseCsv/.test(database),
  'src/main/database.js must remain a small stable facade entry point'
);
expect(
  /createDatabaseLifecycle/.test(databaseFacade)
    && /createBackupService/.test(databaseFacade)
    && /createCharacterSettingsRepository/.test(databaseFacade)
    && /createCredentialRepository/.test(databaseFacade)
    && /createInventoryBaselineRepository/.test(databaseFacade)
    && /createRunRepository/.test(databaseFacade)
    && /createStatisticsRepository/.test(databaseFacade)
    && /createRunCsvRepository/.test(databaseFacade),
  'database/facade.js must compose lifecycle, backup, settings, credentials, inventory, run, statistics, and CSV ownership'
);
expect(
  /SCHEMA_VERSION = 5/.test(databaseSchema)
    && /CURRENT_SCHEMA_CONTRACT/.test(databaseSchema)
    && /getCurrentSchemaIssues/.test(databaseSchema)
    && /idx_runs_fit_identity_started/.test(databaseSchemaContract)
    && /validate_runs_insert/.test(databaseSchemaContract)
    && /foreignKeys/.test(databaseSchemaContract)
    && /CREATE TABLE credentials/.test(databaseSchema)
    && /CREATE TABLE fit_identities/.test(databaseSchema)
    && /CHECK\(format_version >= 0\)/.test(databaseSchema)
    && !/MIGRATIONS|migrateSchema|VersionFour/.test(databaseSchema)
    && !/ship_name/.test(databaseSchema),
  'database/schema.js must define only the current schema without legacy migration paths'
);
expect(
  /currentVersion !== SCHEMA_VERSION/.test(databaseLifecycle)
    && /applicationId !== 0 && applicationId !== ABYSSLOG_APPLICATION_ID/.test(databaseLifecycle)
    && /getCurrentSchemaIssues/.test(databaseLifecycle)
    && /schemaVersion !== SCHEMA_VERSION/.test(backupService)
    && /getCurrentSchemaIssues/.test(backupService)
    && !/migrateSchema|before-migration/i.test(databaseLifecycle + backupService),
  'database startup and restore must accept only the current schema'
);
expect(
  /safeStorage/.test(credentialService)
    && /database\.getCredential/.test(credentialService)
    && !/migrated|normaliz(?:e|ation)Migrated/i.test(credentialService)
    && /clearTokens/.test(credentialService),
  'credential-service.js must own current-format encrypted credential persistence'
);
expect(
  /FROM credentials/.test(credentialRepository)
    && !/format_version = 0|NeedingNormalization/.test(credentialRepository)
    && !/FROM settings/.test(credentialRepository),
  'credential-repository.js must exclusively own current credential-table persistence'
);
expect(
  /validateSender/.test(ipcGuard) && /validateObjectPayload/.test(ipcGuard),
  'ipc-guard.js must own sender and bounded-payload validation'
);
expect(
  /DEFAULT_MAX_ATTEMPTS = 3/.test(electronSetup)
    && /isTransientInstallFailure/.test(electronSetup)
    && /attempt >= maxAttempts/.test(electronSetup),
  'scripts/setup-electron.js must keep Electron download retries bounded and transient-only'
);
expect(
  packageJson.engines?.node === '^22.22.2 || ^24.15.0 || >=26.0.0'
    && !/node-version:\s*'22'\s*$/.test(buildWorkflow + releaseWorkflow)
    && (buildWorkflow + releaseWorkflow).match(/node-version:\s*'22\.22\.2'/g)?.length === 6,
  'source requirements and CI must use the jsdom-compatible Node baseline'
);

if (violations.length > 0) {
  console.error('Architecture checks failed:');
  for (const violation of violations) console.error('- ' + violation);
  process.exitCode = 1;
} else {
  console.log('Architecture checks passed.');
}
