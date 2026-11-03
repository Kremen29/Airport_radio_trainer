# HTTPS for the iPhone microphone on the same Wi-Fi. The certificate is for training only and iOS does not trust it by default.
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
Write-Host "On a phone on the same network, open: https://${ip}:8741"
Write-Host "iOS will show a warning. Trusting a self-signed certificate is covered in the README, Mobile section."
Write-Host "Allow port 8741 in Windows Firewall for the private network."
Write-Host ""
python -m uvicorn app.main:app --host 0.0.0.0 --port 8741 --ssl-keyfile certs/dev-key.pem --ssl-certfile certs/dev-cert.pem
