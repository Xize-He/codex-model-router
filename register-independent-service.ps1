$ErrorActionPreference = 'Stop'
$serviceRoot = $PSScriptRoot
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path -LiteralPath $node)) { throw 'Node.js not found' }
$taskName = 'Model Router Local Service'
$launcher = Join-Path $serviceRoot 'launcher.mjs'
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and ($existing.Actions.Arguments -notlike ('*' + $launcher + '*'))) { throw 'An unrelated task already uses this name' }
$action = New-ScheduledTaskAction -Execute $node -Argument ('"' + $launcher + '" --foreground --no-open') -WorkingDirectory $serviceRoot
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
# On-demand only: no logon, recurring or automatic restart trigger.
Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings -Description 'Runs the local Model Router independently of the Codex desktop process. Started on demand.' -Force | Out-Null
Write-Output 'Independent Model Router task registered.'
