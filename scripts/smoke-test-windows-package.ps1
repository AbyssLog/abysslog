[CmdletBinding()]
param(
  [string]$AppPath,
  [string]$NodePath = 'node',
  [ValidateRange(5, 120)]
  [int]$TimeoutSeconds = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($AppPath)) {
  $AppPath = Join-Path $PSScriptRoot '..\dist\win-unpacked\AbyssLog.exe'
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw 'The packaged application smoke test can only run on Windows'
}

$resolvedAppPath = (Resolve-Path -LiteralPath $AppPath -ErrorAction Stop).Path
if (-not (Test-Path -LiteralPath $resolvedAppPath -PathType Leaf)) {
  throw "Packaged application was not found: $resolvedAppPath"
}

$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd(
  [IO.Path]::DirectorySeparatorChar,
  [IO.Path]::AltDirectorySeparatorChar
)
$smokeDirectory = Join-Path $tempRoot "abysslog-package-smoke-$([guid]::NewGuid().ToString('N'))"
$normalizedSmokeDirectory = [IO.Path]::GetFullPath($smokeDirectory).TrimEnd(
  [IO.Path]::DirectorySeparatorChar,
  [IO.Path]::AltDirectorySeparatorChar
)
$smokeParent = [IO.Directory]::GetParent($normalizedSmokeDirectory).FullName.TrimEnd(
  [IO.Path]::DirectorySeparatorChar,
  [IO.Path]::AltDirectorySeparatorChar
)

$hasSafeName = ([IO.Path]::GetFileName($normalizedSmokeDirectory)).StartsWith(
  'abysslog-package-smoke-',
  [StringComparison]::Ordinal
)
if (($smokeParent -ne $tempRoot) -or (-not $hasSafeName)) {
  throw "Refusing to use an unsafe smoke-test directory: $normalizedSmokeDirectory"
}

$databasePath = Join-Path $normalizedSmokeDirectory 'abysslog.db'
$backupDirectory = Join-Path $normalizedSmokeDirectory 'backups'
$devToolsPortPath = Join-Path $normalizedSmokeDirectory 'DevToolsActivePort'
$executableName = [IO.Path]::GetFileName($resolvedAppPath)
$smokeProcess = $null

function Get-SmokeProcesses {
  @(
    Get-CimInstance Win32_Process -Filter "Name = '$executableName'" |
      Where-Object {
        ($_.ExecutablePath -eq $resolvedAppPath) -and
        $_.CommandLine -and
        $_.CommandLine.Contains($normalizedSmokeDirectory)
      }
  )
}

function Stop-SmokeProcesses {
  $shutdownDeadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    $remainingProcesses = @(Get-SmokeProcesses)
    if ($remainingProcesses.Count -eq 0) {
      return
    }
    foreach ($remainingProcess in $remainingProcesses) {
      Stop-Process -Id $remainingProcess.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 200
  } while ([DateTime]::UtcNow -lt $shutdownDeadline)
}

New-Item -ItemType Directory -Path $normalizedSmokeDirectory -ErrorAction Stop | Out-Null

try {
  $profileArgument = "--user-data-dir=`"$normalizedSmokeDirectory`""
  $smokeProcess = Start-Process `
    -FilePath $resolvedAppPath `
    -ArgumentList @($profileArgument, '--disable-gpu', '--remote-debugging-port=0') `
    -WindowStyle Hidden `
    -PassThru

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $databaseReady = $false
  $backupReady = $false
  $rendererDebugReady = $false
  $processCount = 0
  $startupReady = $false

  do {
    Start-Sleep -Milliseconds 250
    $smokeProcess.Refresh()
    if ($smokeProcess.HasExited) {
      throw "Packaged application exited during startup with code $($smokeProcess.ExitCode)"
    }

    $databaseReady = (Test-Path -LiteralPath $databasePath -PathType Leaf) `
      -and (Get-Item -LiteralPath $databasePath).Length -gt 0
    $backupReady = (Test-Path -LiteralPath $backupDirectory -PathType Container) `
      -and @(
        Get-ChildItem `
          -LiteralPath $backupDirectory `
          -Filter 'abysslog-auto-*.db' `
          -File `
          -ErrorAction SilentlyContinue
      ).Count -gt 0
    $rendererDebugReady = Test-Path -LiteralPath $devToolsPortPath -PathType Leaf
    $processCount = @(Get-SmokeProcesses).Count
    $startupReady = $databaseReady `
      -and $backupReady `
      -and $rendererDebugReady `
      -and $processCount -ge 2
  } while (-not $startupReady -and [DateTime]::UtcNow -lt $deadline)

  if (-not $startupReady) {
    throw (
      'Packaged application did not finish a clean startup within ' +
      "$TimeoutSeconds seconds (database=$databaseReady, backup=$backupReady, " +
      "rendererDebug=$rendererDebugReady, processes=$processCount)"
    )
  }

  $devToolsPort = Get-Content -LiteralPath $devToolsPortPath | Select-Object -First 1
  $rendererVerifier = Join-Path $PSScriptRoot 'verify-packaged-renderer.js'
  & $NodePath $rendererVerifier $devToolsPort
  if ($LASTEXITCODE -ne 0) {
    throw "Packaged renderer verification failed with exit code $LASTEXITCODE"
  }

  Write-Host (
    "Packaged application smoke test passed: renderer, database, and backup ready; " +
    "$processCount Electron processes running"
  )
} finally {
  if ($null -ne $smokeProcess) {
    $smokeProcess.Refresh()
    if (-not $smokeProcess.HasExited) {
      [void]$smokeProcess.CloseMainWindow()
      if (-not $smokeProcess.WaitForExit(5000)) {
        Stop-Process -Id $smokeProcess.Id -Force -ErrorAction SilentlyContinue
      }
    }
  }

  Stop-SmokeProcesses

  if (Test-Path -LiteralPath $normalizedSmokeDirectory) {
    $cleanupDeadline = [DateTime]::UtcNow.AddSeconds(10)
    do {
      try {
        Remove-Item `
          -LiteralPath $normalizedSmokeDirectory `
          -Recurse `
          -Force `
          -ErrorAction Stop
        break
      } catch {
        if ([DateTime]::UtcNow -ge $cleanupDeadline) {
          Write-Warning (
            'Could not remove the disposable smoke-test profile after waiting for ' +
            "Electron to exit: $($_.Exception.Message)"
          )
          break
        }
        Start-Sleep -Milliseconds 250
      }
    } while (Test-Path -LiteralPath $normalizedSmokeDirectory)
  }
}
