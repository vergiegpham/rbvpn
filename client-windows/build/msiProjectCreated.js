/**
 * Patch electron-builder WiX project:
 * 1) "Run RB-VPN" after install (ShellExecute so requireAdministrator works)
 * 2) On uninstall: remove services, WireGuard leftovers, and %AppData%\rbvpn-windows
 */
const fs = require('fs');

module.exports = async function msiProjectCreated(projectFile) {
  let xml = fs.readFileSync(projectFile, 'utf8');

  xml = xml.replace(
    /<CustomAction Id="runAfterFinish" FileKey="mainExecutable" ExeCommand="" Execute="immediate" Impersonate="yes" Return="asyncNoWait"\s*\/>/,
    '<CustomAction Id="runAfterFinish" Directory="APPLICATIONFOLDER" ExeCommand="explorer.exe &quot;[#mainExecutable]&quot;" Execute="immediate" Impersonate="yes" Return="asyncNoWait"/>'
  );

  // Prefer NOT REMOVE so the Finish action still runs after a successful install.
  xml = xml.replace(
    'WIXUI_EXITDIALOGOPTIONALCHECKBOX = 1 AND NOT Installed',
    'WIXUI_EXITDIALOGOPTIONALCHECKBOX = 1 AND NOT REMOVE'
  );

  // MSI does not run NSIS customUnInstall — add cleanup custom actions.
  // WiX: $$ => literal $. Service name is WireGuardTunnel$RB-VPN.
  // Use APPLICATIONFOLDER/TARGETDIR (already in the project); System*Folder refs are not.
  if (!xml.includes('CleanupRbVpnUserData')) {
    const cleanup = `
    <CustomAction Id="CleanupRbVpnServices" Directory="APPLICATIONFOLDER" ExeCommand="[System64Folder]cmd.exe /c sc stop WireGuardTunnel$$RB-VPN &amp; sc delete WireGuardTunnel$$RB-VPN &amp; sc stop WireGuardManager &amp; sc delete WireGuardManager &amp; schtasks /Delete /F /TN &quot;RB-VPN Tunnel Cleanup&quot; &amp; rd /s /q &quot;[CommonAppDataFolder]RB-VPN&quot; &amp; rd /s /q &quot;[ProgramFiles64Folder]RB-VPN\\WireGuard&quot; &amp; rd /s /q &quot;[ProgramFiles64Folder]WireGuard&quot; &amp; powershell.exe -NoProfile -ExecutionPolicy Bypass -Command &quot;Get-ChildItem 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall' -EA SilentlyContinue | ForEach-Object { Get-ItemProperty $_.PSPath -EA SilentlyContinue } | Where-Object { $_.DisplayName -eq 'WireGuard' } | ForEach-Object { if ($_.UninstallString -match '{[0-9A-Fa-f-]+}') { Start-Process msiexec.exe -ArgumentList @('/x',$Matches[0],'/qn','/norestart') -Wait -WindowStyle Hidden } }&quot;" Execute="deferred" Impersonate="no" Return="ignore"/>
    <CustomAction Id="CleanupRbVpnUserData" Directory="TARGETDIR" ExeCommand="[SystemFolder]cmd.exe /c rd /s /q &quot;[AppDataFolder]rbvpn-windows&quot;" Execute="immediate" Impersonate="yes" Return="ignore"/>
    <InstallExecuteSequence>
      <Custom Action="CleanupRbVpnServices" Before="RemoveFiles">REMOVE="ALL"</Custom>
      <Custom Action="CleanupRbVpnUserData" After="InstallFinalize">REMOVE="ALL"</Custom>
    </InstallExecuteSequence>
`;
    xml = xml.replace('</Product>', `${cleanup}\n  </Product>`);
  }

  fs.writeFileSync(projectFile, xml);
  console.log('msiProjectCreated: patched runAfterFinish + uninstall cleanup');
};
