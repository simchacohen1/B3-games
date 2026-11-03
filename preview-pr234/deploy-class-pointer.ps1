# Deploy only the Classroom Pointer activity-share authorization and ticket cleanup functions.
# Run in a local checkout of simchacohen1/B3-games.
# Does not change Firebase Database rules, other functions, or GitHub Pages.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $root
try {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js is required." }
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "npm is required." }
  if (-not (Get-Command firebase -ErrorAction SilentlyContinue)) {
    throw "Firebase CLI is required. Install with: npm install -g firebase-tools"
  }
  Write-Host "Checking Classroom Pointer JavaScript..." -ForegroundColor Cyan
  $scripts = @(
    "class-pointer-prototype/activity-share.js",
    "class-pointer-prototype/activity-screen-teacher.js",
    "class-pointer-prototype/classroom.js",
    "class-pointer-prototype/student-boards.js",
    "backend/functions/class-pointer-share-auth.js",
    "backend/functions/class-pointer-share-ticket-cleanup.js"
  )
  foreach ($script in $scripts) {
    & node --check $script
    if ($LASTEXITCODE -ne 0) { throw "Syntax check failed: $script" }
  }
  & node --test tests/class-pointer-workspace-regression.test.cjs tests/class-pointer-share-ticket-retry.test.cjs tests/class-pointer-ticket-cleanup.test.cjs tests/class-pointer-session-rules.test.cjs
  if ($LASTEXITCODE -ne 0) { throw "Classroom Pointer tests failed; deployment canceled." }
  Write-Host "Installing locked Firebase function dependencies..." -ForegroundColor Cyan
  & npm --prefix backend/functions ci
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed; deployment canceled." }
  Write-Host "Deploying ONLY Class Pointer sharing functions to project b3-games..." -ForegroundColor Cyan
  & firebase deploy --only functions:classPointerShareAuth,functions:cleanupClassPointerShareTickets --project b3-games
  if ($LASTEXITCODE -ne 0) { throw "Firebase deployment failed. Check firebase login and permissions." }
  Write-Host "Firebase CLI reported success. Perform a teacher/student screen-sharing test." -ForegroundColor Green
  Write-Host "Function: https://us-central1-b3-games.cloudfunctions.net/classPointerShareAuth"
  Write-Host "Scheduled cleanup: cleanupClassPointerShareTickets (every 15 minutes)"
}
finally {
  Pop-Location
}
