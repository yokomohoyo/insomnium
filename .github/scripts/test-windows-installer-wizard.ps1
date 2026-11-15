# Clicks through the Windows installer's wizard, and the uninstaller's, on a CI
# runner, and saves a screenshot of every page. Never run this on a computer
# with a real Insomnium install: it installs and removes the app.
#
#   test-windows-installer-wizard.ps1 -Installer <installer> -Screenshots <dir>
#
# 1. the wizard as it comes: "only for me" is preselected, the folder offered
#    is %LOCALAPPDATA%\Programs\Insomnium, "Run Insomnium" is unticked on the
#    last page, so nothing starts; then the uninstaller's wizard removes it.
# 2. "anyone who uses this computer", into a folder typed on the folder page,
#    with "Run Insomnium" left ticked, so the app starts from there.
#
# The runner has UAC off, so the elevation prompt is not part of this.
param(
  [Parameter(Mandatory)] [string] $Installer,
  [Parameter(Mandatory)] [string] $Screenshots
)

$ErrorActionPreference = 'Stop'
if (-not $env:CI) {
  throw 'This installs and uninstalls Insomnium; it only runs in CI.'
}

$Installer = (Resolve-Path $Installer).Path
New-Item -ItemType Directory -Force $Screenshots | Out-Null
$Screenshots = (Resolve-Path $Screenshots).Path
$script:failures = @()
$script:shot = 0

Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class WizardControl {
  public IntPtr Handle;
  public int Id;
  public string Class;
  public string Text;
  public bool Enabled;
}

