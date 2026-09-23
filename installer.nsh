; Do not run the previous NSIS uninstaller — it fails on locked Program Files
; copies and electron-builder then shows "Failed to uninstall old application files."
; Kill the process, delete the install folders, then remove uninstall registry keys
; so the new copy can land.

!macro customHeader
  !ifndef BUILD_UNINSTALLER
  Function KillPosProApp
    StrCpy $R9 0
    kill_again:
      IntOp $R9 $R9 + 1
      ExecWait 'cmd /c taskkill /F /T /IM "P.O.S. Pro.exe"'
      ExecWait 'powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "Get-Process | Where-Object { $$_.ProcessName -like $\"P.O.S*\" } | Stop-Process -Force -ErrorAction SilentlyContinue"'
      Sleep 1000
      nsExec::ExecToStack 'cmd /c tasklist /FI "IMAGENAME eq P.O.S. Pro.exe" | find /I "P.O.S. Pro.exe"'
      Pop $R8
      IntCmp $R8 0 still_running
        Goto kill_done
      still_running:
      IntCmp $R9 12 kill_done
      Goto kill_again
    kill_done:
    Sleep 1500
  FunctionEnd

  Function WipeOldPosPro
    Call KillPosProApp

    ReadRegStr $R0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.pospro.app" "InstallLocation"
    StrCmp $R0 "" skip_lm_loc
      ExecWait 'cmd /c rd /s /q "$R0"'
    skip_lm_loc:
    ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.pospro.app" "InstallLocation"
    StrCmp $R0 "" skip_cu_loc
      ExecWait 'cmd /c rd /s /q "$R0"'
    skip_cu_loc:

    StrCpy $R9 0
    wipe_again:
      IntOp $R9 $R9 + 1
      Call KillPosProApp
      ExecWait 'cmd /c rd /s /q "$PROGRAMFILES\P.O.S. Pro"'
      ExecWait 'cmd /c rd /s /q "$PROGRAMFILES64\P.O.S. Pro"'
      ExecWait 'cmd /c rd /s /q "$LOCALAPPDATA\Programs\P.O.S. Pro"'
      IfFileExists "$PROGRAMFILES\P.O.S. Pro\P.O.S. Pro.exe" still_there
      IfFileExists "$PROGRAMFILES64\P.O.S. Pro\P.O.S. Pro.exe" still_there
        Goto wipe_done
      still_there:
      IntCmp $R9 10 wipe_done
      Sleep 1000
      Goto wipe_again
    wipe_done:

    SetRegView 64
    DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.pospro.app"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.pospro.app"
    DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\P.O.S. Pro"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\P.O.S. Pro"
    SetRegView 32
    DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.pospro.app"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.pospro.app"
    SetRegView 64
  FunctionEnd
  !endif
!macroend

!macro customInit
  Call WipeOldPosPro
!macroend

!macro customCheckAppRunning
  !ifdef BUILD_UNINSTALLER
    DetailPrint "Closing P.O.S. Pro..."
    ExecWait 'cmd /c taskkill /F /T /IM "P.O.S. Pro.exe"'
  !else
    DetailPrint "Closing and removing previous P.O.S. Pro..."
    Call WipeOldPosPro
  !endif
!macroend
