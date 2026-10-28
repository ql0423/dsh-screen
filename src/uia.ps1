# UI Automation bridge: one-shot, JSON in / JSON out, DPI aware.
# Used by dsh-screen/src/uia.js. Read-only unless the action says otherwise.
param(
  [Parameter(Mandatory = $true)][string]$RequestB64
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes | Out-Null

# Match the Node side: physical pixels everywhere.
try {
  Add-Type -Namespace DshScreen -Name Dpi -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
'@ | Out-Null
  [DshScreen.Dpi]::SetProcessDPIAware() | Out-Null
} catch { }

$json = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($RequestB64))
$req = $json | ConvertFrom-Json
$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$CT = [System.Windows.Automation.ControlType]

function Out-Json($obj) {
  $out = $obj | ConvertTo-Json -Depth 12 -Compress
  [Console]::Out.Write($out)
}

function Get-Rect($el) {
  try {
    $r = $el.Current.BoundingRectangle
    if ($r.IsEmpty) { return $null }
    return @{ x = [int][math]::Round($r.X); y = [int][math]::Round($r.Y); width = [int][math]::Round($r.Width); height = [int][math]::Round($r.Height) }
  } catch { return $null }
}

function Get-PatternNames($el) {
  $names = New-Object System.Collections.ArrayList
  try { if ($el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)) { [void]$names.Add('invoke') } } catch { }
  try { if ($el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)) { [void]$names.Add('value') } } catch { }
  try { if ($el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)) { [void]$names.Add('selectionitem') } } catch { }
  try { if ($el.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)) { [void]$names.Add('expandcollapse') } } catch { }
  try { if ($el.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)) { [void]$names.Add('toggle') } } catch { }
  try { if ($el.GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern)) { [void]$names.Add('scroll') } } catch { }
  try { if ($el.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)) { [void]$names.Add('text') } } catch { }
  try { if ($el.GetCurrentPattern([System.Windows.Automation.SelectionPattern]::Pattern)) { [void]$names.Add('selection') } } catch { }
  return @($names)
}

function Describe($el, $path, $depth) {
  $c = $el.Current
  return [ordered]@{
    path        = $path
    name        = [string]$c.Name
    type        = [string]$c.ControlType.ProgrammaticName -replace '^ControlType\.', ''
    automationId = [string]$c.AutomationId
    className   = [string]$c.ClassName
    rect        = Get-Rect $el
    enabled     = [bool]$c.IsEnabled
    offscreen   = [bool]$c.IsOffscreen
    focused     = [bool]$c.HasKeyboardFocus
    depth       = $depth
    patterns    = [string[]]@(Get-PatternNames $el)
  }
}

function Resolve-Root($req) {
  if ($req.handle -and [int64]$req.handle -ne 0) {
    return $AE::FromHandle([System.IntPtr][int64]$req.handle)
  }
  $fg = [DshScreen.Dpi]::GetForegroundWindow()
  if ($fg -eq [System.IntPtr]::Zero) { throw 'no foreground window' }
  return $AE::FromHandle($fg)
}

function Resolve-Path($root, $path) {
  $current = $root
  if ([string]::IsNullOrWhiteSpace($path) -or $path -eq '0') { return $root }
  foreach ($seg in $path.Split('/')) {
    if ($seg -eq '0') { continue }
    $idx = [int]$seg
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $child = $walker.GetFirstChild($current)
    $i = 1
    while ($child -ne $null -and $i -lt $idx) {
      $child = $walker.GetNextSibling($child)
      $i++
    }
    if ($child -eq $null) { throw "path segment $seg not found under $($current.Current.Name)" }
    $current = $child
  }
  return $current
}

function Invoke-Element($el) {
  $p = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $p.Invoke()
}

