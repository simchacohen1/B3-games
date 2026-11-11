# Deploys Pasuk Practice grading to the STAGING project only (issue #107).
#
#   1. Functions: builds the grading-only codebase from backend/functions/index.js
#      (staging/build-posuk-grading-functions.cjs) and deploys it as its own
#      codebase 'posuk-grading-staging'. The existing staging functions are untouched.
#   2. Hosting: packages THIS checkout with staging/package-site.cjs (production
#      URLs rewritten to staging) and deploys it to https://fun-torah-tools-staging.web.app.
#
# Never touches production, database rules or the 'staging' functions codebase.
# Needs on the staging project: the ANTHROPIC_API_KEY secret and the Cloud
# Speech-to-Text API enabled.
param(
  [switch]$SkipFunctions,
  [switch]$SkipHosting
)

$ErrorActionPreference = 'Stop'
$projectId = 'fun-torah-tools-staging'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repoRoot

function Invoke-Checked([string]$Description, [scriptblock]$Command) {
  Write-Output "== $Description"
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "$Description failed (exit code $LASTEXITCODE)." }
}

if (-not $SkipFunctions) {
  # Also proves this Firebase login can reach the staging project.
  Invoke-Checked 'Check ANTHROPIC_API_KEY secret on staging' {
    firebase functions:secrets:get ANTHROPIC_API_KEY --project $projectId
  }
  $out = Join-Path $repoRoot '.staging-posuk-grading'
  Invoke-Checked 'Build grading-only functions' { node staging/build-posuk-grading-functions.cjs $out }
  # The Firebase CLI loads the code locally to find its functions, so it needs
  # the production dependencies. They are deleted again afterwards (disk space).
  try {
    Invoke-Checked 'Install function dependencies' { npm ci --omit=dev --no-audit --no-fund --prefix $out }
    Invoke-Checked 'Deploy grading functions to staging' {
      firebase deploy --config firebase.staging-posuk-grading.json --project $projectId --only functions:posuk-grading-staging --force
    }
  } finally {
    $modules = Join-Path $out 'node_modules'
    if (Test-Path -LiteralPath $modules) { Remove-Item -LiteralPath $modules -Recurse -Force }
  }
}

if (-not $SkipHosting) {
  # The public web config comes from the live staging site, as in the Homework preview script.
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
    Invoke-Checked 'Deploy staging Hosting' {
      firebase deploy --config firebase.staging.json --project $projectId --only hosting
    }
  } finally {
    Remove-Item -LiteralPath $build -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Write-Output "Done. Staging: https://$projectId.web.app/record_pesukim/student.html"
