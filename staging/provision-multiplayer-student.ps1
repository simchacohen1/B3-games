param(
  [string]$ProjectId = 'fun-torah-tools-staging',
  [string]$StudentId = 'test_student_alef2',
  [string]$StudentName = 'Test Student A2'
)

$ErrorActionPreference = 'Stop'
$expectedProject = 'fun-torah-tools-staging'
$workspaceId = 'b3-2026'
$classId = 'TEST-ALEF'
$allowedStudents = @{
  'test_student_alef2' = 'Test Student A2'
  'test_student_alef3' = 'Test Student A3'
}
if (-not $allowedStudents.ContainsKey($StudentId) -or $allowedStudents[$StudentId] -ne $StudentName) {
  throw 'Only the documented fictional TEST-ALEF staging students can be provisioned.'
}
$databaseUrl = 'https://fun-torah-tools-staging-default-rtdb.firebaseio.com'
$credentialsPath = Join-Path $PSScriptRoot 'test-credentials.local.json'

if ($ProjectId -ne $expectedProject) { throw 'Refusing to provision outside the approved staging Firebase project.' }
if (-not (Test-Path -LiteralPath $credentialsPath)) { throw 'The ignored staging test credentials file must be present before adding the second student.' }
$project = gcloud projects describe $expectedProject --format='value(projectId)'
if ($LASTEXITCODE -ne 0 -or $project -ne $expectedProject) { throw 'Could not confirm access to the approved staging project.' }
$token = gcloud auth application-default print-access-token
if ($LASTEXITCODE -ne 0 -or $token.Length -lt 20) { throw 'Application Default Credentials are unavailable.' }
$headers = @{ Authorization = "Bearer $token"; 'x-goog-user-project' = $expectedProject }
$class = Invoke-RestMethod -Method Get -Uri "$databaseUrl/b3Games/workspaces/$workspaceId/classes/$classId.json" -Headers $headers
if ($class.name -ne 'Test Class Alef' -or $class.active -ne $true) { throw 'The target class does not match the fictional TEST-ALEF staging fixture.' }
$existingProfile = Invoke-RestMethod -Method Get -Uri "$databaseUrl/b3Games/students/$studentId/profile.json" -Headers $headers
if ($existingProfile -and ($existingProfile.name -ne $studentName -or $existingProfile.classId -ne $classId)) {
  throw 'Refusing to modify a student record that does not match the expected fictional TEST-ALEF account.'
}
$credentials = Get-Content -LiteralPath $credentialsPath -Raw | ConvertFrom-Json
if (-not $credentials.studentAccounts -or -not $credentials.adultAccounts) { throw 'The staging credentials file is incomplete.' }
$pin = ($credentials.studentAccounts | Where-Object { $_.name -eq $studentName -and $_.classId -eq $classId } | Select-Object -First 1).passcode
if (-not $pin) {
  $usedPins = Invoke-RestMethod -Method Get -Uri "$databaseUrl/b3Private/passcodes.json" -Headers $headers
  do {
    $bytes = [byte[]]::new(4)
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    $pin = (100000 + ([BitConverter]::ToUInt32($bytes, 0) % 900000)).ToString()
  } while (@($usedPins.PSObject.Properties | Where-Object { $_.Value.passcode -eq $pin }).Count -gt 0)
}
$timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$membership = @{ workspaceId = $workspaceId; classId = $classId; active = $true }
$member = @{ active = $true; name = $studentName; studentId = $studentId; toolAccess = @{ 'multiplayer-center' = $true } }
$passcode = @{ passcode = $pin; updatedAt = $timestamp; chosenPinVersion = 1 }
$contentType = 'application/json'
function Write-StagingJson([string]$Path, $Body) {
  $json = ConvertTo-Json -InputObject $Body -Depth 20 -Compress
  Invoke-RestMethod -Method Put -Uri "$databaseUrl/$Path.json?print=silent" -Headers $headers -ContentType 'application/json' -Body $json | Out-Null
}
Write-StagingJson "b3Games/students/$studentId/profile" @{ id = $studentId; name = $studentName; active = $true; classId = $classId }
Write-StagingJson "b3Games/students/$studentId/memberships/${workspaceId}_${classId}" $membership
Write-StagingJson "b3Games/workspaces/$workspaceId/classes/$classId/members/$studentId" $member
Write-StagingJson "b3Private/passcodes/$studentId" $passcode
Invoke-RestMethod -Method Patch -Uri "$databaseUrl/b3Games/workspaces/$workspaceId/classes/$classId/toolGrants.json?print=silent" -Headers $headers -ContentType $contentType -Body '{"multiplayer-center":true}' | Out-Null
$credentials.studentAccounts = @($credentials.studentAccounts | Where-Object { $_.name -ne $studentName }) + @([pscustomobject]@{ name = $studentName; passcode = $pin; classId = $classId })
$serializedCredentials = ConvertTo-Json -InputObject $credentials -Depth 12 -Compress
[System.IO.File]::WriteAllText($credentialsPath, $serializedCredentials, [System.Text.UTF8Encoding]::new($false))
Write-Output "Provisioned $StudentName as a fictional TEST-ALEF student and enabled Multiplayer Center for this staging class."
