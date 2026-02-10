!macro customInit
  ; Forcefully kill the process using native Windows command
  ExecWait "taskkill /F /IM InkExplorer.exe"
  Sleep 1000
!macroend

!macro checkAppRunning
  ; Double check and kill again using native Windows command
  DetailPrint "Ensuring application is closed..."
  ExecWait "taskkill /F /IM InkExplorer.exe"
  Sleep 500
!macroend
