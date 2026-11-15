; Included by electron-builder's NSIS installer (nsis.include).
;
; Up to 0.8.x Insomnium was installed by Squirrel.Windows, per user, into
; %LOCALAPPDATA%\insomnium, with its own shortcuts and its own entry under
; Apps > Installed apps. This installer goes somewhere else, so without this
; an upgrade would leave two copies. Once the new files are in place, the old
; install is removed by its own uninstaller; settings and data are in
; %APPDATA%\Insomnium, which neither install owns and nothing here touches.

!macro removeSquirrelInstall
  Push $0
  Push $1
  StrCpy $1 "$LOCALAPPDATA\insomnium"
  ; Update.exe is what makes the folder a Squirrel install. Never when this
  ; install was pointed at that same folder.
  ${if} ${FileExists} "$1\Update.exe"
  ${andIf} $INSTDIR != $1
    DetailPrint "Removing the earlier install in $1"
    ; the old app, if it is open: its files are about to go
    nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -C "Get-CimInstance -ClassName Win32_Process | ? {$$_.Path -and $$_.Path.StartsWith('$1\', 'CurrentCultureIgnoreCase') -and $$_.Name -ne 'Update.exe'} | % { Stop-Process -Id $$_.ProcessId -Force }"`
    Pop $0
    Sleep 500
    ; removes the app folders, the shortcuts and the Installed apps entry
    nsExec::Exec '"$1\Update.exe" --uninstall -s'
    Pop $0
    DetailPrint "The earlier install's uninstaller returned $0"
    Sleep 1000
    ; what Squirrel leaves of itself (Update.exe, its log, a .dead marker)
    RMDir /r "$1"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\insomnium"

    ; The old uninstaller deletes shortcuts by name, and the desktop one has
    ; the name of the shortcut this installer just made: put back what it took.
    !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
      ${ifNot} ${FileExists} "$newStartMenuLink"
        CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
        ClearErrors
        WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
      ${endIf}
    !endif
    !ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT
      ${ifNot} ${isNoDesktopShortcut}
      ${andIfNot} ${FileExists} "$newDesktopLink"
        CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
        ClearErrors
        WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
      ${endIf}
    !endif
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${endIf}
  Pop $1
  Pop $0
!macroend

!macro customInstall
  !insertmacro removeSquirrelInstall
!macroend
