param([Parameter(Mandatory=$true)][string]$Target)
$ErrorActionPreference = 'Stop'
$acl = Get-Acl -LiteralPath $Target
$self = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allowed = @($self, 'S-1-5-18', 'S-1-5-32-544')
foreach ($entry in $acl.Access) {
  if ($entry.AccessControlType -eq 'Allow') {
    $sid = $entry.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
    if ($sid -notin $allowed) { throw 'Path permits another principal. Restrict its ACL before use.' }
  }
}
Write-Output 'PRIVATE'
