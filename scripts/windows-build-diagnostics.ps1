param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('setup', 'collect')]
  [string]$Mode
)

$ErrorActionPreference = 'Stop'
$directory = Join-Path $env:RUNNER_TEMP 'psstpsst-node-reports'
New-Item -ItemType Directory -Force -Path $directory | Out-Null

if ($Mode -eq 'setup') {
  # Reports omit environment variables because packaging receives signing secrets.
  $reportDirectory = $directory.Replace('\', '/')
  $options = @(
    $env:NODE_OPTIONS
    '--report-on-fatalerror'
    '--report-uncaught-exception'
    '--report-exclude-env'
    '--report-exclude-network'
    "--report-directory=`"$reportDirectory`""
  ) -join ' '
  "NODE_OPTIONS=$options" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
  exit 0
}

node -p 'JSON.stringify({ version: process.version, arch: process.arch, versions: process.versions }, null, 2)' |
  Set-Content -Path (Join-Path $directory 'runtime.json') -Encoding utf8

# A Windows fast-fail may bypass Node's report hooks. Application events can
# still identify the faulting executable/module; their absence is not an error.
try {
  $events = Get-WinEvent -FilterHashtable @{
    LogName = 'Application'
    Id = @(1000, 1001)
    StartTime = (Get-Date).AddHours(-2)
  } -ErrorAction Stop |
    Where-Object { $_.Message -match '\bnode\.exe\b' } |
    Select-Object TimeCreated, Id, ProviderName, Message
  ConvertTo-Json -InputObject @($events) -Depth 4 |
    Set-Content -Path (Join-Path $directory 'windows-events.json') -Encoding utf8
} catch {
  $_.Exception.Message |
    Set-Content -Path (Join-Path $directory 'windows-events-unavailable.txt') -Encoding utf8
}
