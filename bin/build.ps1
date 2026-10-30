$ErrorActionPreference = 'Stop'
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    python bin/build.py
    if ($LASTEXITCODE -ne 0) { throw 'Plugin build failed.' }
} finally {
    Pop-Location
}
