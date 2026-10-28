param([string]$ProjectId = 'fun-torah-tools-staging')
$ErrorActionPreference = 'Stop'
$expected = 'fun-torah-tools-staging'
if ($ProjectId -ne $expected) { throw 'Refusing to change any project except the fictional staging project.' }
$base = 'https://fun-torah-tools-staging-default-rtdb.firebaseio.com'
$fixture = Get-Content (Join-Path $PSScriptRoot 'fictional-accounts.json') -Raw | ConvertFrom-Json
if ($fixture.workspaceId -ne 'b3-2026') { throw 'Unexpected fixture workspace.' }
$token = gcloud auth application-default print-access-token
if ($LASTEXITCODE -ne 0 -or $token.Length -lt 20) { throw 'Staging Google credentials are required.' }
$headers = @{ Authorization = "Bearer $token"; 'x-goog-user-project' = $expected }
$meta = Invoke-RestMethod -Method Get -Uri "$base/b3Games/stagingMetadata.json" -Headers $headers
if (-not $meta -or $meta.syntheticOnly -ne $true -or $meta.seedVersion -ne 1) {
  throw 'Existing staging database has not been verified as the fictional-only fixture.'
}
$classes = Invoke-RestMethod -Method Get -Uri "$base/b3Games/workspaces/b3-2026/classes.json" -Headers $headers
if (-not $classes) { throw 'No fictional staging classes found. Provision fictional accounts first.' }
$actual = @($classes.PSObject.Properties.Name | Sort-Object)
$expectedIds = @($fixture.roles | ForEach-Object { $_.classId } | Sort-Object)
if (@(Compare-Object $actual $expectedIds).Count -ne 0) {
  throw 'Staging classes differ from the exact fictional fixture; refusing updates.'
}
foreach ($role in $fixture.roles) {
  $class = $classes.PSObject.Properties[$role.classId].Value
  if ($class.name -ne $role.className -or $class.active -ne $true) {
    throw "Fictional class mismatch: $($role.classId)"
  }
  $members = @($class.members.PSObject.Properties.Name | Sort-Object)
  $expectedMembers = @($fixture.students | Where-Object classId -eq $role.classId | ForEach-Object { $_.id } | Sort-Object)
  if (@(Compare-Object $members $expectedMembers).Count -ne 0) {
    throw "Unexpected student membership in $($role.classId); refusing updates."
  }
}
foreach ($role in $fixture.roles) {
  $classId = $role.classId
  Invoke-RestMethod -Method Put -Uri "$base/b3Games/workspaces/b3-2026/classes/$classId/toolGrants/class-pointer.json" -Headers $headers -ContentType 'application/json' -Body 'true' | Out-Null
  Write-Output "Enabled Class Pointer for fictional staging class $classId"
}
Write-Output 'All fictional staging class grants verified and updated.'
