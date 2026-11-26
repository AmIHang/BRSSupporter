; Tauri NSIS hooks. The daemon (brssupporter-node.exe) keeps running after the app window closes and
; locks its files, so an update or uninstall would fail to replace/remove them. Stop it first;
; the app starts it again on its next launch. SQLite (WAL) survives a hard stop.

!macro BRS_STOP_DAEMON
  nsExec::Exec 'taskkill /F /IM brssupporter-node.exe'
  Pop $0
  Sleep 1000
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro BRS_STOP_DAEMON
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro BRS_STOP_DAEMON
!macroend
