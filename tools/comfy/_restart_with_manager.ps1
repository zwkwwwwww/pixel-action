# 用 --enable-manager 重启 ComfyUI，保留原有全部启动参数与输入/输出目录。
#
# 为什么需要它：ComfyUI-Manager 4.x 的路由只有在启动参数带 --enable-manager 时才会注册，
# 否则 /v2/manager/* 全 404，agent 侧无法按需装/查节点。
#
# 注意：不要用 $args 这个变量名——它是 PowerShell 自动变量，赋值会被吞掉，导致
# Start-Process 不带参数起 python（秒退且不留日志）。这里用 $cliArgs。
#
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File tools/comfy/_restart_with_manager.ps1
$ErrorActionPreference = 'Stop'

$root = 'E:\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI'
$py   = Join-Path $root '.venv\Scripts\python.exe'
$logDir = 'D:\DeepSeekHarness Workspace\pixel-action-logs'
$outLog = Join-Path $logDir 'comfy-manager.out.log'
$errLog = Join-Path $logDir 'comfy-manager.err.log'

# 1) 停掉当前占用 8888 的 ComfyUI（只认 main.py，别的进程一律不动）
$listener = Get-NetTCPConnection -LocalPort 8888 -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  $procId = $listener.OwningProcess
  $cl = (Get-CimInstance Win32_Process -Filter "ProcessId=$procId").CommandLine
  Write-Host "[stop] pid=$procId"
  if ($cl -notmatch 'main\.py') { throw "8888 上的进程不是 ComfyUI main.py，拒绝结束：$cl" }
  Stop-Process -Id $procId -Force
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    if (-not (Get-NetTCPConnection -LocalPort 8888 -State Listen -ErrorAction SilentlyContinue)) { break }
  }
} else {
  Write-Host '[stop] 8888 上没有监听进程'
}
if (Get-NetTCPConnection -LocalPort 8888 -State Listen -ErrorAction SilentlyContinue) { throw '端口 8888 未释放' }

# 2) 用同样的参数 + --enable-manager 重新拉起（独立进程，不随本脚本/父进程退出）
$cliArgs = @(
  'main.py', '--listen', '127.0.0.1', '--port', '8888',
  '--output-directory', 'E:/Comfy-Desktop/ComfyUI-Shared/output',
  '--input-directory', 'E:/Comfy-Desktop/ComfyUI-Shared/input',
  '--enable-manager'
)
$p = Start-Process -FilePath $py -ArgumentList $cliArgs -WorkingDirectory $root `
  -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
Write-Host "[start] new pid=$($p.Id)"

# 3) 等待就绪（Manager 首次启动会初始化数据库，可能几十秒）
$ready = $false
for ($i = 0; $i -lt 120; $i++) {
  Start-Sleep -Seconds 1
  try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8888/system_stats' -TimeoutSec 3 -UseBasicParsing
    if ($r.StatusCode -eq 200) { $ready = $true; break }
  } catch { }
}
Write-Host "[health] ready=$ready after ${i}s"

# 4) 验证 Manager 路由（4.x 在 /v2/manager/*）
foreach ($path in '/v2/manager/version', '/v2/manager/queue/status') {
  try {
    $m = Invoke-WebRequest -Uri "http://127.0.0.1:8888$path" -TimeoutSec 20 -UseBasicParsing
    Write-Host "[manager] $path -> $($m.StatusCode) $($m.Content)"
  } catch {
    Write-Host "[manager] $path -> FAILED: $($_.Exception.Message)"
  }
}