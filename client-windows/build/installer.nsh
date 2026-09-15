!macro customInstall
  ; Bundle network runtime inside RB-VPN Setup (not shown as a separate app).
  DetailPrint "Installing RB-VPN network runtime..."
  IfFileExists "$INSTDIR\resources\tunnel\rbvpn-network-runtime.msi" 0 skip_runtime
    ; ARPSYSTEMCOMPONENT=1 hides WireGuard from Apps & Features.
    ExecWait 'msiexec /i "$INSTDIR\resources\tunnel\rbvpn-network-runtime.msi" /qn /norestart ARPSYSTEMCOMPONENT=1'
    ; Tunnel service only — no WireGuard tray/manager UI.
    IfFileExists "$PROGRAMFILES64\WireGuard\wireguard.exe" 0 +2
      ExecWait '"$PROGRAMFILES64\WireGuard\wireguard.exe" /uninstallmanagerservice'
    IfFileExists "$PROGRAMFILES\WireGuard\wireguard.exe" 0 +2
      ExecWait '"$PROGRAMFILES\WireGuard\wireguard.exe" /uninstallmanagerservice'
  skip_runtime:
!macroend
