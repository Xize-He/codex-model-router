# Stores only an existing token, encrypted for the current Windows user with DPAPI.
$ErrorActionPreference = 'Stop'
$baseConfig = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'router.config.json') -Raw | ConvertFrom-Json
$localPath = Join-Path $PSScriptRoot 'router.config.local.json'
$localConfig = if (Test-Path -LiteralPath $localPath) { Get-Content -LiteralPath $localPath -Raw | ConvertFrom-Json } else { $null }
$mcpServers = if ($null -ne $localConfig -and $null -ne $localConfig.mcpServers) { $localConfig.mcpServers } else { $baseConfig.mcpServers }
$credentials = @()
foreach ($server in $mcpServers) {
  if (-not $server.tokenEnv) { continue }
  $routerToken = [Environment]::GetEnvironmentVariable($server.tokenEnv, 'Process')
  if (-not $routerToken) { Write-Warning ('跳过 ' + $server.name + '：当前进程缺少环境变量 ' + $server.tokenEnv); continue }
  $routerProtectedToken = ConvertTo-SecureString -String $routerToken -AsPlainText -Force | ConvertFrom-SecureString
  $credentials += @{url=$server.url; tokenEnv=$server.tokenEnv; protectedToken=$routerProtectedToken}
}
if ($credentials.Count -eq 0) { throw '没有找到可保存的 MCP 认证环境变量。' }
$routerData = Join-Path $PSScriptRoot 'data'
New-Item -ItemType Directory -Path $routerData -Force | Out-Null
$credentials | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $routerData 'mcp-credentials.json') -Encoding UTF8
$routerToken = $null
Write-Host ('已加密保存 ' + $credentials.Count + ' 个 MCP 认证。')
