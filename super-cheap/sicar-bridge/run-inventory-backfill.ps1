$ErrorActionPreference = 'Continue'

$Root = 'C:\super-cheap'
$Desde = '2023-06-01'
$Hasta = '2026-06-04'
$ChunkDays = 120
$SyncUrl = 'https://raw.githubusercontent.com/izurieta77/ASTURVENT/claude/super-cheap-dashboard-jhZyZ/super-cheap/sicar-bridge/sync.js'

$Logs = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force -Path $Logs | Out-Null
$Log = Join-Path $Logs ("inventory-backfill-run-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))

function Write-BackfillLog($Message) {
  "[{0}] {1}" -f (Get-Date -Format o), $Message | Out-File $Log -Append -Encoding utf8
}

Write-BackfillLog "START inventory backfill desde=$Desde hasta=$Hasta chunkDays=$ChunkDays"
Set-Location $Root

try {
  Invoke-WebRequest -UseBasicParsing $SyncUrl -OutFile (Join-Path $Root 'sync.js')
  Write-BackfillLog "Downloaded sync.js from GitHub."
} catch {
  Write-BackfillLog ("ERROR downloading sync.js: " + $_.Exception.Message)
  exit 1
}

$Control = [ordered]@{
  enabled = $true
  desde = $Desde
  hasta = $Hasta
  cursor = $Hasta
  chunkDays = $ChunkDays
  createdAt = (Get-Date).ToString('o')
  createdBy = 'codex'
  reason = 'Backfill de compras automaticas por aumentos positivos de inventario SICAR'
} | ConvertTo-Json -Depth 4

$Utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText((Join-Path $Root 'inventory-backfill.json'), $Control, $Utf8NoBom)
Write-BackfillLog "Created inventory-backfill.json."

$ConsecutiveErrors = 0
do {
  Write-BackfillLog "Running sync.js inventory backfill block."
  & node .\sync.js $Hasta --inventario-only *>> $Log
  $ExitCode = $LASTEXITCODE

  if ($ExitCode -ne 0) {
    $ConsecutiveErrors += 1
    Write-BackfillLog "sync.js exited with $ExitCode. consecutiveErrors=$ConsecutiveErrors"
    if ($ConsecutiveErrors -ge 5) {
      Write-BackfillLog "STOP after 5 consecutive errors."
      exit 1
    }
    Start-Sleep -Seconds 60
  } else {
    $ConsecutiveErrors = 0
    Start-Sleep -Seconds 2
  }

  try {
    $State = Get-Content -LiteralPath (Join-Path $Root 'inventory-backfill.json') -Raw | ConvertFrom-Json
    Write-BackfillLog ("State cursor={0} enabled={1} finishedAt={2}" -f $State.cursor, $State.enabled, $State.finishedAt)
  } catch {
    Write-BackfillLog ("ERROR reading inventory-backfill.json: " + $_.Exception.Message)
    exit 1
  }
} while ($State.enabled -eq $true -and -not $State.finishedAt)

Write-BackfillLog "END inventory backfill."

$DaemonPath = Join-Path $Root 'daemon.js'
if (Test-Path -LiteralPath $DaemonPath) {
  Start-Process node -WindowStyle Hidden -ArgumentList $DaemonPath -WorkingDirectory $Root
  Write-BackfillLog "Restarted daemon.js."
}
