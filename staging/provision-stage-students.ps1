# Adds the two fictional students used by the owner's local Playwright suite
# (ftt-tests, issue #698) to the STAGING project only:
#   Stage student A  (stage_student_a)
#   Stage student B  (stage_student_b)
# Both join the fictional class TEST-ALEF (Test Teacher Alef), and that class
# gets the Posuk Practice grant so the staging tests can open Posuk Practice.
#
# Safe to run again: an existing Stage student keeps its passcode (read from
# the credentials file) and nothing outside these records is changed.
# Passcodes are written ONLY to the local file named by -CredentialsOut.
# Never commit or post that file.
param(
  [Parameter(Mandatory = $true)][string]$CredentialsOut,
  [string]$ProjectId = 'fun-torah-tools-staging'
)

$ErrorActionPreference = 'Stop'
$expectedProject = 'fun-torah-tools-staging'
$workspaceId = 'b3-2026'
$classId = 'TEST-ALEF'
$databaseUrl = 'https://fun-torah-tools-staging-default-rtdb.firebaseio.com'
$students = @(
  @{ id = 'stage_student_a'; name = 'Stage student A' },
  @{ id = 'stage_student_b'; name = 'Stage student B' }
)

if ($ProjectId -ne $expectedProject) { throw 'Refusing to provision outside the approved staging Firebase project.' }
$project = gcloud projects describe $expectedProject --format='value(projectId)'
if ($LASTEXITCODE -ne 0 -or $project -ne $expectedProject) { throw 'Could not confirm access to the approved staging project.' }
$token = gcloud auth application-default print-access-token
if ($LASTEXITCODE -ne 0 -or $token.Length -lt 20) { throw 'Application Default Credentials are unavailable.' }
$headers = @{ Authorization = "Bearer $token"; 'x-goog-user-project' = $expectedProject }

function Get-StagingJson([string]$Path) {
  return Invoke-RestMethod -Method Get -Uri "$databaseUrl/$Path.json" -Headers $headers
}
function Write-StagingJson([string]$Method, [string]$Path, $Body) {
  $json = ConvertTo-Json -InputObject $Body -Depth 20 -Compress
  Invoke-RestMethod -Method $Method -Uri "$databaseUrl/$Path.json?print=silent" -Headers $headers -ContentType 'application/json' -Body $json | Out-Null
}

$class = Get-StagingJson "b3Games/workspaces/$workspaceId/classes/$classId"
if ($class.name -ne 'Test Class Alef' -or $class.active -ne $true) { throw 'The target class does not match the fictional TEST-ALEF staging fixture.' }

$saved = @()
if (Test-Path -LiteralPath $CredentialsOut) {
  $saved = @((Get-Content -LiteralPath $CredentialsOut -Raw | ConvertFrom-Json).students)
}
$usedPins = Get-StagingJson 'b3Private/passcodes'
$timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$out = @()

foreach ($student in $students) {
  $id = $student.id; $name = $student.name
  $profile = Get-StagingJson "b3Games/students/$id/profile"
  if ($profile -and ($profile.name -ne $name -or $profile.classId -ne $classId)) {
    throw "Refusing to modify $id because it does not match the expected fictional Stage student."
  }
  $pin = ($saved | Where-Object { $_.name -eq $name } | Select-Object -First 1).passcode
  if ($profile -and -not $pin) {
    throw "$name already exists on staging but its passcode is not in $CredentialsOut. Delete the student on staging or restore the file."
  }
  if (-not $pin) {
    do {
      $bytes = [byte[]]::new(4)
      [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
      $pin = (100000 + ([BitConverter]::ToUInt32($bytes, 0) % 900000)).ToString()
    } while (@($usedPins.PSObject.Properties | Where-Object { $_.Value.passcode -eq $pin }).Count -gt 0)
  }
  Write-StagingJson Put "b3Games/students/$id/profile" @{ id = $id; name = $name; active = $true; classId = $classId }
  Write-StagingJson Put "b3Games/students/$id/memberships/${workspaceId}_${classId}" @{ workspaceId = $workspaceId; classId = $classId; active = $true }
  Write-StagingJson Put "b3Games/workspaces/$workspaceId/classes/$classId/members/$id" @{ active = $true; name = $name; studentId = $id }
  # chosenPinVersion stops the site asking the test student to pick a new passcode.
  Write-StagingJson Put "b3Private/passcodes/$id" @{ passcode = $pin; updatedAt = $timestamp; chosenPinVersion = 1 }
  $out += [pscustomobject]@{ id = $id; name = $name; passcode = $pin; classId = $classId }
}

# Class-level grant: Posuk Practice (and its Mishnayos companion) for TEST-ALEF.
Write-StagingJson Patch "b3Games/workspaces/$workspaceId/classes/$classId/toolGrants" @{ 'posuk-practice-scroll' = $true }
Write-StagingJson Patch "b3Games/siteSettings/classGames/$classId" @{ 'posuk-practice-scroll' = $true }
# A class with its own space starts with no pesukim open. Open Bereishis 1:1-31
# for the tests, but never replace a window the staging teacher already chose.
$limit = Get-StagingJson "b3Games/workspaces/$workspaceId/classes/$classId/posukPracticeLimit"
if (-not $limit) {
  Write-StagingJson Put "b3Games/workspaces/$workspaceId/classes/$classId/posukPracticeLimit" @{
    startSefer = 'Bereishis'; startPerek = 1; startPosuk = 1; endSefer = 'Bereishis'; endPerek = 1; endPosuk = 31; updatedAt = $timestamp
  }
}

$dir = Split-Path -Parent $CredentialsOut
if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
$json = ConvertTo-Json -InputObject @{ website = 'https://fun-torah-tools-staging.web.app'; students = $out } -Depth 6
[System.IO.File]::WriteAllText($CredentialsOut, $json, [System.Text.UTF8Encoding]::new($false))
Write-Output "Provisioned Stage student A and Stage student B in staging TEST-ALEF. Passcodes saved to $CredentialsOut (keep private)."
