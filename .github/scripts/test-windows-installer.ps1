# Installs, runs, upgrades and uninstalls the Windows installer on a CI runner.
# Never run this on a computer with a real Insomnium install: it installs and
# removes the app for the current user.
#
#   test-windows-installer.ps1 -Installer <new installer> [-Kind nsis|msi]
#                              [-SquirrelInstaller <a 0.8.x Insomnium.Core-x.exe>]
#
# 1. fresh: a silent install; the app starts and sends a request
#    (scripts/verify-smoke.mjs); a silent uninstall leaves %APPDATA%\Insomnium.
# 2. upgrade (with -SquirrelInstaller): the old Squirrel install, running, is
#    replaced: one install, one Start Menu and one desktop shortcut, one
#    Installed apps entry, nothing left in %LOCALAPPDATA%\insomnium, the data
#    untouched, and the new app works.
# 3. the same upgrade, installing for everyone on the computer (NSIS only).
# 4. an install into a folder inside the old Squirrel install leaves it alone
#    (NSIS only).
param(
  [Parameter(Mandatory)] [string] $Installer,
  [ValidateSet('nsis', 'msi')] [string] $Kind = 'nsis',
  [string] $SquirrelInstaller = ''
)

$ErrorActionPreference = 'Stop'
if (-not $env:CI) {
  throw 'This installs and uninstalls Insomnium for the current user; it only runs in CI.'
}

$Installer = (Resolve-Path $Installer).Path
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$squirrelDir = Join-Path $env:LOCALAPPDATA 'insomnium'
$dataDir = Join-Path $env:APPDATA 'Insomnium'
$marker = Join-Path $dataDir 'installer-test-marker.txt'
$script:failures = @()

function Check([bool] $ok, [string] $what) {
  if ($ok) {
    Write-Host "ok    $what"
  } else {
    Write-Host "FAIL  $what"
    $script:failures += $what
  }
}

