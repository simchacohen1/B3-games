param(
  # The preview channel to publish to, named after the branch (lowercase, '/' replaced by '-').
  # Default: the current git branch.
  [string]$ChannelName,
  [ValidateRange(1, 30)][int]$ExpiresDays = 7
)

# Publishes the CURRENT checkout to its own Firebase Hosting preview channel on fun-torah-tools-staging.
#
# The site is built with scripts/package-site.cjs, which REPLACES the Firebase settings with the staging project's
# settings at build time. So whatever the channel is called, the preview can never talk to the production Firebase
# project. This script never deploys to the main staging address (the live channel) and never touches functions.
# Before deploying, bring the branch up to date with current origin/main (AGENTS.md).

$ErrorActionPreference = 'Stop'
$projectId = 'fun-torah-tools-staging'
$siteId = 'fun-torah-tools-staging'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$firebaseConfig = Join-Path $repoRoot 'firebase.staging.json'
$buildDir = Join-Path $repoRoot 'staging-build'

if (-not $ChannelName) {
  $branch = (& git -C $repoRoot rev-parse --abbrev-ref HEAD).Trim()
  $ChannelName = ($branch.ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-')
}
if ($ChannelName -notmatch '^[a-z0-9][a-z0-9-]{2,60}$') { throw "Channel name '$ChannelName' may only use lowercase letters, numbers and dashes (3 to 61 characters)." }
if ($ChannelName -in @('live', 'main', 'master', 'staging')) { throw "'$ChannelName' is not allowed: previews never use the main staging address." }

Push-Location $repoRoot
$saved = @{}
$names = 'B3_STAGING_FIREBASE_API_KEY','B3_STAGING_FIREBASE_AUTH_DOMAIN','B3_STAGING_FIREBASE_DATABASE_URL','B3_STAGING_FIREBASE_PROJECT_ID','B3_STAGING_FIREBASE_STORAGE_BUCKET','B3_STAGING_FIREBASE_MESSAGING_SENDER_ID','B3_STAGING_FIREBASE_APP_ID','FIREBASE_CLI_DISABLE_UPDATE_CHECK'
foreach ($n in $names) { $saved[$n] = [Environment]::GetEnvironmentVariable($n) }
try {
  $status = (& git status --porcelain --untracked-files=no) -join "`n"
  if ($status) { Write-Warning 'There are uncommitted changes to tracked files. They are included in the preview (the build uses the working files of tracked paths).' }
  & git fetch origin main --quiet
  & git merge-base --is-ancestor origin/main HEAD
  if ($LASTEXITCODE -ne 0) { throw 'This branch is behind origin/main. Merge the current origin/main into it first, so staging matches live plus the new change.' }

  # The staging web settings are public values served by the staging site itself.
  $response = Invoke-WebRequest -Uri "https://$siteId.web.app/staging/firebase-config.generated.js" -UseBasicParsing -TimeoutSec 30
  $match = [regex]::Match([string]$response.Content, 'Object\.freeze\((\{.*?\})\)')
  if (-not $match.Success) { throw 'Could not read the staging Firebase settings from the staging site; refusing to build.' }
  $cfg = $match.Groups[1].Value | ConvertFrom-Json
  if ($cfg.projectId -ne $projectId -or $cfg.authDomain -ne "$projectId.firebaseapp.com" -or $cfg.databaseURL -ne "https://$projectId-default-rtdb.firebaseio.com" -or -not $cfg.storageBucket.StartsWith("$projectId.")) {
    throw 'The staging settings do not point at the staging project only; refusing to build.'
  }
  $env:B3_STAGING_FIREBASE_API_KEY = $cfg.apiKey
  $env:B3_STAGING_FIREBASE_AUTH_DOMAIN = $cfg.authDomain
  $env:B3_STAGING_FIREBASE_DATABASE_URL = $cfg.databaseURL
  $env:B3_STAGING_FIREBASE_PROJECT_ID = $cfg.projectId
  $env:B3_STAGING_FIREBASE_STORAGE_BUCKET = $cfg.storageBucket
  $env:B3_STAGING_FIREBASE_MESSAGING_SENDER_ID = $cfg.messagingSenderId
  $env:B3_STAGING_FIREBASE_APP_ID = $cfg.appId
  $env:FIREBASE_CLI_DISABLE_UPDATE_CHECK = '1'

  if (Test-Path -LiteralPath $buildDir) { Remove-Item -LiteralPath $buildDir -Recurse -Force }
  & node (Join-Path $repoRoot 'staging/package-site.cjs') $repoRoot $buildDir
  if ($LASTEXITCODE -ne 0) { throw 'Packaging the staging site failed; refusing to deploy.' }

  # Last line of defence: the packaged Firebase settings must be the staging project's, and nothing production.
  $builtConfig = Get-Content -LiteralPath (Join-Path $buildDir 'firebase-config.js') -Raw
  if ($builtConfig -match '(?i)b3-games' -or $builtConfig -notmatch 'B3_STAGING_FIREBASE_CONFIG') {
    throw 'The packaged firebase-config.js is not the staging one; refusing to deploy.'
  }
  $generated = Join-Path $buildDir 'staging/firebase-config.generated.js'
  if (-not (Test-Path -LiteralPath $generated) -or (Get-Content -LiteralPath $generated -Raw) -notmatch [regex]::Escape("`"projectId`":`"$projectId`"")) {
    throw 'The packaged staging settings file is missing or wrong; refusing to deploy.'
  }

  & firebase hosting:channel:deploy $ChannelName --project $projectId --config $firebaseConfig --expires "${ExpiresDays}d" --non-interactive
  if ($LASTEXITCODE -ne 0) { throw "Preview channel deploy failed with Firebase CLI exit code $LASTEXITCODE." }
  Write-Output "Preview channel '$ChannelName' deployed. Delete it when the branch is merged or closed:"
  Write-Output "  firebase hosting:channel:delete $ChannelName --project $projectId"
} finally {
  foreach ($n in $names) { [Environment]::SetEnvironmentVariable($n, $saved[$n]) }
  Pop-Location
}
