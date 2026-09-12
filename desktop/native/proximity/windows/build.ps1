$ErrorActionPreference = "Stop"

$ScriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$OutputDirectory = Join-Path $ScriptDirectory "..\bin\win32"

cargo build --release --locked --manifest-path (Join-Path $ScriptDirectory "Cargo.toml")
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
Copy-Item `
  -Path (Join-Path $ScriptDirectory "target\release\psstpsst-proximity.exe") `
  -Destination (Join-Path $OutputDirectory "psstpsst-proximity.exe") `
  -Force
