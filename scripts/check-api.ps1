param([string]$BaseUrl='http://127.0.0.1:8080')
$ErrorActionPreference='Stop'
function Login($login) {
  $body=@{login=$login;password='test1234'}|ConvertTo-Json
  (Invoke-RestMethod -Uri "$BaseUrl/api/v1/auth/login" -Method Post -ContentType 'application/json' -Body $body).access_token
}
$anna=Login 'intern_anna'
$headers=@{Authorization="Bearer $anna"}
$results=@()
foreach($path in @('/me/profile','/teams/delivery','/onboarding/plan','/onboarding/progress','/onboarding/next-steps','/access/overview','/knowledge/search?query=GitLab')) {
  $watch=[Diagnostics.Stopwatch]::StartNew()
  $null=Invoke-RestMethod -Uri "$BaseUrl/api/v1$path" -Headers $headers
  $watch.Stop()
  $results += [pscustomobject]@{route=$path;milliseconds=$watch.ElapsedMilliseconds}
}
$results|Format-Table
if(($results|Where-Object milliseconds -ge 1000).Count -gt 0){throw 'Latency exceeds 1 second'}

