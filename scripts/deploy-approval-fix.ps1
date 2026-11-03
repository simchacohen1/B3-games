# Safe, step-by-step deployment of the 2026-10-21 teacher approval repair.
# Run from a local checkout of simchacohen1/B3-games, one phase at a time:
#
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-approval-fix.ps1 -Phase Check
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-approval-fix.ps1 -Phase Backup
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-approval-fix.ps1 -Phase Website
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-approval-fix.ps1 -Phase Function
#
# Never force-pushes. Never changes Firebase rules or any other function.
# Each phase stops on the first problem and asks for a typed confirmation
# before anything goes live.
param(
  [Parameter(Mandatory=$true)][ValidateSet("Check","Backup","Website","Function")][string]$Phase,
  [string]$Branch = "fix/approval-system-verify-20261021",
  [string]$ExpectedBase = "87d1ae55",
  [string]$BackupRoot = (Join-Path $env:USERPROFILE "B3-backups")
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Push-Location $root

# Files this repair is allowed to change. Anything else in the diff stops the deploy.
$Allowed = @(
  "approval-queue.js",
  "index.html",
  "chazara/teacher.html",
  "student-rewards/teacher.html",
  "student-rewards/teacher.js",
  "backend/functions/student-rewards-auto-award.js",
  "tests/approval-queue.test.cjs",
  "tests/approval-queue-browser.test.cjs",
  "docs/OUTSTANDING-shorashim-teacher-approval-mirror.md",
  "docs/APPROVAL-FIX-DEPLOY.md",
  "scripts/deploy-approval-fix.ps1"
)
function Need($cmd,$hint){ if(-not (Get-Command $cmd -ErrorAction SilentlyContinue)){ throw "$cmd is required. $hint" } }
function Confirm-Typed($word,$what){
  Write-Host ""
  Write-Host $what -ForegroundColor Yellow
  $answer = Read-Host "Type $word to continue (anything else cancels)"
  if($answer -ne $word){ throw "Cancelled by owner. Nothing more was changed." }
}
function Run($exe,[string[]]$argv,$fail){ & $exe @argv; if($LASTEXITCODE -ne 0){ throw $fail } }

function Check-Git {
  Need git "Install Git for Windows: https://git-scm.com/download/win"
  Write-Host "Fetching latest GitHub main (read only)..." -ForegroundColor Cyan
  Run git @("fetch","origin","--prune") "git fetch failed."
  git rev-parse --verify --quiet "refs/heads/$Branch" | Out-Null
  if($LASTEXITCODE -ne 0){ throw "Local branch $Branch not found." }
  $main = (git rev-parse origin/main).Trim()
  $head = (git rev-parse $Branch).Trim()
  Write-Host "origin/main : $(git log --oneline -1 origin/main)"
  Write-Host "repair head : $(git log --oneline -1 $Branch)"
  git merge-base --is-ancestor origin/main $Branch
  if($LASTEXITCODE -ne 0){
    Write-Host "GitHub main has NEW commits that this branch doesn't contain:" -ForegroundColor Red
    git log --oneline "$Branch..origin/main"
    throw "STOP: main moved. Do not push. Ask Claude to rebase the repair onto the new main and re-test."
  }
  $mainShort = (git rev-parse --short=8 origin/main).Trim()
  if($mainShort -ne $ExpectedBase){ Write-Host "Note: origin/main is $mainShort (plan was written against $ExpectedBase) but the push is still a fast-forward." -ForegroundColor Yellow }
  $changed = git diff --name-only "origin/main..$Branch"
  $unexpected = $changed | Where-Object { $Allowed -notcontains $_ }
  if($unexpected){ throw "STOP: unexpected files in the repair: $($unexpected -join ', ')" }
  Write-Host "Push is a fast-forward and only touches the approval files:" -ForegroundColor Green
  $changed | ForEach-Object { Write-Host "  $_" }
}
function Run-Tests {
  Need node "Install Node.js LTS."
  Write-Host "Running focused approval tests from the repair branch..." -ForegroundColor Cyan
  $tmp = Join-Path $env:TEMP ("b3-approval-check-" + [guid]::NewGuid().ToString("N").Substring(0,8))
  Run git @("worktree","add","--detach",$tmp,$Branch) "Could not create a temporary test copy."
  try{
    Push-Location $tmp
    foreach($f in @("approval-queue.js","student-rewards/teacher.js","backend/functions/student-rewards-auto-award.js")){ Run node @("--check",$f) "Syntax check failed: $f" }
    Run node @("--test","tests/approval-queue.test.cjs","tests/chazara-owner-self-heal.test.cjs","tests/chazara-teacher-scope.test.cjs") "Approval tests failed; deployment canceled."
    Pop-Location
  } finally { git worktree remove --force $tmp 2>$null | Out-Null }
}

try{
  switch($Phase){
    "Check" {
      Check-Git
      Run-Tests
      Write-Host ""
      Write-Host "GitHub sign-in check (no push):" -ForegroundColor Cyan
      git ls-remote --heads origin main | Out-Null
      if($LASTEXITCODE -eq 0){ Write-Host "  GitHub reachable." -ForegroundColor Green }
      $helper = (git config --get credential.helper)
      Write-Host "  credential helper: $(if($helper){$helper}else{'(none set: Git will ask on first push)'})"
      Write-Host ""
      Write-Host "Firebase CLI check:" -ForegroundColor Cyan
      if(Get-Command firebase -ErrorAction SilentlyContinue){
        firebase --version
        firebase login:list
      } else { Write-Host "  Firebase CLI not on PATH. Install: npm install -g firebase-tools" -ForegroundColor Yellow }
      Write-Host ""
      Write-Host "CHECK PASSED. Nothing was changed." -ForegroundColor Green
    }
    "Backup" {
      Check-Git
      $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
      $dir = Join-Path $BackupRoot "approval-fix-$stamp"
      New-Item -ItemType Directory -Force -Path $dir | Out-Null
      Write-Host "Backup folder (private: contains student point data, do NOT commit or share): $dir" -ForegroundColor Cyan
      # 1. Website: tag the exact live commit so it can always be restored.
      $tag = "backup/main-before-approval-fix-$stamp"
      Run git @("tag",$tag,"origin/main") "Could not create backup tag."
      (git rev-parse origin/main).Trim() | Set-Content (Join-Path $dir "website-main-commit.txt")
      Write-Host "Created local tag $tag at $(git log --oneline -1 origin/main)"
      Confirm-Typed "TAG" "Push the backup tag $tag to GitHub? (Adds a tag only; main is not changed.)"
      Run git @("push","origin","refs/tags/$tag") "Tag push failed (check GitHub sign-in)."
      $tag | Set-Content (Join-Path $dir "website-backup-tag.txt")
      # 2. Firebase: function inventory + point data snapshot (read only).
      Need firebase "Install with: npm install -g firebase-tools, then run: firebase login"
      firebase functions:list --project b3-games *> (Join-Path $dir "functions-list.txt")
      if($LASTEXITCODE -ne 0){ throw "Could not list functions. Run 'firebase login' with the owner account first." }
      Write-Host "Saving read-only snapshots of Student Rewards point requests and balances..." -ForegroundColor Cyan
      Run firebase @("database:get","/studentRewards/pointRequests","--project","b3-games","--output",(Join-Path $dir "pointRequests.json")) "Point request backup failed."
      Run firebase @("database:get","/studentRewards/students","--project","b3-games","--output",(Join-Path $dir "students.json")) "Student balance backup failed."
      Get-ChildItem $dir | ForEach-Object { if(-not $_.PSIsContainer){ "{0}  {1}  {2}" -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash, $_.Length, $_.Name } } | Set-Content (Join-Path $dir "SHA256SUMS.txt")
      Write-Host ""
      Write-Host "BACKUP DONE: $dir" -ForegroundColor Green
      Write-Host "Also download the deployed function source as described in docs/APPROVAL-FIX-DEPLOY.md, step 3c." -ForegroundColor Yellow
    }
    "Website" {
      Check-Git
      Run-Tests
      Confirm-Typed "PUBLISH" "Fast-forward GitHub main to $Branch? funtorahtools.com updates within a few minutes. (No force push. Git will refuse if main changed.)"
      Run git @("push","origin","refs/heads/${Branch}:refs/heads/main") "Push refused. Main probably changed; nothing was overwritten. Run -Phase Check again."
      Write-Host "Website published. Wait about 2-5 minutes, then do the live checks in docs/APPROVAL-FIX-DEPLOY.md." -ForegroundColor Green
    }
    "Function" {
      Need firebase "Install with: npm install -g firebase-tools"
      Need npm "Install Node.js LTS."
      Check-Git
      git merge-base --is-ancestor $Branch origin/main
      if($LASTEXITCODE -ne 0){ throw "Publish the website first (-Phase Website), so the deployed function matches GitHub main." }
      Run-Tests
      Write-Host "Signed-in Firebase account(s):" -ForegroundColor Cyan
      firebase login:list
      $tmp = Join-Path $env:TEMP ("b3-approval-fn-" + [guid]::NewGuid().ToString("N").Substring(0,8))
      Run git @("worktree","add","--detach",$tmp,"origin/main") "Could not create a clean copy of main."
      try{
        Push-Location $tmp
        Write-Host "Installing locked function dependencies..." -ForegroundColor Cyan
        Run npm @("--prefix","backend/functions","ci") "npm ci failed; deployment canceled."
        Confirm-Typed "DEPLOY" "Deploy ONLY functions:studentRewardsAutoAward to project b3-games from a clean copy of GitHub main?"
        Run firebase @("deploy","--only","functions:studentRewardsAutoAward","--project","b3-games") "Firebase deploy failed. Nothing else was changed."
        Pop-Location
      } finally { git worktree remove --force $tmp 2>$null | Out-Null }
      Write-Host "Function deployed. Do the live checks in docs/APPROVAL-FIX-DEPLOY.md." -ForegroundColor Green
    }
  }
} finally { Pop-Location }
