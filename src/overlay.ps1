# dsh-screen overlay helper.
# An always-on-top pill that says "DSH is driving this computer".
# Protocol (one command per line on stdin):
#   show <base64 utf8 text>
#   hide
#   quit
# Keep this file pure ASCII: it is started with -File and must survive any code page.
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

public static class DshNative {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
}

// stdin reader: a plain .NET thread, so the UI thread stays free to pump messages.
public static class DshIn {
  public static readonly ConcurrentQueue<string> Lines = new ConcurrentQueue<string>();
  public static volatile bool Eof = false;
  public static void Start() {
    Thread t = new Thread(delegate () {
      try {
        StreamReader sr = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
        string line;
        while ((line = sr.ReadLine()) != null) { Lines.Enqueue(line); }
      } catch { }
      Eof = true;
    });
    t.IsBackground = true;
    t.Start();
  }
}

public class DshBanner : Form {
  const int Radius = 20;
  public DshBanner() {
    FormBorderStyle = FormBorderStyle.None;
    TopMost = true;
    ShowInTaskbar = false;
    StartPosition = FormStartPosition.Manual;
    BackColor = Color.FromArgb(10, 16, 30);
    Opacity = 0.96;
    DoubleBuffered = true;
  }
  protected override bool ShowWithoutActivation { get { return true; } }
  protected override CreateParams CreateParams {
    get {
      CreateParams cp = base.CreateParams;
      cp.ExStyle |= 0x08000000;  // WS_EX_NOACTIVATE - never steal the keyboard
      cp.ExStyle |= 0x00000020;  // WS_EX_TRANSPARENT - clicks go through
      cp.ExStyle |= 0x00000080;  // WS_EX_TOOLWINDOW - keep it out of Alt+Tab
      return cp;
    }
  }
  public static GraphicsPath Rounded(Rectangle r, int radius) {
    GraphicsPath path = new GraphicsPath();
    int d = radius * 2;
    path.AddArc(r.X, r.Y, d, d, 180, 90);
    path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
    path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
    path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
    path.CloseFigure();
    return path;
  }
  public void Shape() {
    using (GraphicsPath path = Rounded(new Rectangle(0, 0, Width, Height), Radius)) {
      Region old = Region;
      Region = new Region(path);
      if (old != null) old.Dispose();
    }
  }
  protected override void OnPaint(PaintEventArgs e) {
    base.OnPaint(e);
    e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
    using (GraphicsPath path = Rounded(new Rectangle(1, 1, Width - 3, Height - 3), Radius)) {
      using (Pen pen = new Pen(Color.FromArgb(110, 150, 255), 2f)) {
        e.Graphics.DrawPath(pen, path);
      }
    }
  }
}
'@ -ReferencedAssemblies System.Windows.Forms, System.Drawing

try { [void][DshNative]::SetProcessDpiAwarenessContext([IntPtr]-4) } catch { }

$form = New-Object DshBanner
$label = New-Object System.Windows.Forms.Label
$label.AutoSize = $true
$label.ForeColor = [System.Drawing.Color]::White
$label.BackColor = [System.Drawing.Color]::FromArgb(10, 16, 30)
$label.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 16, [System.Drawing.FontStyle]::Bold)
$label.Padding = New-Object System.Windows.Forms.Padding(38, 20, 38, 20)
$label.Text = ' '
$form.Controls.Add($label)

$script:ShowBanner = {
  param([string]$text)
  $label.Text = $text
  $form.ClientSize = New-Object System.Drawing.Size($label.Width, $label.Height)
  $form.Shape()
  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $form.Location = New-Object System.Drawing.Point(
    [int]($bounds.X + ($bounds.Width - $form.Width) / 2),
    [int]($bounds.Y + 16))
  if (-not $form.Visible) { $form.Show() }
  $form.TopMost = $true
  $form.Invalidate()
}

[DshIn]::Start()

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 90
$timer.Add_Tick({
  $line = $null
  while ([DshIn]::Lines.TryDequeue([ref]$line)) {
    if ($line -eq 'hide') { $form.Hide() }
    elseif ($line -eq 'quit') { [System.Windows.Forms.Application]::ExitThread(); return }
    elseif ($line.StartsWith('show ')) {
      try {
        $text = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line.Substring(5)))
        & $script:ShowBanner $text
      } catch { }
    }
  }
  if ([DshIn]::Eof) { [System.Windows.Forms.Application]::ExitThread() }
})
$timer.Start()

$context = New-Object System.Windows.Forms.ApplicationContext
[System.Windows.Forms.Application]::Run($context)