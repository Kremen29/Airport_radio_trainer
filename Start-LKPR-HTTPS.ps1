# HTTPS pro mikrofon na iPhonu ve stejné Wi-Fi. Certifikát je cvičný a iOS mu sám nevěří.
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
if (-not (Test-Path ".\.venv\Scripts\python.exe")) {
    py -3.13 -m venv .venv
}
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
New-Item -ItemType Directory -Force -Path ".\certs" | Out-Null
$ip = (
    Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
    Select-Object -First 1 -ExpandProperty IPAddress
)
if (-not $ip) { $ip = "127.0.0.1" }
python .\scripts\make_dev_cert.py localhost 127.0.0.1 $ip
Write-Host ""
Write-Host "Na telefonu ve stejné síti otevřete: https://${ip}:8741"
Write-Host "iOS ukáže varování. Důvěra k vlastnímu certifikátu je v README, část Mobil."
Write-Host "Povolte port 8741 ve firewallu Windows pro soukromou síť."
Write-Host ""
python -m uvicorn app.main:app --host 0.0.0.0 --port 8741 --ssl-keyfile certs/dev-key.pem --ssl-certfile certs/dev-cert.pem
