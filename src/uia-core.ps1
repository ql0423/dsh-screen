# UI Automation core — dot-source me. Loads UIAutomation + DPI awareness once,
# then every request is just Invoke-UiaRequest; no per-call process start.
$ErrorActionPreference = 'Stop'
$script:Result = $null
$script:WithMeta = $false
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

$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$CT = [System.Windows.Automation.ControlType]
function Out-Json($obj) {
  $out = $obj | ConvertTo-Json -Depth 12 -Compress
  $script:Result = $out
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

function Get-Meta($el) {
  # State that changes what an action means: a filled field, a checked box, a slider
  # position. Read defensively — not every control implements every pattern.
  $m = [ordered]@{}
  try {
    $v = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    if ($v) {
      $text = [string]$v.Current.Value
      if ($v.Current.IsReadOnly) { $m.readonly = $true }
      if (-not $el.Current.IsPassword) { $m.value = $text }
    }
  } catch { }
  try {
    $t = $el.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
    if ($t) { $m.toggle = [string]$t.Current.ToggleState -replace '^ToggleState\.', '' }
  } catch { }
  try {
    $e = $el.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
    if ($e) { $m.expand = [string]$e.Current.ExpandCollapseState -replace '^ExpandCollapseState\.', '' }
  } catch { }
  try {
    $r = $el.GetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern)
    if ($r) { $m.value = $r.Current.Value; $m.min = $r.Current.Minimum; $m.max = $r.Current.Maximum }
  } catch { }
  try { if ($el.Current.IsPassword) { $m.password = $true } } catch { }
  return $m
}

function Describe($el, $path, $depth) {
  $c = $el.Current
  $d = [ordered]@{
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
  if ($script:WithMeta) {
    $meta = Get-Meta $el
    if ($meta.Count -gt 0) { $d.meta = $meta }
  }
  return $d
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


function Invoke-UiaRequest($req) {
try {
  $root = Resolve-Root $req
  $action = [string]$req.action

  switch ($action) {
    'window' {
      $d = Describe $root '0' 0
      Out-Json @{ ok = $true; root = $d }
    }
    'rect' {
      # One control by path (or name) with its live rectangle: the hands use this so a
      # click lands on where the control IS now, not where it was when the screen was read.
      $el = if ($req.path) { Resolve-Path $root ([string]$req.path) } else { $null }
      if ($el -eq $null) {
        if (-not $req.name) { throw 'rect needs path or name' }
        $cond = New-Object System.Windows.Automation.PropertyCondition($AE::NameProperty, [string]$req.name)
        $el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
      }
      if ($el -eq $null) { throw 'element not found' }
      $script:WithMeta = $true
      Out-Json @{ ok = $true; element = (Describe $el ([string]$req.path) 0) }
    }
    'tree' {
      $maxDepth = if ($req.maxDepth) { [int]$req.maxDepth } else { 6 }
      $maxNodes = if ($req.maxNodes) { [int]$req.maxNodes } else { 400 }
      $onlyNamed = [bool]$req.onlyNamed
      $script:WithMeta = [bool]$req.meta
      $skipOffscreen = -not [bool]$req.includeOffscreen
      $nodes = New-Object System.Collections.ArrayList

      function Walk($el, $path, $depth, $walker) {
        if ($nodes.Count -ge $maxNodes) { return }
        $d = Describe $el $path $depth
        # An offscreen control cannot be clicked, so it does not belong in the list — but
        # its subtree must still be walked: UWP content lives under a cloaked frame that
        # reports offscreen while every real control inside is perfectly visible.
        if (-not ($skipOffscreen -and $d.offscreen -and $depth -gt 0)) {
          if (-not $onlyNamed -or $d.name -ne '' -or $d.patterns.Count -gt 0) {
            [void]$nodes.Add($d)
          }
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
  return $script:Result
}
