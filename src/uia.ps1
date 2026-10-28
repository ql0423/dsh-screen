# UI Automation bridge: one-shot, JSON in / JSON out, DPI aware.
# Used by dsh-screen/src/uia.js as the fallback when no warm worker is available.
param(
  [Parameter(Mandatory = $true)][string]$RequestB64
)

. (Join-Path $PSScriptRoot 'uia-core.ps1')

$json = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($RequestB64))
$result = Invoke-UiaRequest ($json | ConvertFrom-Json)
if ($null -ne $result) { [Console]::Out.Write($result) }
