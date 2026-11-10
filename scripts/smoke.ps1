param([string]$BaseUrl='http://127.0.0.1:8080')
$ErrorActionPreference='Stop'
function Login($name){(Invoke-RestMethod "$BaseUrl/api/v1/auth/login" -Method Post -ContentType 'application/json' -Body (@{login=$name;password='test1234'}|ConvertTo-Json)).access_token}
function Call($method,$path,$token,$body=$null,$key=''){
 $h=@{Authorization="Bearer $token"};if($key){$h['Idempotency-Key']=$key}
 $args=@{Uri="$BaseUrl/api/v1$path";Method=$method;Headers=$h;ContentType='application/json'}
 if($null -ne $body){$args.Body=$body|ConvertTo-Json -Depth 10}
 Invoke-RestMethod @args
}
$a=Login 'intern_anna';$e=Login 'lead_elena';$v=Login 'intern_vera'
$plan=Call GET '/onboarding/plan' $a
$task=$plan.stages.tasks|Where-Object {$_.code -ne 'get_access' -and $_.status -ne 'done'}|Select-Object -First 1
if($task){$null=Call PATCH "/onboarding/tasks/$($task.id)" $a @{status='done';comment='Smoke test'}}
$ka=Call GET '/knowledge/search?query=GitLab' $a
$kv=Call GET '/knowledge/search?query=GitLab' $v
if(($ka|Where-Object team_id -eq 'frontend') -or ($kv|Where-Object team_id -eq 'delivery')){throw 'Knowledge isolation failed'}
$date=(Get-Date).AddDays(7).ToString('yyyy-MM-dd');$key=[guid]::NewGuid().ToString()
$body=@{date_from=$date;date_to=$date;reason_type='day_off';comment='Synthetic smoke test'}
$r=Call POST '/requests/leave' $a $body $key
$again=Call POST '/requests/leave' $a $body $key
if($r.id -ne $again.id){throw 'Idempotency failed'}
foreach($item in (Call GET '/access/overview' $a)){
 if($item.status -eq 'missing'){$null=Call POST '/requests/access' $a @{system_code=$item.system_code;reason='Smoke test'} ([guid]::NewGuid().ToString())}
}
foreach($item in (Call GET '/approvals/pending' $e)){
 if($item.user_id -eq 'anna'){$null=Call POST "/requests/$($item.id)/approve" $e @{comment='Smoke test'}}
}
$result=Call GET "/requests/$($r.id)" $a
if($result.status -ne 'approved'){throw 'Leave approval failed'}
$plan=Call GET '/onboarding/plan' $a
if(($plan.stages.tasks|Where-Object code -eq 'get_access').status -ne 'done'){throw 'Access task not completed'}
'PASS: leave, idempotency, access approval, automatic task completion, knowledge isolation'
'Run this smoke test against a fresh synthetic database; it creates test requests.'

