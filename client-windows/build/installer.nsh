!macro customInstall
  ; Place network runtime under RB-VPN\WireGuard (not Program Files\WireGuard).
  DetailPrint "Installing RB-VPN network runtime..."
  IfFileExists "$INSTDIR\resources\tunnel\rbvpn-network-runtime.msi" 0 skip_runtime
    CreateDirectory "$PROGRAMFILES64\RB-VPN"
    ; Administrative extract → $PROGRAMFILES64\RB-VPN\WireGuard\wireguard.exe
    ExecWait 'msiexec /a "$INSTDIR\resources\tunnel\rbvpn-network-runtime.msi" /qn TARGETDIR="$PROGRAMFILES64\RB-VPN"'
    Delete "$PROGRAMFILES64\RB-VPN\rbvpn-network-runtime.msi"

    StrCpy $0 "$PROGRAMFILES64\RB-VPN\WireGuard\wireguard.exe"
    IfFileExists $0 0 skip_mgr
      ; Silent — do not call wireguard /uninstall* (MessageBox if service missing).
      nsExec::ExecToStack 'sc stop WireGuardManager'
      Pop $1
      Pop $1
      nsExec::ExecToStack 'sc delete WireGuardManager'
      Pop $1
      Pop $1
    skip_mgr:
  skip_runtime:
!macroend

!macro customUnInstall
  DetailPrint "Stopping RB-VPN tunnel..."
  ; NSIS: use $$ for a literal $. Service name is WireGuardTunnel$RB-VPN.
  nsExec::ExecToStack 'sc stop WireGuardTunnel$$RB-VPN'
  Pop $1
  Pop $1
  nsExec::ExecToStack 'sc delete WireGuardTunnel$$RB-VPN'
  Pop $1
  Pop $1
  nsExec::ExecToStack 'sc stop WireGuardManager'
  Pop $1
  Pop $1
  nsExec::ExecToStack 'sc delete WireGuardManager'
  Pop $1
  Pop $1

  ; Remove leftover default WireGuard install (creates Data\log.bin).
  RMDir /r "$PROGRAMFILES64\WireGuard"

  nsExec::ExecToStack 'schtasks /Delete /F /TN "RB-VPN Tunnel Cleanup"'
  Pop $1
  Pop $1
  Delete "$COMMONPROGRAMDATA\RB-VPN\orphan-tunnel-cleanup.cmd"
  RMDir "$COMMONPROGRAMDATA\RB-VPN"
  RMDir /r "$PROGRAMFILES64\RB-VPN\WireGuard"
  ; Electron userData (package.json name) — login token, conf, logs
  SetShellVarContext current
  RMDir /r "$APPDATA\rbvpn-windows"
!macroend
