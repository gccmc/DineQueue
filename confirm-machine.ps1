# confirm-machine.ps1
# 用「信任局域网地址」的方式打开"到店确认台"，从而启用摄像头扫码。
# 双击 confirm-machine.bat 即可；不改 IP 会自动取本机第一个局域网 IPv4。
param([string]$Ip = "")
$port = 3000

# ---------- 手动指定服务器地址时，取消下一行注释并填 IP ----------
# $Ip = "192.168.10.171"

$browser = $null
$pf = [Environment]::GetEnvironmentVariable('ProgramFiles')
$pfx86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
$candidates = @(
    (Join-Path $pf 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $pfx86 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $pf 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $pfx86 'Google\Chrome\Application\chrome.exe')
)
foreach ($p in $candidates) {
    if (Test-Path $p) { $browser = $p; break }
}
if (-not $browser) {
    Write-Host "未找到 Edge 或 Chrome，请先安装浏览器。" -ForegroundColor Red
    Read-Host
    exit 1
}

if (-not $Ip) {
    $net = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue
    # 排除虚拟/蓝牙/回环/链路本地
    $real = @($net | Where-Object {
        $_.IPAddress -notlike '127.*' -and
        $_.IPAddress -notlike '169.254.*' -and
        $_.InterfaceAlias -notmatch 'vEthernet|Hyper|VMware|VirtualBox|Bluetooth|WSL|Loopback|Npcap|TAP'
    })
    # 优先选已连接的接口
    $up = @($real | Where-Object {
        (Get-NetAdapter -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue).Status -eq 'Up'
    })
    $cand = if ($up.Count) { $up } else { $real }
    # 再优先选名称像 Wi-Fi / 以太网的
    $Ip = $cand |
        Sort-Object @{Expression={ if ($_.InterfaceAlias -match 'WLAN|Wi-Fi|WiFi|Ethernet|以太网|Wired') {0} else {1} }} |
        Select-Object -First 1 -ExpandProperty IPAddress
}
if (-not $Ip) { $Ip = "localhost" }

$origin = "http://${Ip}:${port}"
$url = "$origin/confirm.html"
$profile = "$env:LOCALAPPDATA\DHDConfirm"

Write-Host "浏览器: $browser"
Write-Host "确认台地址: $url"
Write-Host "已信任该局域网地址，摄像头应可正常打开。" -ForegroundColor Green

Start-Process -FilePath $browser -ArgumentList @(
    "--unsafely-treat-insecure-origin-as-secure=$origin",
    "--user-data-dir=$profile",
    "--start-fullscreen",
    $url
)