param(
  [string]$ProjectId = 'fun-torah-tools-staging'
)

$ErrorActionPreference = 'Stop'
$ExpectedProject = 'fun-torah-tools-staging'
$DatabaseUrl = 'https://fun-torah-tools-staging-default-rtdb.firebaseio.com'
$AccountsFixture = Join-Path $PSScriptRoot 'fictional-accounts.json'

if ($ProjectId -ne $ExpectedProject) { throw 'Refusing to provision accounts outside the approved staging project.' }
$billing = gcloud billing projects describe $ExpectedProject --format=json | ConvertFrom-Json
if (-not $billing.billingEnabled -or $billing.projectId -ne $ExpectedProject) { throw 'Staging Blaze billing is not enabled for the expected project.' }

$token = gcloud auth application-default print-access-token
if ($LASTEXITCODE -ne 0 -or $token.Length -lt 20) { throw 'Google Application Default Credentials are unavailable.' }
$headers = @{ Authorization = "Bearer $token"; 'x-goog-user-project' = $ExpectedProject }
$authConfig = Invoke-RestMethod -Method Get -Uri "https://identitytoolkit.googleapis.com/admin/v2/projects/$ExpectedProject/config" -Headers $headers
if ($authConfig.signIn.email.enabled -ne $true) { throw 'Email/password Auth must be enabled on staging before seeding fictional users.' }
if ($authConfig.authorizedDomains -notcontains "$ExpectedProject.web.app") { throw 'Staging Hosting domain is not authorized in Firebase Auth.' }

$root = Invoke-RestMethod -Method Get -Uri "$DatabaseUrl/.json?shallow=true" -Headers $headers
if ($null -ne $root -and @($root.PSObject.Properties).Count -gt 0) {
  throw 'Staging b3Games already contains data. No records were overwritten; inspect the staging project before seeding.'
}

$apps = Invoke-RestMethod -Method Get -Uri "https://firebase.googleapis.com/v1beta1/projects/$ExpectedProject/webApps" -Headers $headers
$webApp = @($apps.apps | Where-Object { $_.appId -like '*:web:*' }) | Select-Object -First 1
if (-not $webApp) { throw 'No staging Firebase Web app is registered.' }
$webConfig = Invoke-RestMethod -Method Get -Uri "https://firebase.googleapis.com/v1beta1/projects/$ExpectedProject/webApps/$($webApp.appId)/config" -Headers $headers
if ($webConfig.projectId -ne $ExpectedProject -or $webConfig.authDomain -ne "$ExpectedProject.firebaseapp.com" -or $webConfig.databaseURL -ne $DatabaseUrl) {
  throw 'The staging Web app config does not match the approved Firebase project.'
}
$apiKey = $webConfig.apiKey
if (-not $apiKey) { throw 'The staging Web app config has no Firebase API key.' }

function New-TestPassword {
  $bytes = [byte[]]::new(24)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}
function New-TestPin {
  $bytes = [byte[]]::new(4)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return (100000 + ([BitConverter]::ToUInt32($bytes, 0) % 900000)).ToString()
}
function Invoke-AdminAuthPost([string]$Path, $Body) {
  $json = ConvertTo-Json -InputObject $Body -Depth 40 -Compress
  return Invoke-RestMethod -Method Post -Uri "https://identitytoolkit.googleapis.com/v1/projects/$ExpectedProject/$Path" -Headers $headers -ContentType 'application/json' -Body $json
}

$fixture = Get-Content $AccountsFixture -Raw | ConvertFrom-Json
$adults = @([pscustomobject]@{ role = 'owner'; email = $fixture.owner.email; displayName = $fixture.owner.displayName; classId = $null; className = $null })
$adults += @($fixture.roles)
$credentials = @()
$userIds = @{}
foreach ($adult in $adults) {
  $password = New-TestPassword
  $lookup = Invoke-AdminAuthPost 'accounts:lookup' @{ email = @($adult.email) }
  $existing = @($lookup.users | Where-Object { $_.email -eq $adult.email }) | Select-Object -First 1
  if ($existing) {
    try { $claims = $existing.customAttributes | ConvertFrom-Json } catch { $claims = $null }
    if (-not $claims -or $claims.b3StagingAccount -ne $true) {
      throw "The staging account address $($adult.email) is already used by a non-fixture account; no existing account was changed."
    }
    $uid = $existing.localId
  } else {
    $created = Invoke-RestMethod -Method Post -Uri "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=$apiKey" -ContentType 'application/json' -Body (ConvertTo-Json @{ email = $adult.email; password = $password; returnSecureToken = $true } -Compress)
    $uid = $created.localId
  }
  $customClaims = @{ b3StagingAccount = $true; b3StagingRole = $adult.role } | ConvertTo-Json -Compress
  Invoke-AdminAuthPost 'accounts:update' @{ localId = $uid; email = $adult.email; password = $password; displayName = $adult.displayName; emailVerified = $true; customAttributes = $customClaims; returnSecureToken = $false } | Out-Null
  $userIds[$adult.role] = $uid
  $credentials += [pscustomobject]@{ role = $adult.role; email = $adult.email; password = $password; uid = $uid; classId = $adult.classId }
}

