param(
  [switch]$SkipFunction
)

$ErrorActionPreference = 'Stop'
$projectId = 'fun-torah-tools-staging'
$siteId = 'fun-torah-tools-staging'
$channelId = 'homework-406-preview'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$firebaseConfig = Join-Path $repoRoot 'firebase.staging-preview.json'

function Invoke-FirebaseJson([string[]]$Arguments, [string]$Description) {
  # Keep stderr separate: merging Node's stderr into PowerShell's pipeline can
  # trigger a libuv assertion on Windows even after the CLI returned valid JSON.
  $output = & firebase @Arguments 2>$null
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    throw "$Description failed with Firebase CLI exit code $exitCode; refusing to deploy. If this is an authentication error, run 'firebase login --reauth' and retry."
  }
  $raw = ($output | Out-String).Trim()
  # Firebase CLI can print progress lines before its JSON envelope. Parse only
  # the envelope so harmless progress output does not block the safe preflight.
  $jsonStart = $raw.IndexOf('{')
  $jsonEnd = $raw.LastIndexOf('}')
  if ($jsonStart -lt 0 -or $jsonEnd -lt $jsonStart) {
    throw "$Description returned unreadable JSON; refusing to deploy."
  }
  $jsonText = $raw.Substring($jsonStart, $jsonEnd - $jsonStart + 1)
  try { $json = $jsonText | ConvertFrom-Json }
  catch { throw "$Description returned unreadable JSON; refusing to deploy." }
  if ($json.status -ne 'success') { throw "$Description did not report success; refusing to deploy." }
  return $json
}

function Invoke-FirebaseDeploy([string[]]$Arguments, [string]$Description) {
  Write-Output "Starting $Description..."
  & firebase @Arguments
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) { throw "$Description failed with Firebase CLI exit code $exitCode." }
}

Push-Location $repoRoot
$previousUpdateCheck = $env:FIREBASE_CLI_DISABLE_UPDATE_CHECK
$previousDiscoveryTimeout = $env:FUNCTIONS_DISCOVERY_TIMEOUT
try {
  $env:FIREBASE_CLI_DISABLE_UPDATE_CHECK = '1'
  # This codebase has a large shared functions entry point; allow the staging
  # CLI analyzer more than its 10-second default to discover one named function.
  $env:FUNCTIONS_DISCOVERY_TIMEOUT = '30'
  $projects = Invoke-FirebaseJson @('projects:list', '--json', '--non-interactive') 'Firebase project verification'
  $projectIds = @($projects.result | ForEach-Object { $_.projectId })
  if ($projectIds -notcontains $projectId) {
    throw "The signed-in Firebase account cannot verify project '$projectId'; refusing all deploys."
  }

  $sites = Invoke-FirebaseJson @('hosting:sites:list', '--project', $projectId, '--json', '--non-interactive') 'Staging Hosting site verification'
  $siteResults = $sites.result
  if ($siteResults.sites) { $siteResults = $siteResults.sites }
  $siteIds = @($siteResults | ForEach-Object {
    if ($_.siteId) { $_.siteId }
    elseif ($_.name) { ($_.name -split '/')[-1] }
  })
  if ($siteIds -notcontains $siteId) {
    throw "Hosting site '$siteId' was not returned under '$projectId'; refusing all deploys."
  }

  if (-not (Test-Path -LiteralPath $firebaseConfig)) {
    throw "Missing staging-only Hosting config: $firebaseConfig"
  }

  if (-not $SkipFunction) {
    Invoke-FirebaseDeploy @('deploy', '--only', 'functions:homework-staging', '--project', $projectId, '--config', $firebaseConfig, '--non-interactive') 'Staging homework function deploy'
  }

  Invoke-FirebaseDeploy @('hosting:channel:deploy', $channelId, '--project', $projectId, '--config', $firebaseConfig, '--expires', '7d', '--non-interactive') 'Staging preview-channel deploy'
} finally {
  if ($null -eq $previousUpdateCheck) { Remove-Item Env:FIREBASE_CLI_DISABLE_UPDATE_CHECK -ErrorAction SilentlyContinue }
  else { $env:FIREBASE_CLI_DISABLE_UPDATE_CHECK = $previousUpdateCheck }
  if ($null -eq $previousDiscoveryTimeout) { Remove-Item Env:FUNCTIONS_DISCOVERY_TIMEOUT -ErrorAction SilentlyContinue }
  else { $env:FUNCTIONS_DISCOVERY_TIMEOUT = $previousDiscoveryTimeout }
  Pop-Location
}
