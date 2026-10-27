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
  $output = & firebase @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    $message = ($output | Out-String).Trim()
    if ($message -match 'credentials are no longer valid|Authentication Error') {
      throw "Firebase sign-in is expired. Run 'firebase login --reauth' with an account allowed to deploy to $projectId, then rerun this script."
    }
    throw "$Description failed: $message"
  }
  $raw = ($output | Out-String).Trim()
  try { $json = $raw | ConvertFrom-Json }
  catch { throw "$Description returned unreadable JSON; refusing to deploy." }
  if ($json.status -ne 'success') { throw "$Description did not report success; refusing to deploy." }
  return $json
}

function Invoke-FirebaseDeploy([string[]]$Arguments, [string]$Description) {
  $output = & firebase @Arguments 2>&1
  $message = ($output | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "$Description failed: $message" }
  Write-Output $message
}

Push-Location $repoRoot
$previousUpdateCheck = $env:FIREBASE_CLI_DISABLE_UPDATE_CHECK
try {
  $env:FIREBASE_CLI_DISABLE_UPDATE_CHECK = '1'
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
    Invoke-FirebaseDeploy @('deploy', '--only', 'functions:homeworkPortal', '--project', $projectId, '--non-interactive') 'Staging homework function deploy'
  }

  Invoke-FirebaseDeploy @('hosting:channel:deploy', $channelId, '--project', $projectId, '--config', $firebaseConfig, '--expires', '7d', '--non-interactive') 'Staging preview-channel deploy'
} finally {
  if ($null -eq $previousUpdateCheck) { Remove-Item Env:FIREBASE_CLI_DISABLE_UPDATE_CHECK -ErrorAction SilentlyContinue }
  else { $env:FIREBASE_CLI_DISABLE_UPDATE_CHECK = $previousUpdateCheck }
  Pop-Location
}
