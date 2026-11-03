# Starts the LKPR trainer in PowerShell on Windows with Python 3.13.
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
if (-not (Test-Path ".\.venv\Scripts\python.exe")) {
    py -3.13 -m venv .venv
}
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Write-Host "Open http://127.0.0.1:8741 in Chrome or Edge."
python -m uvicorn app.main:app --host 127.0.0.1 --port 8741
