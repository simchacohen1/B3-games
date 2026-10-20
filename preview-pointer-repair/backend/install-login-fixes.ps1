param([string]$ProjectDirectory = 'C:\B3-Games-Backend')
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path $ProjectDirectory).Path
$functions = Join-Path $project 'functions'
$entrypoint = Join-Path $functions 'index.js'
if (!(Test-Path (Join-Path $project 'firebase.json')) -or !(Test-Path $entrypoint)) {
    throw 'Choose the existing Firebase project directory containing firebase.json and functions/index.js.'
}
$projectConfig = Get-Content (Join-Path $project '.firebaserc') -Raw | ConvertFrom-Json
if ($projectConfig.projects.default -ne 'b3-games') { throw 'This installer is only for the b3-games Firebase project.' }
$base = 'https://raw.githubusercontent.com/simchacohen1/B3-games/main/backend/functions'
$files = @('student-login-core.cjs','student-rewards-functions.js','student-rewards-auto-award.js')
$stage = Join-Path ([System.IO.Path]::GetTempPath()) ('FunTorahMigration-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
try {
    foreach ($file in $files) {
        $staged = Join-Path $stage $file
        New-Item -ItemType Directory -Path (Split-Path $staged) -Force | Out-Null
        Invoke-WebRequest -UseBasicParsing -Uri "$base/$file" -OutFile $staged
    }
    $backup = Join-Path $project ('migration-backups/' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    Copy-Item $entrypoint (Join-Path $backup 'index.js')
    foreach ($file in $files) {
        $target = Join-Path $functions $file
        if (Test-Path $target) {
            $saved = Join-Path $backup $file
            New-Item -ItemType Directory -Path (Split-Path $saved) -Force | Out-Null
            Copy-Item $target $saved
        }
        New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
        Copy-Item (Join-Path $stage $file) $target
    }
    $source = [System.IO.File]::ReadAllText($entrypoint)
    foreach ($item in @(@('studentRewardsLogin','student-rewards-functions'),@('studentRewardsAutoAward','student-rewards-auto-award'))) {
        if ($source -notmatch ('exports\.' + $item[0] + '\s*=')) {
            $source += "`nexports.$($item[0]) = require('./$($item[1])').$($item[0]);`n"
        }
    }
    [System.IO.File]::WriteAllText($entrypoint, $source, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "Installed student login fixes. Backup: $backup"
    Write-Host 'Nothing has been deployed. Run from this project directory:'
    Write-Host 'firebase.cmd login'
    Write-Host 'firebase.cmd deploy --only "functions:studentRewardsLogin,functions:studentRewardsAutoAward" --project b3-games'
} finally {
    Remove-Item $stage -Recurse -Force
}