$allTools = @('weekly-quiz', 'chazara', 'shorashim', 'rashi', 'class-gallery', 'halacha', 'student-rewards', 'pointer', 'game-show', 'yiddish')
$classes = @{}
$teachers = @{}
$invites = @{}
$studentRecords = @{}
$privatePasscodes = @{}
$quizClasses = @{}
$chazaraStudents = @{}
$studentCredentials = @()
foreach ($class in $fixture.roles) {
  $teacher = $credentials | Where-Object email -eq $class.email | Select-Object -First 1
  $classStudents = @($fixture.students | Where-Object classId -eq $class.classId)
  $members = @{}
  foreach ($student in $classStudents) {
    $pin = New-TestPin
    $members[$student.id] = @{ active = $true; name = $student.name; studentId = $student.id; toolAccess = @{} }
    $studentRecords[$student.id] = @{
      profile = @{ id = $student.id; name = $student.name; active = $true; classId = $class.classId }
      memberships = @{ ("$($fixture.workspaceId)_$($class.classId)") = @{ workspaceId = $fixture.workspaceId; classId = $class.classId; active = $true } }
    }
    $privatePasscodes[$student.id] = @{ passcode = $pin; updatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
    $studentCredentials += [pscustomobject]@{ name = $student.name; passcode = $pin; classId = $class.classId }
    $chazaraStudents[$student.id] = @{ displayName = $student.name; classId = $class.classId }
  }
  $classes[$class.classId] = @{
    id = $class.classId; name = $class.className; active = $true; siteEnabled = $true
    toolGrants = @{} + ($allTools | ForEach-Object -Begin { $g = @{} } -Process { $g[$_] = $true } -End { $g })
    members = $members; teacherIds = @{ $teacher.uid = $true }
  }
  $teacherRole = if ($class.role -eq 'principal') { 'principal' } else { 'teacher' }
  $teachers[$teacher.uid] = @{ uid = $teacher.uid; email = $class.email; displayName = $class.displayName; active = $true; role = $teacherRole; title = $teacherRole; classIds = @{ $class.classId = $true } }
  $inviteId = ($class.email.ToLowerInvariant() -replace '[^a-z0-9]+', '_').Trim('_')
  $invites[$inviteId] = @{ email = $class.email; name = $class.displayName; active = $true; classIds = @{ $class.classId = $true } }
  $launchId = 'staging_welcome'
  $quizClasses[$class.classId] = @{
    settings = @{ activeLaunchByClass = @{ $class.classId = $launchId } }
    launches = @{
      $launchId = @{
        classId = $class.classId; started = $true; mode = 'test'; showScore = $false
        targetStudents = @{} + ($classStudents | ForEach-Object -Begin { $t = @{} } -Process { $t[$_.id] = $true } -End { $t })
        quizSnapshot = @{ title = "Fictional $($class.className) Quiz"; skillType = 'comprehension'; questions = @(@{ q = 'Which choice is part of this fictional staging quiz?'; choices = @('Test answer', 'Unused answer'); correctIndex = 0 }) }
      }
    }
  }
}

$ownerUid = $userIds.owner
$b3Games = @{
  admins = @{ $ownerUid = @{ active = $true; displayName = $fixture.owner.displayName; role = 'owner' } }
  siteSettings = @{ siteEnabled = $true; studentSiteOpen = $true; games = @{ 'weekly-quiz' = $true; chazara = $true; shorashim = $true }; classGames = @{} }
  students = $studentRecords
  workspaces = @{
    $fixture.workspaceId = @{
      teachers = $teachers; teacherInvites = $invites; classes = $classes
      siteSettings = @{ siteEnabled = $true; studentSiteOpen = $true }
    }
  }
  stagingMetadata = @{ seedVersion = 1; seededAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); syntheticOnly = $true }
}
$b3Games.siteSettings.classGames = @{}
foreach ($class in $fixture.roles) {
  $g = @{}
  foreach ($tool in $allTools) { $g[$tool] = $true }
  $b3Games.siteSettings.classGames[$class.classId] = $g
}

$dbData = @{
  b3Games = $b3Games
  b3Private = @{ passcodes = $privatePasscodes }
  b3Quiz = @{ classes = $quizClasses }
  posukPractice = @{ chazara = @{ students = $chazaraStudents; events = @{} } }
}
$dbBody = ConvertTo-Json -InputObject $dbData -Depth 80 -Compress
Invoke-RestMethod -Method Put -Uri "$DatabaseUrl/.json?print=silent" -Headers $headers -ContentType 'application/json' -Body $dbBody | Out-Null

Write-Output 'Created fictional staging accounts and seeded isolated test data.'
$credentialFile = Join-Path $PSScriptRoot 'test-credentials.local.json'
ConvertTo-Json -InputObject @{ website = 'https://fun-torah-tools-staging.web.app'; adultAccounts = $credentials; studentAccounts = $studentCredentials } -Depth 8 | Set-Content -LiteralPath $credentialFile -Encoding utf8
Write-Output "Private test credentials saved locally to $credentialFile (git-ignored)."
