param(
  [switch]$SkipFunction,
  # Optional separate preview link (for example 'pr-597-homework-notes'). Default is the issue #406 channel.
  [string]$ChannelName
)

$ErrorActionPreference = 'Stop'
$projectId = 'fun-torah-tools-staging'
$siteId = 'fun-torah-tools-staging'
$channelId = 'homework-406-preview'
if ($ChannelName) {
  if ($ChannelName -notmatch '^[a-z0-9][a-z0-9-]{2,40}$') { throw 'Channel name may only use lowercase letters, numbers and dashes.' }
  $channelId = $ChannelName
}
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$firebaseConfig = Join-Path $repoRoot 'firebase.staging-preview.json'

function Invoke-FirebaseJson([string[]]$Arguments, [string]$Description) {
  # Keep stderr separate: merging Node's stderr into PowerShell's pipeline can
  # trigger a libuv assertion on Windows even after the CLI returned valid JSON.
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = & firebase @Arguments 2>$null
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
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

function Prepare-StagingBootstrap {
  $stagingDir = Join-Path $repoRoot 'staging'
  $assets = @(
    @{ Name = 'firebase-config.generated.js'; Url = "https://$siteId.web.app/staging/firebase-config.generated.js" },
    @{ Name = 'staging-config.js'; Url = "https://$siteId.web.app/staging/staging-config.js" }
  )
  $downloaded = @{}
  foreach ($asset in $assets) {
    try {
      $response = Invoke-WebRequest -Uri $asset.Url -UseBasicParsing -TimeoutSec 30
    } catch {
      throw "Could not fetch the required staging bootstrap asset '$($asset.Name)'; refusing to deploy."
    }
    if ([int]$response.StatusCode -ne 200) {
      throw "Staging bootstrap asset '$($asset.Name)' returned HTTP $([int]$response.StatusCode); refusing to deploy."
    }
    $downloaded[$asset.Name] = [string]$response.Content
  }

  $generated = $downloaded['firebase-config.generated.js']
  if ($generated -notmatch '"projectId"\s*:\s*"fun-torah-tools-staging"' -or
      $generated -match '(?i)b3-games|posuk-scorer\.onrender\.com|nigrisync\.onrender\.com') {
    throw 'The generated Firebase config is not isolated to fun-torah-tools-staging; refusing to deploy.'
  }
  $guard = $downloaded['staging-config.js']
  if ($guard -notmatch "REQUIRED_PROJECT\s*=\s*'fun-torah-tools-staging'" -or
      $guard -notmatch 'installNetworkGuards' -or $guard -notmatch 'installFirebaseGuard') {
    throw 'The staging network guard is missing or targets an unexpected project; refusing to deploy.'
  }

  if (-not (Test-Path -LiteralPath $stagingDir)) {
    New-Item -ItemType Directory -Path $stagingDir | Out-Null
  }
  $encoding = [System.Text.UTF8Encoding]::new($false)
  foreach ($asset in $assets) {
    $path = Join-Path $stagingDir $asset.Name
    $content = $downloaded[$asset.Name]
    if (Test-Path -LiteralPath $path) {
      $existing = [System.IO.File]::ReadAllText($path)
      $normalizedExisting = ($existing -replace "`r`n", "`n").TrimEnd("`n")
      $normalizedContent = ($content -replace "`r`n", "`n").TrimEnd("`n")
      # The tracked guard file may be newer than the hosted one (it gains
      # staging-only test flags); accept it only if it passes the same checks.
      $localGuardOk = $asset.Name -eq 'staging-config.js' -and
        $existing -match "REQUIRED_PROJECT\s*=\s*'fun-torah-tools-staging'" -and
        $existing -match 'installNetworkGuards' -and $existing -match 'installFirebaseGuard'
      if ($normalizedExisting -cne $normalizedContent -and -not $localGuardOk) {
        throw "Refusing to overwrite existing local staging asset '$($asset.Name)'."
      }
    } else {
      [System.IO.File]::WriteAllText($path, $content, $encoding)
    }
  }
}

# The preview is deployed from a COPY of the site. Only the copy gets the staging
# bootstrap <script>; the real pages (and so the live site) never load it.
function Build-PreviewSite {
  $build = Join-Path $repoRoot '.preview-build'
  if (Test-Path -LiteralPath $build) { Remove-Item -LiteralPath $build -Recurse -Force }
  New-Item -ItemType Directory -Path $build | Out-Null
  $skipDirs = @('.git', 'node_modules', '_worktrees', '.preview-build', 'staging-results', 'playwright-report', 'test-results',
    'preview-pointer-repair', 'preview-pr234', 'tests', 'e2e', 'e2e-staging', 'docs', 'backup-*')
  & robocopy $repoRoot $build /E /NFL /NDL /NJH /NJS /NP /XD @skipDirs | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Copying the site for the preview failed (robocopy exit code $LASTEXITCODE)." }
  $toolPolicy = Join-Path $build 'backend\functions'
  New-Item -ItemType Directory -Path $toolPolicy -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $repoRoot 'backend\functions\student-tool-policy.js') -Destination $toolPolicy -Force
  & node (Join-Path $repoRoot 'scripts\inject-preview-bootstrap.cjs') $build
  if ($LASTEXITCODE -ne 0) { throw 'Adding the staging bootstrap to the preview copy failed; refusing to deploy.' }
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

  Prepare-StagingBootstrap

  if (-not $SkipFunction) {
    Invoke-FirebaseDeploy @('deploy', '--only', 'functions:homework-staging', '--project', $projectId, '--config', $firebaseConfig, '--non-interactive') 'Staging homework function deploy'
  }

  Build-PreviewSite

  Invoke-FirebaseDeploy @('hosting:channel:deploy', $channelId, '--project', $projectId, '--config', $firebaseConfig, '--expires', '7d', '--non-interactive') 'Staging preview-channel deploy'
} finally {
  if ($null -eq $previousUpdateCheck) { Remove-Item Env:FIREBASE_CLI_DISABLE_UPDATE_CHECK -ErrorAction SilentlyContinue }
  else { $env:FIREBASE_CLI_DISABLE_UPDATE_CHECK = $previousUpdateCheck }
  if ($null -eq $previousDiscoveryTimeout) { Remove-Item Env:FUNCTIONS_DISCOVERY_TIMEOUT -ErrorAction SilentlyContinue }
  else { $env:FUNCTIONS_DISCOVERY_TIMEOUT = $previousDiscoveryTimeout }
  Pop-Location
}