try {
  $root = Resolve-Root $req
  $action = [string]$req.action

  switch ($action) {
    'window' {
      $d = Describe $root '0' 0
      Out-Json @{ ok = $true; root = $d }
    }
    'tree' {
      $maxDepth = if ($req.maxDepth) { [int]$req.maxDepth } else { 6 }
      $maxNodes = if ($req.maxNodes) { [int]$req.maxNodes } else { 400 }
      $onlyNamed = [bool]$req.onlyNamed
      $nodes = New-Object System.Collections.ArrayList

      function Walk($el, $path, $depth, $walker) {
        if ($nodes.Count -ge $maxNodes) { return }
        $d = Describe $el $path $depth
        if (-not $onlyNamed -or $d.name -ne '' -or $d.patterns.Count -gt 0) {
          [void]$nodes.Add($d)
        }
        if ($depth -ge $maxDepth) { return }
        $child = $walker.GetFirstChild($el)
        $i = 1
        while ($child -ne $null) {
          Walk $child "$path/$i" ($depth + 1) $walker
          if ($nodes.Count -ge $maxNodes) { return }
          $child = $walker.GetNextSibling($child)
          $i++
        }
      }

      $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
      Walk $root '0' 0 $walker

      # UWP hosts (ApplicationFrameWindow) expose their real UI under a separate HWND tree;
      # when the control view is nearly empty, retry with the raw view which crosses that boundary.
      if ($nodes.Count -le 1 -and -not $req.raw) {
        $nodes.Clear()
        $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
        Walk $root '0' 0 $walker
      }

      Out-Json @{ ok = $true; count = $nodes.Count; truncated = ($nodes.Count -ge $maxNodes); nodes = $nodes }
    }
    'find' {
      $created = $false
      $conds = New-Object System.Collections.ArrayList
      if ($req.name) { [void]$conds.Add((New-Object System.Windows.Automation.PropertyCondition($AE::NameProperty, [string]$req.name))) }
      if ($req.automationId) { [void]$conds.Add((New-Object System.Windows.Automation.PropertyCondition($AE::AutomationIdProperty, [string]$req.automationId))) }
      if ($req.className) { [void]$conds.Add((New-Object System.Windows.Automation.PropertyCondition($AE::ClassNameProperty, [string]$req.className))) }
      if ($req.controlType) { [void]$conds.Add((New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::$($req.controlType)))) }
      if ($conds.Count -eq 0) { throw 'find needs at least one of name/automationId/className/controlType' }
      $cond = $conds[0]
      for ($i = 1; $i -lt $conds.Count; $i++) { $cond = New-Object System.Windows.Automation.AndCondition($cond, $conds[$i]) }
      $found = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
      $list = New-Object System.Collections.ArrayList
      $i = 0
      foreach ($el in $found) {
        if ($i -ge 40) { break }
        [void]$list.Add((Describe $el "?$i" -1))
        $i++
      }
      Out-Json @{ ok = $true; count = $found.Count; matches = $list }
    }
    'invoke' {
      $el = if ($req.path) { Resolve-Path $root $req.path } else { $null }
      if ($el -eq $null) {
        if (-not $req.name) { throw 'invoke needs path or name' }
        $cond = New-Object System.Windows.Automation.PropertyCondition($AE::NameProperty, [string]$req.name)
        $el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
      }
      if ($el -eq $null) { throw 'element not found' }
      Invoke-Element $el
      Out-Json @{ ok = $true; invoked = (Describe $el ($req.path) 0) }
    }
    'setvalue' {
      $el = if ($req.path) { Resolve-Path $root $req.path } else {
        $cond = New-Object System.Windows.Automation.PropertyCondition($AE::NameProperty, [string]$req.name)
        $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
      }
      if ($el -eq $null) { throw 'element not found' }
      $p = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
      $p.SetValue([string]$req.value)
      Out-Json @{ ok = $true; value = $p.Current.Value }
    }
    'getvalue' {
      $el = if ($req.path) { Resolve-Path $root $req.path } else {
        $cond = New-Object System.Windows.Automation.PropertyCondition($AE::NameProperty, [string]$req.name)
        $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
      }
      if ($el -eq $null) { throw 'element not found' }
      $p = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
      Out-Json @{ ok = $true; value = $p.Current.Value }
    }
    'select' {
      $el = if ($req.path) { Resolve-Path $root $req.path } else {
        $cond = New-Object System.Windows.Automation.PropertyCondition($AE::NameProperty, [string]$req.name)
        $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
      }
      if ($el -eq $null) { throw 'element not found' }
      $p = $el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
      $p.Select()
      Out-Json @{ ok = $true }
    }
    'focus' {
      $el = if ($req.path) { Resolve-Path $root $req.path } else { $root }
      $el.SetFocus()
      Out-Json @{ ok = $true }
    }
    default { throw "unknown action: $action" }
  }
} catch {
  Out-Json @{ ok = $false; error = $_.Exception.Message; stack = $_.ScriptStackTrace }
}