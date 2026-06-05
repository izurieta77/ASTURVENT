[CmdletBinding()]
param(
  [ValidateSet('snapshot', 'generate-adjustment', 'verify-adjustment')]
  [string]$Action = 'snapshot',
  [string]$BaseUrl = 'https://supercheapp.netlify.app/.netlify/functions',
  [string]$Pin = '7474',
  [string]$Desde = '2023-06-01',
  [string]$Hasta = '2026-06-04'
)

$ErrorActionPreference = 'Stop'

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$StateDir = Join-Path $ScriptRoot 'state'
$HistoryDir = Join-Path $StateDir 'history'
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
New-Item -ItemType Directory -Force -Path $HistoryDir | Out-Null

function Invoke-ScAuth {
  $body = @{ pin = $Pin } | ConvertTo-Json -Compress
  $auth = Invoke-RestMethod -Method Post -Uri "$BaseUrl/auth" -ContentType 'application/json' -Body $body
  return @{ Authorization = "Bearer $($auth.token)" }
}

function Get-ScResumenInventario {
  param([hashtable]$Headers)
  Invoke-RestMethod -Method Get -Uri "$BaseUrl/sc-data?action=resumen_inventario_sicar&desde=$Desde&hasta=$Hasta&agrupar=mes" -Headers $Headers
}

function Get-ScResumenAjuste {
  param([hashtable]$Headers)
  Invoke-RestMethod -Method Get -Uri "$BaseUrl/sc-data?action=resumen_ajuste_inventario_olvidado&desde=$Desde&hasta=$Hasta" -Headers $Headers
}

function Invoke-ScGenerarAjuste {
  param([hashtable]$Headers)
  $body = @{
    action = 'generar_ajuste_inventario_olvidado'
    desde = $Desde
    hasta = $Hasta
  } | ConvertTo-Json -Compress
  Invoke-RestMethod -Method Post -Uri "$BaseUrl/sc-data" -ContentType 'application/json' -Headers $Headers -Body $body
}

function Get-ScComprasAjuste {
  param([hashtable]$Headers)

  $start = [datetime]$Desde
  $end = [datetime]$Hasta
  $cursor = Get-Date -Year $start.Year -Month $start.Month -Day 1
  $rows = @()

  while ($cursor -le $end) {
    $mStart = if ($cursor -lt $start) { $start } else { $cursor }
    $mEnd = $cursor.AddMonths(1).AddDays(-1)
    if ($mEnd -gt $end) { $mEnd = $end }

    $desdeMes = $mStart.ToString('yyyy-MM-dd')
    $hastaMes = $mEnd.ToString('yyyy-MM-dd')
    $data = Invoke-RestMethod -Method Get -Uri "$BaseUrl/sc-data?action=lista&tabla=compras&desde=$desdeMes&hasta=$hastaMes" -Headers $Headers
    $rows += @($data.filas | Where-Object { [string]$_.raw_ocr -like 'sicar_inventory_forgotten:*' })
    $cursor = $cursor.AddMonths(1)
  }

  return $rows
}

function New-ScSnapshot {
  param(
    [string]$RunAction,
    [object]$Inventario,
    [object]$Ajuste,
    [object]$Generacion,
    [object[]]$ComprasAjuste
  )

  $compras = @($ComprasAjuste)
  $mesesAjuste = $compras |
    Group-Object { ([datetime]$_.fecha).ToString('yyyy-MM') } |
    Sort-Object Name |
    ForEach-Object {
      [pscustomobject]@{
        periodo = $_.Name
        filas = $_.Count
        total = [math]::Round((($_.Group | Measure-Object -Property total -Sum).Sum), 2)
      }
    }

  [pscustomobject]@{
    capturedAt = (Get-Date).ToString('o')
    action = $RunAction
    baseUrl = $BaseUrl
    rango = @{
      desde = $Desde
      hasta = $Hasta
    }
    inventario = $Inventario.resumen
    ajuste = $Ajuste.resumen
    generacion = if ($Generacion) {
      @{
        insertados = [int]$Generacion.insertados
        reemplazados = [int]$Generacion.reemplazados
      }
    } else {
      $null
    }
    comprasAjuste = @{
      filas = $compras.Count
      total = [math]::Round((($compras | Measure-Object -Property total -Sum).Sum), 2)
      meses = $mesesAjuste.Count
      detalle = @($mesesAjuste)
    }
  }
}

$headers = Invoke-ScAuth
$inventario = Get-ScResumenInventario -Headers $headers
$ajuste = Get-ScResumenAjuste -Headers $headers
$generacion = $null

if ($Action -eq 'generate-adjustment') {
  $generacion = Invoke-ScGenerarAjuste -Headers $headers
  $ajuste = Get-ScResumenAjuste -Headers $headers
}

$comprasAjuste = Get-ScComprasAjuste -Headers $headers
$snapshot = New-ScSnapshot -RunAction $Action -Inventario $inventario -Ajuste $ajuste -Generacion $generacion -ComprasAjuste $comprasAjuste

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$latestPath = Join-Path $StateDir 'last-sicar-harness.json'
$historyPath = Join-Path $HistoryDir ("sicar-harness-$stamp.json")
$json = $snapshot | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($latestPath, $json, (New-Object System.Text.UTF8Encoding $false))
[System.IO.File]::WriteAllText($historyPath, $json, (New-Object System.Text.UTF8Encoding $false))

$snapshot | ConvertTo-Json -Depth 8