public static class Wizard {
  delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder sb, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr hwnd, uint msg, IntPtr wParam, StringBuilder lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr hwnd, uint msg, IntPtr wParam, string lParam);
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr hwnd);
  [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }

  const uint WM_SETTEXT = 0x000C, WM_GETTEXT = 0x000D, WM_GETTEXTLENGTH = 0x000E;
  const uint BM_GETCHECK = 0x00F0, BM_CLICK = 0x00F5;

  static string ClassOf(IntPtr hwnd) {
    var sb = new StringBuilder(256);
    GetClassName(hwnd, sb, sb.Capacity);
    return sb.ToString();
  }

  public static string TextOf(IntPtr hwnd) {
    int length = (int)SendMessage(hwnd, WM_GETTEXTLENGTH, IntPtr.Zero, IntPtr.Zero);
    var sb = new StringBuilder(length + 2);
    SendMessage(hwnd, WM_GETTEXT, (IntPtr)sb.Capacity, sb);
    return sb.ToString();
  }

  // visible dialogs whose title has the given text
  public static List<IntPtr> Dialogs(string titleHas) {
    var found = new List<IntPtr>();
    EnumWindows((hwnd, l) => {
      if (IsWindowVisible(hwnd) && ClassOf(hwnd) == "#32770" && TextOf(hwnd).IndexOf(titleHas, StringComparison.OrdinalIgnoreCase) >= 0) {
        found.Add(hwnd);
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  // every visible control of the dialog and of the page inside it
  public static List<WizardControl> Controls(IntPtr dialog) {
    var found = new List<WizardControl>();
    EnumChildWindows(dialog, (hwnd, l) => {
      if (IsWindowVisible(hwnd)) {
        found.Add(new WizardControl {
          Handle = hwnd, Id = GetDlgCtrlID(hwnd), Class = ClassOf(hwnd), Text = TextOf(hwnd), Enabled = IsWindowEnabled(hwnd),
        });
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  public static void Click(IntPtr dialog, IntPtr control) {
    SetForegroundWindow(dialog);
    SendMessage(control, BM_CLICK, IntPtr.Zero, IntPtr.Zero);
  }

  public static bool IsChecked(IntPtr control) {
    return (int)SendMessage(control, BM_GETCHECK, IntPtr.Zero, IntPtr.Zero) == 1;
  }

  public static void SetText(IntPtr control, string text) {
    SendMessage(control, WM_SETTEXT, IntPtr.Zero, text);
  }

  public static RECT Rect(IntPtr hwnd) {
    RECT rect;
    GetWindowRect(hwnd, out rect);
    return rect;
  }

  public static void Foreground(IntPtr hwnd) { SetForegroundWindow(hwnd); }
  public static void DpiAware() { SetProcessDPIAware(); }
}
'@
[Wizard]::DpiAware()

function Check([bool] $ok, [string] $what) {
  if ($ok) {
    Write-Host "ok    $what"
  } else {
    Write-Host "FAIL  $what"
    $script:failures += $what
  }
}

function Wait-Until([scriptblock] $condition, [int] $seconds) {
  for ($i = 0; $i -lt $seconds * 2; $i++) {
    if (& $condition) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return [bool](& $condition)
}

function Save-Screenshot([IntPtr] $dialog, [string] $name) {
  $script:shot++
  $file = Join-Path $Screenshots ('{0:d2}-{1}.png' -f $script:shot, ($name -replace '[^A-Za-z0-9]+', '-').Trim('-').ToLower())
  try {
    [Wizard]::Foreground($dialog)
    Start-Sleep -Milliseconds 300
    $r = [Wizard]::Rect($dialog)
    $bitmap = New-Object System.Drawing.Bitmap ($r.Right - $r.Left), ($r.Bottom - $r.Top)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($r.Left, $r.Top, 0, 0, $bitmap.Size)
    $bitmap.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bitmap.Dispose()
    Write-Host "screenshot: $(Split-Path $file -Leaf)"
  } catch {
    Write-Host "no screenshot of '$name': $_"
  }
}

# Goes through a wizard page by page until its window is gone. $onPage gets
# each new page (a name and its controls) before its main button is pressed,
# and can change the page; the pages seen come back, in order.
function Invoke-Wizard([string] $titleHas, [string] $label, [scriptblock] $onPage, [int] $timeoutSeconds = 420) {
  $pages = @()
  $last = ''
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  if (-not (Wait-Until { [Wizard]::Dialogs($titleHas).Count -gt 0 } 60)) {
    Check $false "$label, a window with '$titleHas' in its title opens"
    return $pages
  }
  while ((Get-Date) -lt $deadline) {
    $dialogs = [Wizard]::Dialogs($titleHas)
    if ($dialogs.Count -eq 0) {
      # one copy of the installer can hand over to another
      if (Wait-Until { [Wizard]::Dialogs($titleHas).Count -gt 0 } 5) { continue }
      return $pages
    }
    $dialog = $dialogs[0]
    $controls = [Wizard]::Controls($dialog)
    $main = $controls | Where-Object { $_.Id -eq 1 -and $_.Class -eq 'Button' } | Select-Object -First 1
    if (-not $main -or -not $main.Enabled) {
      Start-Sleep -Milliseconds 500
      continue
    }
    # 1037 is the heading of an inner page; the first and last page have none
    $heading = ($controls | Where-Object { $_.Id -eq 1037 } | Select-Object -First 1).Text
    if (-not $heading) {
      $heading = ($controls | Where-Object { $_.Class -eq 'Static' -and $_.Text } | Select-Object -First 1).Text
    }
    $name = "$heading [$($main.Text -replace '&', '')]"
    if ($name -eq $last) {
      # the press has not taken yet
      Start-Sleep -Milliseconds 500
      continue
    }
    $last = $name
    # let the page finish drawing, then read it again
    Start-Sleep -Milliseconds 700
    $controls = [Wizard]::Controls($dialog)
    Write-Host "--- $label page $($pages.Count + 1): $name"
    $controls | Where-Object { $_.Text -and $_.Class -in 'Button', 'Static', 'Edit' } | ForEach-Object {
      $state = if ($_.Class -eq 'Button' -and [Wizard]::IsChecked($_.Handle)) { ' (selected)' } else { '' }
      Write-Host ("    {0,-7} {1,5}  {2}{3}" -f $_.Class, $_.Id, ($_.Text -replace '\s+', ' '), $state)
    }
    $page = [pscustomobject]@{ Name = $name; Dialog = $dialog; Controls = $controls }
    $pages += $page
    if ($onPage) { & $onPage $page }
    Save-Screenshot $dialog "$label $($pages.Count) $heading"
    $main = [Wizard]::Controls($dialog) | Where-Object { $_.Id -eq 1 -and $_.Class -eq 'Button' } | Select-Object -First 1
    if ($main) { [Wizard]::Click($dialog, $main.Handle) }
    Start-Sleep -Milliseconds 500
  }
  Check $false "$label finishes within $timeoutSeconds s (stuck on '$last')"
  [Wizard]::Dialogs($titleHas) | ForEach-Object { Save-Screenshot $_ "$label stuck" }
  return $pages
}

function Find-Control($page, [string] $class, [string] $textLike) {
  $page.Controls | Where-Object { $_.Class -eq $class -and $_.Text -like $textLike } | Select-Object -First 1
}

function Get-UninstallEntries {
  @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall') |
    Where-Object { Test-Path $_ } |
    ForEach-Object { Get-ChildItem $_ } |
    ForEach-Object { Get-ItemProperty $_.PSPath } |
    Where-Object { $_.DisplayName -like 'Insomnium*' }
}
function Get-AppProcesses {
  Get-CimInstance -ClassName Win32_Process | Where-Object { $_.Name -eq 'Insomnium.exe' }
}
function Show-Entries {
  Get-UninstallEntries | ForEach-Object {
    Write-Host "installed apps:   $($_.DisplayName) $($_.DisplayVersion) [$($_.PSPath -replace '^.*::', '')] $($_.UninstallString)"
  }
}
function Get-Uninstaller {
  $entry = Get-UninstallEntries | Select-Object -First 1
  if ($entry.UninstallString -match '^"([^"]+)"\s*(.*)$') { @{ Exe = $Matches[1]; Arguments = $Matches[2] } } else { $null }
}

$perUserDir = Join-Path $env:LOCALAPPDATA 'Programs\Insomnium'
Check (@(Get-UninstallEntries).Count -eq 0 -and -not (Test-Path $perUserDir)) 'the runner starts with no install'

# ------------------------------------------------- 1. the wizard as it comes
Write-Host "`n=== the wizard, as it comes"
$state = @{}
Start-Process $Installer
$pages = Invoke-Wizard 'Insomnium' 'install' {
  param($page)
  $me = Find-Control $page 'Button' '*Only for me*'
  if ($me) {
    $state.modePage = $true
    $state.meSelected = [Wizard]::IsChecked($me.Handle)
    $state.everyoneOffered = [bool](Find-Control $page 'Button' '*Anyone who uses this computer*')
  }
  $folder = $page.Controls | Where-Object { $_.Class -eq 'Edit' } | Select-Object -First 1
  if ($folder) {
    $state.folderPage = $true
    $state.folder = $folder.Text
  }
  $run = Find-Control $page 'Button' '*Run Insomnium*'
  if ($run) {
    $state.runOffered = $true
    $state.runTicked = [Wizard]::IsChecked($run.Handle)
    if ($state.runTicked) { [Wizard]::Click($page.Dialog, $run.Handle) }
    $state.runTickedAfter = [Wizard]::IsChecked($run.Handle)
  }
}
Write-Host "pages: $(($pages | ForEach-Object Name) -join ' > ')"
Show-Entries
Check ($pages.Count -ge 3) 'the installer shows its pages and closes'
Check ([bool]$state.modePage) 'there is a page to choose who the install is for'
Check ([bool]$state.meSelected) '"Only for me" is preselected'
Check ([bool]$state.everyoneOffered) '"Anyone who uses this computer" is offered'
Check ([bool]$state.folderPage) 'there is a page to choose the folder'
Check ($state.folder -eq $perUserDir) "the folder offered is $perUserDir (was '$($state.folder)')"
Check ([bool]$state.runOffered -and [bool]$state.runTicked) 'the last page offers "Run Insomnium", ticked'
Check ($state.runOffered -and -not $state.runTickedAfter) '"Run Insomnium" can be unticked'
Check (Test-Path (Join-Path $perUserDir 'Insomnium.exe')) "Insomnium.exe is in $perUserDir"
$entries = @(Get-UninstallEntries)
Check ($entries.Count -eq 1 -and $entries[0].PSPath -like '*HKEY_CURRENT_USER*') 'there is one Installed apps entry, for this user'
Start-Sleep -Seconds 5
Check (@(Get-AppProcesses).Count -eq 0) 'with "Run Insomnium" unticked, the app was not started'

Write-Host "`n=== the uninstaller's wizard"
$uninstaller = Get-Uninstaller
Check ($uninstaller -and (Test-Path $uninstaller.Exe)) "the Installed apps entry names the uninstaller ($($uninstaller.Exe) $($uninstaller.Arguments))"
if ($uninstaller -and (Test-Path $uninstaller.Exe)) {
  # what Installed apps runs
  if ($uninstaller.Arguments) {
    Start-Process $uninstaller.Exe -ArgumentList $uninstaller.Arguments
  } else {
    Start-Process $uninstaller.Exe
  }
  $pages = Invoke-Wizard 'Insomnium' 'uninstall' $null
  Write-Host "pages: $(($pages | ForEach-Object Name) -join ' > ')"
  Check ($pages.Count -ge 2) 'the uninstaller shows its pages and closes'
}
[void](Wait-Until { -not (Test-Path (Join-Path $perUserDir 'Insomnium.exe')) -and @(Get-UninstallEntries).Count -eq 0 } 60)
Show-Entries
Check (-not (Test-Path (Join-Path $perUserDir 'Insomnium.exe'))) 'after the uninstaller, Insomnium.exe is gone'
Check (@(Get-UninstallEntries).Count -eq 0) 'after the uninstaller, the Installed apps entry is gone'

# ------------------------------------- 2. for everyone, into a typed folder
Write-Host "`n=== the wizard, for everyone, into another folder"
$customDir = 'C:\InsomniumWizardTest\Insomnium'
$state = @{}
Start-Process $Installer
$pages = Invoke-Wizard 'Insomnium' 'install-everyone' {
  param($page)
  $everyone = Find-Control $page 'Button' '*Anyone who uses this computer*'
  if ($everyone) {
    [Wizard]::Click($page.Dialog, $everyone.Handle)
    $state.everyoneSelected = [Wizard]::IsChecked($everyone.Handle)
  }
  $folder = $page.Controls | Where-Object { $_.Class -eq 'Edit' } | Select-Object -First 1
  if ($folder) {
    $state.folderOffered = $folder.Text
    [Wizard]::SetText($folder.Handle, $customDir)
    $state.folderTyped = [Wizard]::TextOf($folder.Handle)
  }
  $run = Find-Control $page 'Button' '*Run Insomnium*'
  if ($run) { $state.runTicked = [Wizard]::IsChecked($run.Handle) }
}
Write-Host "pages: $(($pages | ForEach-Object Name) -join ' > ')"
Show-Entries
Check ([bool]$state.everyoneSelected) '"Anyone who uses this computer" can be selected'
Check ($state.folderOffered -eq (Join-Path $env:ProgramFiles 'Insomnium')) "for everyone, the folder offered is under Program Files (was '$($state.folderOffered)')"
Check ($state.folderTyped -eq $customDir) 'another folder can be typed'
$customExe = Join-Path $customDir 'Insomnium.exe'
Check (Test-Path $customExe) "Insomnium.exe is in $customDir"
$entries = @(Get-UninstallEntries)
Check ($entries.Count -eq 1 -and $entries[0].PSPath -like '*HKEY_LOCAL_MACHINE*') 'there is one Installed apps entry, for the computer'
Check ([bool]$state.runTicked) '"Run Insomnium" is ticked on the last page'
$started = Wait-Until { @(Get-AppProcesses | Where-Object { $_.Path -eq $customExe }).Count -gt 0 } 60
Check $started 'with "Run Insomnium" ticked, the app starts from the folder typed'
if ($started) {
  # give the window time to show, for the screenshot
  Start-Sleep -Seconds 20
  try {
    $screen = [System.Drawing.Rectangle]::new(0, 0, 1920, 1080)
    $bitmap = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen(0, 0, 0, 0, $bitmap.Size)
    $bitmap.Save((Join-Path $Screenshots '99-desktop-after-run.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bitmap.Dispose()
  } catch {
    Write-Host "no desktop screenshot: $_"
  }
}
Get-AppProcesses | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 3

# leave the runner as it was, for whatever runs next
$entry = Get-UninstallEntries | Select-Object -First 1
if ($entry.QuietUninstallString) {
  cmd.exe /c $entry.QuietUninstallString
  [void](Wait-Until { @(Get-UninstallEntries).Count -eq 0 -and -not (Test-Path $customExe) } 90)
}
Check (@(Get-UninstallEntries).Count -eq 0 -and -not (Test-Path $customExe)) 'the install for everyone uninstalls'

Write-Host ''
if ($script:failures.Count -gt 0) {
  Write-Host "$($script:failures.Count) check(s) failed:"
  $script:failures | ForEach-Object { Write-Host "  $_" }
  exit 1
}
Write-Host 'All checks passed'
