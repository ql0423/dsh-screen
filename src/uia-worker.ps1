# Warm UI Automation worker: loads the assemblies once, then serves one JSON request per
# line on stdin. Saves the ~400ms that pwsh startup + Add-Type cost on every one-shot call.
# Protocol: base64(JSON request) per line in, JSON per line out. A line "quit" exits.
. (Join-Path $PSScriptRoot 'uia-core.ps1')

[Console]::Out.WriteLine('{"ok":true,"ready":true}')
[Console]::Out.Flush()

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $line = $line.Trim()
  if ($line -eq '') { continue }
  if ($line -eq 'quit') { break }
  try {
    $json = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($line))
    $result = Invoke-UiaRequest ($json | ConvertFrom-Json)
    if ($null -eq $result) { $result = '{"ok":false,"error":"no result"}' }
  } catch {
    $result = (@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress)
  }
  [Console]::Out.WriteLine($result)
  [Console]::Out.Flush()
}
