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
  ['src/renderer/app.js', 2130],
  ['src/renderer/index.html', 775],
  ['src/renderer/run-details-controller.js', 510],
  ['src/renderer/stats-view.js', 340],
  ['src/renderer/statistics-report-controller.js', 430],
  ['src/renderer/statistics-report-markup.js', 90],
  ['src/renderer/tracker-view-controller.js', 220],
  ['src/renderer/tracker-view-markup.js', 60],
  ['src/renderer/concurrent-tracking-controller.js', 480],
  ['src/renderer/character-tracking-ui-controller.js', 115],
  ['src/renderer/tracking-preparation-controller.js', 90],
  ['src/renderer/encounter-detail-view.js', 60],
  ['src/renderer/appraisal-history-view.js', 60],
  ['src/renderer/support-settings-controller.js', 310],
  ['src/renderer/loadout-controller.js', 200],
  ['src/renderer/ui-task-controller.js', 80],
  ['src/renderer/fit-name-controller.js', 80],
  ['src/renderer/manual-run-controller.js', 420],
  ['src/renderer/manual-encounter-controller.js', 340],
  ['src/renderer/manual-encounter-markup.js', 80],
  ['src/renderer/character-controller.js', 280],
  ['src/main/main.js', 480],
  ['src/main/oauth-service.js', 180],
  ['src/main/database.js', 40],
  ['src/main/database/facade.js', 100],
  ['src/main/database/schema.js', 380],
  ['src/main/database/schema-contract-v6.js', 230],
  ['src/main/database/schema-contract-v7.js', 90],
  ['src/main/database/schema-v7.js', 110],
  ['src/main/database/schema-v7-migration-service.js', 90],
  ['src/main/database/lifecycle-service.js', 180],
  ['src/main/database/run-repository-v6.js', 470],
  ['src/main/database/run-query-repository-v6.js', 290],
  ['src/main/database/run-csv-repository-v6.js', 350],
  ['src/main/database/run-csv-validation-v6.js', 210],
  ['src/main/database/statistics-report-repository.js', 410],
  ['src/shared/statistics-report.js', 260],
  ['src/shared/run-domain.js', 30],
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
const databaseSchemaContractV6 = read('src/main/database/schema-contract-v6.js');
const databaseSchemaContractV7 = read('src/main/database/schema-contract-v7.js');
const databaseLifecycle = read('src/main/database/lifecycle-service.js');
const backupService = read('src/main/database/backup-service.js');
const statisticsReportRepository = read('src/main/database/statistics-report-repository.js');
const statisticsReportContract = read('src/shared/statistics-report.js');
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
    && /AbyssStatisticsReportController/.test(rendererApp)
    && /AbyssTrackerView/.test(rendererApp)
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
    && /AbyssManualEncounters/.test(rendererApp)
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
    && /createStatisticsReportRepository/.test(databaseFacade)
    && /createTrackingDraftRepository/.test(databaseFacade)
    && /createRunCsvRepository/.test(databaseFacade),
  'database/facade.js must compose lifecycle, backup, settings, credentials, inventory, run, statistics, and CSV ownership'
);
expect(
  /survived_with_cargo_gain/.test(statisticsReportRepository)
    && /beforeObserved && run\.afterObserved/.test(statisticsReportRepository)
    && /group_by/.test(statisticsReportContract)
    && /length > 2/.test(statisticsReportContract)
    && !/SELECT|INSERT|UPDATE|DELETE/.test(statisticsReportContract),
  'dynamic reports must use typed snapshot aggregation and a SQL-free allowlisted contract'
);
expect(
  /SCHEMA_VERSION = SCHEMA_VERSION_V7/.test(databaseSchema)
    && /CURRENT_SCHEMA_CONTRACT/.test(databaseSchema)
    && /getCurrentSchemaIssues/.test(databaseSchema)
    && /idx_runs_fit_snapshot_started/.test(databaseSchemaContractV6)
    && /idx_runs_encounter/.test(databaseSchemaContractV7)
    && /appraisal_current_per_run/.test(databaseSchemaContractV6)
    && /foreignKeys/.test(databaseSchemaContractV7)
    && /createFreshSchemaV7/.test(databaseSchema)
    && !/schema-v5|migrateV5ToV6|LEGACY/.test(databaseSchema + databaseSchemaContractV7)
    && !/ship_name/.test(databaseSchema),
  'database/schema.js must define only the current schema without legacy migration paths'
);
expect(
  /currentVersion !== SCHEMA_VERSION && currentVersion !== 6/.test(databaseLifecycle)
    && /migrateFromSchemaV6/.test(databaseLifecycle)
    && /applicationId !== 0 && applicationId !== ABYSSLOG_APPLICATION_ID/.test(databaseLifecycle)
    && /getCurrentSchemaIssues/.test(databaseLifecycle)
    && /allowSchemaV6 && schemaVersion === 6/.test(backupService)
    && /getCurrentSchemaIssues/.test(backupService)
    && !/schema-v5|legacy/i.test(databaseLifecycle + backupService),
  'database startup and restore must migrate only verified schema-v6 data into schema v7'
);
const removedLegacyRuntimeFiles = [
  'schema-v5.js',
  'migrate-v5-to-v6.js',
  'migration-candidate-service.js',
  'schema-contract.js',
  'fit-repository.js',
  'inventory-baseline-repository.js',
  'run-csv-repository.js',
  'run-repository.js',
  'statistics-repository.js',
].map(filename => path.join(projectRoot, 'src', 'main', 'database', filename));
expect(
  removedLegacyRuntimeFiles.every(filePath => !fs.existsSync(filePath)),
  'public source must not retain private-candidate or legacy repository modules'
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
