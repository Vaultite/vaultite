; electron-builder's NSIS include (package.json build.nsis.include). Uninstalling takes what points at this install:
; the vaultite:// link the app registered as it started (electron/main.ts), and .md/.markdown's default (electron-builder
; removes only its own file type). An update (which uninstalls the version before it) keeps both.
!macro vaultiteDefault EXT
  ReadRegStr $0 HKCU "Software\Classes\.${EXT}" ""
  ${if} $0 != ""
    ReadRegStr $1 HKCU "Software\Classes\$0\shell\open\command" ""
    ${if} $1 == '$INSTDIR\${APP_EXECUTABLE_FILENAME} "%1"'
      DeleteRegValue HKCU "Software\Classes\.${EXT}" ""
    ${endIf}
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
  ${endIf}
!macroend
