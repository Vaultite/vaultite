; electron-builder's NSIS include (package.json build.nsis.include). Uninstalling takes what points at this install:
; the vaultite:// link the app registered as it started (electron/main.ts), .md/.markdown's default (electron-builder
; removes only its own file type) and Set up's vau (electron/setup.ts). An update (which uninstalls the version before it) keeps them.
!macro vaultiteDefault EXT
  ReadRegStr $0 HKCU "Software\Classes\.${EXT}" ""
  ${if} $0 != ""
    ReadRegStr $1 HKCU "Software\Classes\$0\shell\open\command" ""
    ${if} $1 == '$INSTDIR\${APP_EXECUTABLE_FILENAME} "%1"'
      DeleteRegValue HKCU "Software\Classes\.${EXT}" ""
    ${endIf}
  ${endIf}
!macroend

; vau.cmd's second line names the executable that runs it: "rem vau, ... (Vaultite.exe runs it as Node)."
!macro vaultiteVau
  StrCpy $R0 "$LOCALAPPDATA\Vaultite\bin"
  ClearErrors
  FileOpen $0 "$R0\vau.cmd" r
  ${ifNot} ${errors}
    FileRead $0 $1
    FileRead $0 $1
    FileClose $0
    StrCpy $2 "(${APP_EXECUTABLE_FILENAME} runs it as Node)"
    StrLen $3 $2
    StrCpy $4 0
    ${do}
      StrCpy $5 $1 $3 $4
      ${if} $5 == $2
        Delete "$R0\vau.cmd"
        Delete "$R0\vau"
        RMDir "$R0"
        RMDir "$LOCALAPPDATA\Vaultite"
        ${break}
      ${endIf}
      IntOp $4 $4 + 1
    ${loopUntil} $5 == ""
  ${endIf}
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ReadRegStr $0 HKCU "Software\Classes\vaultite\shell\open\command" ""
    ${if} $0 == '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
      DeleteRegKey HKCU "Software\Classes\vaultite"
    ${endIf}
    !insertmacro vaultiteDefault "md"
    !insertmacro vaultiteDefault "markdown"
    !insertmacro vaultiteVau
  ${endIf}
!macroend
