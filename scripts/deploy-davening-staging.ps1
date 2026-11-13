# Deploys the Davening Chazzan feature (issue #799) and Chayus Meter (issue #802)
# to the STAGING project only, for testing with the fictional accounts.
#
#   1. Functions: builds the Davening-only codebase from backend/functions
#      (staging/build-davening-functions.cjs) and deploys it as its own codebase
#      'davening-staging'. The existing staging functions are untouched.
#   2. Hosting: packages THIS checkout with staging/package-site.cjs (production
#      URLs rewritten to staging) and deploys it to the PREVIEW CHANNEL
#      'davening-799'. The live staging site is not replaced, so features other
#      branches put on staging stay as they are.
#
# Never touches production, database rules, or the 'staging' functions codebase.
# The fictional classes TEST-ALEF (ET page) and TEST-BEIS (WT page) need the
# 'davening' tool grant in the staging database.
param(
  [switch]$SkipFunctions,
  [switch]$SkipHosting
)

$ErrorActionPreference = 'Stop'
$projectId = 'fun-torah-tools-staging'
$channelId = 'davening-799'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repoRoot

function Invoke-Checked([string]$Description, [scriptblock]$Command) {
  Write-Output "== $Description"
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "$Description failed (exit code $LASTEXITCODE)." }
}

if (-not $SkipFunctions) {
  $out = Join-Path $repoRoot '.staging-davening'
  Invoke-Checked 'Build Davening-only functions' { node staging/build-davening-functions.cjs $out }
  # The Firebase CLI loads the code locally to find its functions, so it needs
  # the two Firebase packages. They are deleted again afterwards (disk space).
  try {
    Invoke-Checked 'Install function dependencies' { npm ci --omit=dev --no-audit --no-fund --prefix $out }
    Invoke-Checked 'Deploy Davening functions to staging' {
      firebase deploy --config firebase.staging-davening.json --project $projectId --only functions:davening-staging --non-interactive
    }
  } finally {
    $modules = Join-Path $out 'node_modules'
    if (Test-Path -LiteralPath $modules) { Remove-Item -LiteralPath $modules -Recurse -Force }
  }
}

if (-not $SkipHosting) {
  # The public web config comes from the live staging site, as in the other staging scripts.
  $generated = (Invoke-WebRequest -Uri "https://$projectId.web.app/staging/firebase-config.generated.js" -UseBasicParsing -TimeoutSec 30).Content
  $match = [regex]::Match([string]$generated, 'B3_STAGING_FIREBASE_CONFIG = Object\.freeze\((\{.*?\})\)')
  if (-not $match.Success) { throw 'Could not read the staging Firebase config; refusing to deploy.' }
  $config = $match.Groups[1].Value | ConvertFrom-Json
  if ($config.projectId -ne $projectId) { throw 'Staging Firebase config names another project; refusing to deploy.' }
  $env:B3_STAGING_FIREBASE_API_KEY = $config.apiKey
  $env:B3_STAGING_FIREBASE_AUTH_DOMAIN = $config.authDomain
  $env:B3_STAGING_FIREBASE_DATABASE_URL = $config.databaseURL
  $env:B3_STAGING_FIREBASE_PROJECT_ID = $config.projectId
  $env:B3_STAGING_FIREBASE_STORAGE_BUCKET = $config.storageBucket
  $env:B3_STAGING_FIREBASE_MESSAGING_SENDER_ID = $config.messagingSenderId
  $env:B3_STAGING_FIREBASE_APP_ID = $config.appId

  $build = Join-Path $repoRoot 'staging-build'
  if (Test-Path -LiteralPath $build) { Remove-Item -LiteralPath $build -Recurse -Force }
  Invoke-Checked 'Package staging site' { node staging/package-site.cjs $repoRoot $build }
  try {
    Invoke-Checked 'Deploy staging preview channel' {
      firebase hosting:channel:deploy $channelId --config firebase.staging-davening.json --project $projectId --expires 7d --non-interactive
    }
  } finally {
    Remove-Item -LiteralPath $build -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Write-Output "Done. Open the preview channel link printed above, then /davening_student_app_et/ or /davening_student_app_wt/."
