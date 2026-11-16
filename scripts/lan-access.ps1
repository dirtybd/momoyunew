# 放行/关闭本机前端（Vite，默认 5174）的入站访问，供同一内网的其他机器访问。
# 用法（需要管理员权限）：
#   powershell -ExecutionPolicy Bypass -File scripts/lan-access.ps1            # 添加规则
#   powershell -ExecutionPolicy Bypass -File scripts/lan-access.ps1 -Remove    # 删除规则
param(
  [int]$Port = 5174,
  [switch]$Remove
)
$name = "Momoyu Website (LAN) - TCP $Port"
$rule = Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
if ($Remove) {
  if ($rule) { Remove-NetFirewallRule -DisplayName $name; Write-Host "已删除入站规则：$name" }
  else { Write-Host "规则不存在：$name" }
} elseif ($rule) {
  Enable-NetFirewallRule -DisplayName $name
  Write-Host "规则已存在并启用：$name"
} else {
  New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow `
    -Protocol TCP -LocalPort $Port -RemoteAddress LocalSubnet -Profile Any | Out-Null
  Write-Host "已添加入站规则：$name（仅限本地子网）"
}
