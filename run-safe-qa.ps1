# Runs ONLY the isolated Playwright suite and synthetic Firebase emulator suites.
# Never runs the unreviewed default Playwright suite or connects to production.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$previousDb = $env:B3_RUN_RTDB_EMULATOR_TESTS
$previousStorage = $env:B3_RUN_STORAGE_EMULATOR_TESTS
$failures = @()
try {
  Write-Host "1/4: Offline browser checks" -ForegroundColor Cyan
  & npx playwright test --config=playwright.safe.config.ts
  if ($LASTEXITCODE -ne 0) { $failures += 'Offline browser checks' }

  Write-Host "2/4: Synthetic database security checks" -ForegroundColor Cyan
  $env:B3_RUN_RTDB_EMULATOR_TESTS = '1'
  & npx firebase emulators:exec --config firebase.security-test.json --project demo-b3-security --only database "node --test tests/security-rules-emulator.test.cjs"
  if ($LASTEXITCODE -ne 0) { $failures += 'Database security checks' }

  Write-Host "3/4: Synthetic storage security checks" -ForegroundColor Cyan
  $env:B3_RUN_STORAGE_EMULATOR_TESTS = '1'
  & npx firebase emulators:exec --config firebase.security-test.json --project demo-b3-security --only storage "node --test tests/storage-rules-emulator.test.cjs"
  if ($LASTEXITCODE -ne 0) { $failures += 'Storage security checks' }
  Write-Host "4/4: Synthetic sign-in benchmark" -ForegroundColor Cyan
  & node scripts/benchmark-student-signin.cjs
  if ($LASTEXITCODE -ne 0) { $failures += 'Sign-in benchmark' }
}
finally {
  $env:B3_RUN_RTDB_EMULATOR_TESTS = $previousDb
  $env:B3_RUN_STORAGE_EMULATOR_TESTS = $previousStorage
}
if ($failures.Count) {
  Write-Host ("FAILED: " + ($failures -join ', ')) -ForegroundColor Red
  exit 1
}
Write-Host "All three suites completed successfully." -ForegroundColor Green
