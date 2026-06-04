Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$check = Join-Path $root "scripts\appsgm_guardrail_check.js"

if (-not (Test-Path -LiteralPath $check)) {
  throw "No existe el arnes: $check"
}

Push-Location $root
try {
  node $check
} finally {
  Pop-Location
}
