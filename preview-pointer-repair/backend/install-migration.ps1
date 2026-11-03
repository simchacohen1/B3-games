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
$base = 'https://raw.githubusercontent.com/simchacohen1/B3-games/66fc66218f21d52bcb5198419ba501a0fd07d7c9/backend/functions'
$files = @('yiddish.js','yiddish-service/core.cjs','yiddish-service/site-policy.js','yiddish-service/words.json','teacher-claim.js','teacher-claim-core.cjs','student-management.js','student-management-core.cjs')
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
    foreach ($item in @(@('yiddishApi','yiddish'),@('funTorahTeacherClaim','teacher-claim'),@('funTorahManageStudents','student-management'))) {
        if ($source -notmatch ('exports\.' + $item[0] + '\s*=')) {
            $source += "`nexports.$($item[0]) = require('./$($item[1])').$($item[0]);`n"
        }
    }
    [System.IO.File]::WriteAllText($entrypoint, $source, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "Installed migration source. Backup: $backup"
    Write-Host 'Nothing has been deployed. Run from this project directory:'
    Write-Host 'firebase login'
    Write-Host 'firebase deploy --only functions:yiddishApi,functions:funTorahTeacherClaim,functions:funTorahManageStudents --project b3-games'
} finally {
    Remove-Item $stage -Recurse -Force
}
