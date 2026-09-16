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
      nsExec::Exec 'sc query WireGuardManager'
      Pop $1
      StrCmp $1 "0" 0 skip_mgr
        ExecWait '"$0" /uninstallmanagerservice'
    skip_mgr:
  skip_runtime:
!macroend

!macro customUnInstall
  DetailPrint "Stopping RB-VPN tunnel..."
  StrCpy $0 ""
  IfFileExists "$PROGRAMFILES64\RB-VPN\WireGuard\wireguard.exe" 0 +2
    StrCpy $0 "$PROGRAMFILES64\RB-VPN\WireGuard\wireguard.exe"
  StrCmp $0 "" 0 +3
    IfFileExists "$PROGRAMFILES64\WireGuard\wireguard.exe" 0 skip_tun
      StrCpy $0 "$PROGRAMFILES64\WireGuard\wireguard.exe"
  nsExec::Exec 'sc query WireGuardTunnel$RB-VPN'
  Pop $1
  StrCmp $1 "0" 0 skip_tun
    ExecWait '"$0" /uninstalltunnelservice RB-VPN'
  skip_tun:
  nsExec::Exec 'schtasks /Delete /F /TN "RB-VPN Tunnel Cleanup"'
  Pop $1
  Delete "$COMMONPROGRAMDATA\RB-VPN\orphan-tunnel-cleanup.cmd"
  RMDir "$COMMONPROGRAMDATA\RB-VPN"
  RMDir /r "$PROGRAMFILES64\RB-VPN\WireGuard"
!macroend