function Get-Shortcuts([string[]] $dirs) {
  $dirs | Where-Object { Test-Path $_ } | ForEach-Object {
    Get-ChildItem $_ -Recurse -Filter '*.lnk' -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '*Insomnium*' }
  }
}
function Get-StartMenuShortcuts {
  Get-Shortcuts @(
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
    (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs'))
}
function Get-DesktopShortcuts {
  Get-Shortcuts @([Environment]::GetFolderPath('Desktop'), (Join-Path $env:PUBLIC 'Desktop'))
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
function Get-InstalledExe {
  @((Join-Path $env:LOCALAPPDATA 'Programs\Insomnium\Insomnium.exe'),
    (Join-Path $env:ProgramFiles 'Insomnium\Insomnium.exe')) |
    Where-Object { Test-Path $_ } | Select-Object -First 1
}
function Get-AppProcesses([string] $under) {
  Get-CimInstance -ClassName Win32_Process |
    Where-Object { $_.Path -and $_.Path.StartsWith($under, 'CurrentCultureIgnoreCase') }
}
function Wait-Until([scriptblock] $condition, [int] $seconds) {
  for ($i = 0; $i -lt $seconds; $i++) {
    if (& $condition) { return $true }
    Start-Sleep -Seconds 1
  }
  return [bool](& $condition)
}

function Show-State([string] $title) {
  Write-Host "--- $title"
  Write-Host "installed exe:    $(Get-InstalledExe)"
  Write-Host "squirrel folder:  $(if (Test-Path $squirrelDir) { (Get-ChildItem $squirrelDir -Force | ForEach-Object Name) -join ', ' } else { '(none)' })"
  Get-StartMenuShortcuts | ForEach-Object { Write-Host "start menu:       $($_.FullName)" }
  Get-DesktopShortcuts | ForEach-Object { Write-Host "desktop:          $($_.FullName)" }
  Get-UninstallEntries | ForEach-Object {
    Write-Host "installed apps:   $($_.DisplayName) $($_.DisplayVersion) [$($_.PSPath -replace '^.*::', '')] at $($_.InstallLocation)"
  }
}

function Install-New([string[]] $more = @()) {
  $started = Get-Date
  if ($Kind -eq 'msi') {
    $log = Join-Path $env:RUNNER_TEMP "msi-install-$(Get-Date -Format HHmmss).log"
    $p = Start-Process msiexec.exe -ArgumentList @('/i', "`"$Installer`"", '/qn', '/norestart', '/l*v', "`"$log`"") -Wait -PassThru
  } else {
    $p = Start-Process $Installer -ArgumentList (@('/S') + $more) -Wait -PassThru
  }
  Write-Host "installer exit code $($p.ExitCode) after $([int]((Get-Date) - $started).TotalSeconds) s"
  Check ($p.ExitCode -eq 0) 'the silent install exits 0'
  # the NSIS installer hands over to a copy of itself before it is done
  [void](Wait-Until { [bool](Get-InstalledExe) } 60)
}

function Uninstall-New {
  if ($Kind -eq 'msi') {
    $p = Start-Process msiexec.exe -ArgumentList @('/x', "`"$Installer`"", '/qn', '/norestart') -Wait -PassThru
    Check ($p.ExitCode -eq 0) 'the silent uninstall exits 0'
  } else {
    $entry = Get-UninstallEntries | Select-Object -First 1
    Check ([bool]$entry.QuietUninstallString) 'the Installed apps entry has a silent uninstall command'
    cmd.exe /c $entry.QuietUninstallString
  }
  # the NSIS uninstaller also carries on from a copy of itself
  [void](Wait-Until { -not (Get-InstalledExe) -and -not (Get-UninstallEntries) } 90)
}

function Test-Smoke([string] $what) {
  $exe = Get-InstalledExe
  if (-not $exe) {
    Check $false "$what (nothing is installed)"
    return
  }
  $env:APP_EXE = $exe
  & node (Join-Path $repo 'scripts\verify-smoke.mjs')
  Check ($LASTEXITCODE -eq 0) $what
  Remove-Item Env:APP_EXE
}

function Check-OneInstall([string] $when) {
  Check ([bool](Get-InstalledExe)) "$when, Insomnium.exe is installed"
  Check (@(Get-StartMenuShortcuts).Count -eq 1) "$when, there is one Start Menu shortcut"
  Check (@(Get-DesktopShortcuts).Count -eq 1) "$when, there is one desktop shortcut"
  Check (@(Get-UninstallEntries).Count -eq 1) "$when, there is one Installed apps entry"
}

# ---------------------------------------------------------------- 1. fresh
Write-Host "`n=== fresh install ($Kind): $Installer ($([int]((Get-Item $Installer).Length / 1MB)) MB)"
Show-State 'before'
Check (-not (Get-InstalledExe) -and -not (Test-Path $squirrelDir)) 'the runner starts with no install'

Install-New
Show-State 'after the install'
Check-OneInstall 'after a fresh install'
Test-Smoke 'the freshly installed app starts and sends a request'

New-Item -ItemType Directory -Force $dataDir | Out-Null
Set-Content $marker 'kept'

Uninstall-New
Show-State 'after the uninstall'
Check (-not (Get-InstalledExe)) 'after the uninstall, Insomnium.exe is gone'
Check (@(Get-StartMenuShortcuts).Count -eq 0 -and @(Get-DesktopShortcuts).Count -eq 0) 'after the uninstall, its shortcuts are gone'
Check (@(Get-UninstallEntries).Count -eq 0) 'after the uninstall, its Installed apps entry is gone'
Check ((Test-Path $marker) -and (Get-Content $marker) -eq 'kept') 'after the uninstall, %APPDATA%\Insomnium is as it was'

# -------------------------------------------------------------- 2. upgrade
$squirrelStartMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\yokomohoyo'

function Test-Upgrade([string] $title, [string[]] $more, [string] $expectedExe) {
  Write-Host "`n=== $title"
  Start-Process $SquirrelInstaller -ArgumentList '--silent' -Wait
  $installedOld = Wait-Until { (Test-Path (Join-Path $squirrelDir 'Update.exe')) -and (Get-ChildItem $squirrelDir -Filter 'app-*' -Directory | ForEach-Object { Test-Path (Join-Path $_.FullName 'Insomnium.exe') }) -contains $true } 240
  Check $installedOld 'the Squirrel installer installed the old version'
  # its first-run hook makes the shortcuts a moment later
  [void](Wait-Until { @(Get-DesktopShortcuts).Count -ge 1 } 30)
  Show-State 'with the old version installed'

  # the old app, running while the new installer runs
  $oldExe = Get-ChildItem $squirrelDir -Filter 'app-*' -Directory | ForEach-Object { Join-Path $_.FullName 'Insomnium.exe' } | Where-Object { Test-Path $_ } | Select-Object -First 1
  $env:INSOMNIA_DATA_PATH = Join-Path $env:RUNNER_TEMP 'old-app-data'
  Start-Process $oldExe
  Remove-Item Env:INSOMNIA_DATA_PATH
  Check (Wait-Until { @(Get-AppProcesses $squirrelDir).Count -gt 0 } 30) 'the old app is running'
  Start-Sleep -Seconds 10

  Install-New $more
  # Squirrel finishes removing itself a moment after its uninstaller returns
  [void](Wait-Until { -not (Test-Path $squirrelDir) } 30)
  Show-State 'after the upgrade'
  Check (-not (Test-Path $squirrelDir)) 'after the upgrade, %LOCALAPPDATA%\insomnium is gone'
  Check (-not (Test-Path $squirrelStartMenu)) 'after the upgrade, the old Start Menu folder is gone'
  if ($expectedExe) {
    Check ((Get-InstalledExe) -eq $expectedExe) "after the upgrade, the app is in $(Split-Path $expectedExe)"
  }
  Check (@(Get-AppProcesses $squirrelDir).Count -eq 0) 'after the upgrade, the old app is not running'
  Check-OneInstall 'after the upgrade'
  $target = Get-DesktopShortcuts | Select-Object -First 1 | ForEach-Object { (New-Object -ComObject WScript.Shell).CreateShortcut($_.FullName).TargetPath }
  Check ($target -eq (Get-InstalledExe)) "after the upgrade, the desktop shortcut opens the new install ($target)"
  Check ((Test-Path $marker) -and (Get-Content $marker) -eq 'kept') 'after the upgrade, %APPDATA%\Insomnium is as it was'
  Test-Smoke 'the upgraded app starts and sends a request'
}

if ($SquirrelInstaller) {
  $SquirrelInstaller = (Resolve-Path $SquirrelInstaller).Path
  $perUser = Join-Path $env:LOCALAPPDATA 'Programs\Insomnium\Insomnium.exe'
  $perMachine = Join-Path $env:ProgramFiles 'Insomnium\Insomnium.exe'
  if ($Kind -eq 'nsis') {
    Test-Upgrade "upgrade from the Squirrel install: $SquirrelInstaller" @() $perUser
    Uninstall-New
    Check (-not (Get-InstalledExe) -and @(Get-UninstallEntries).Count -eq 0) 'the upgraded install uninstalls'
    Test-Upgrade 'upgrade from the Squirrel install, for everyone on the computer' @('/allusers') $perMachine
    Check ((Get-UninstallEntries | Select-Object -First 1).PSPath -like '*HKEY_LOCAL_MACHINE*') 'the install for everyone is registered for the computer'

    # 4. an install pointed inside the old Squirrel folder leaves the old
    #    install alone: removing it would take the new files too
    Uninstall-New
    Write-Host "`n=== install into a folder inside the Squirrel install"
    Start-Process $SquirrelInstaller -ArgumentList '--silent' -Wait
    Check (Wait-Until { Test-Path (Join-Path $squirrelDir 'Update.exe') } 240) 'the Squirrel installer installed the old version again'
    [void](Wait-Until { @(Get-DesktopShortcuts).Count -ge 1 } 30)
    $nested = Join-Path $squirrelDir 'nested'
    # /D has to come last and takes no quotes
    $p = Start-Process $Installer -ArgumentList @('/S', "/D=$nested") -Wait -PassThru
    Check ($p.ExitCode -eq 0) 'the silent install into the nested folder exits 0'
    $findNested = { Get-ChildItem $nested -Recurse -Filter 'Insomnium.exe' -ErrorAction SilentlyContinue | Select-Object -First 1 }
    [void](Wait-Until { [bool](& $findNested) } 60)
    Start-Sleep -Seconds 5
    Show-State 'after the nested install'
    Check ([bool](& $findNested)) 'the nested install is still there'
    Check (Test-Path (Join-Path $squirrelDir 'Update.exe')) 'the Squirrel install it sits in was left alone'
  } else {
    # an MSI is built for one or the other
    Test-Upgrade "upgrade from the Squirrel install: $SquirrelInstaller" @() ''
  }
}

Write-Host ''
if ($script:failures.Count -gt 0) {
  Write-Host "$($script:failures.Count) check(s) failed:"
  $script:failures | ForEach-Object { Write-Host "  $_" }
  exit 1
}
Write-Host 'All checks passed'
