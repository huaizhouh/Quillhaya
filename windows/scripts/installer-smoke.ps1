$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$package = Get-Content -LiteralPath (Join-Path $project 'package.json') -Raw | ConvertFrom-Json
$setup = Join-Path $project ('dist\Quillhaya-' + $package.version + '-Windows-x64-Setup.exe')
$node = Join-Path $project '.tools\node-v24.22.1-win-x64\node.exe'
if (!(Test-Path -LiteralPath $node)) { $node = (Get-Command node.exe -ErrorAction Stop).Source }
if (!(Test-Path -LiteralPath $setup)) { throw 'Build the installer with npm run dist:win first.' }

# Refuse to replace any existing Quillhaya installation or shortcuts.
$uninstallRoots = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')
function Find-Quillhaya {
  foreach ($root in $uninstallRoots) {
    Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue | Get-ItemProperty | Where-Object { $_.DisplayName -like '*Quillhaya*' }
  }
}
if (@(Find-Quillhaya).Count -ne 0) { throw 'An existing Quillhaya installation is registered. Use a clean test account.' }
$links = @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Quillhaya.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'Quillhaya.lnk'))
foreach ($link in $links) { if (Test-Path -LiteralPath $link) { throw ('Existing shortcut: ' + $link) } }
$installerCache = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'quillhaya-updater'
if (Test-Path -LiteralPath $installerCache) { throw 'An existing installer cache is present. Use a clean test account.' }

$testRoot = [IO.Path]::GetFullPath((Join-Path $project ('.cache\installer-smoke-' + [Guid]::NewGuid().ToString())))
if (!$testRoot.StartsWith((Join-Path $project '.cache\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe test directory' }
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$installation = Join-Path $testRoot ('installed ' + [char]0x4E2D + [char]0x6587)
$executable = Join-Path $installation 'Quillhaya.exe'
$uninstaller = Join-Path $installation 'Uninstall Quillhaya.exe'
$env:TEMP = $testRoot
$env:TMP = $testRoot
$report = Join-Path $project 'reports\installer.txt'
New-Item -ItemType Directory -Path (Split-Path $report) -Force | Out-Null

function Run-Setup {
  # NSIS requires /D last, without embedded quotes, even for a path with spaces.
  $process = Start-Process -FilePath $setup -ArgumentList @('/S', ('/D=' + $installation)) -PassThru -WindowStyle Hidden
  if (!$process.WaitForExit(120000)) { throw 'Installer timed out; inspect the test installation before retrying.' }
  if ($process.ExitCode -ne 0) { throw ('Installer exit code: ' + $process.ExitCode) }
  if (!(Test-Path -LiteralPath $executable)) { throw 'Installer did not create the requested EXE.' }
}

$installed = $false
try {
  Run-Setup
  $installed = $true
  $registered = @(Find-Quillhaya)
  if ($registered.Count -ne 1 -or $registered[0].DisplayVersion -ne $package.version) { throw 'Unexpected uninstall registration.' }
  $shell = New-Object -ComObject Shell.Application
  $wsh = New-Object -ComObject WScript.Shell
  foreach ($link in $links) {
    if (!(Test-Path -LiteralPath $link)) { throw ('Shortcut missing: ' + $link) }
    if ($wsh.CreateShortcut($link).TargetPath -ne $executable) { throw 'Shortcut targets the wrong executable.' }
    $item = $shell.NameSpace((Split-Path $link)).ParseName((Split-Path $link -Leaf))
    if ($item.ExtendedProperty('System.AppUserModel.ID') -ne 'com.zloyan.quillhaya') { throw 'Shortcut AppUserModelID mismatch.' }
  }
  & $node (Join-Path $project 'scripts\package-smoke.mjs') $executable
  if ($LASTEXITCODE -ne 0) { throw 'Installed EXE smoke test failed.' }
  $before = (Get-FileHash -LiteralPath (Join-Path $installation 'resources\app.asar') -Algorithm SHA256).Hash
  Run-Setup
  if ((Get-FileHash -LiteralPath (Join-Path $installation 'resources\app.asar') -Algorithm SHA256).Hash -ne $before) { throw 'Reinstall changed app.asar unexpectedly.' }
  & $node (Join-Path $project 'scripts\package-smoke.mjs') $executable
  if ($LASTEXITCODE -ne 0) { throw 'Reinstalled EXE smoke test failed.' }
  'PASS: per-user install to a Chinese/space path, shortcut target and AppUserModelID, installed EXE encryption/restart/HTTP smoke, same-version reinstall.' | Set-Content -LiteralPath $report -Encoding UTF8
} finally {
  if (Test-Path -LiteralPath $uninstaller) {
    # _?= avoids the copied uninstaller process; the validated test path is last.
    $resolvedInstall = [IO.Path]::GetFullPath($installation)
    if (!$resolvedInstall.StartsWith($testRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe uninstall target' }
    $process = Start-Process -FilePath $uninstaller -ArgumentList @('/S', ('_?=' + $resolvedInstall)) -PassThru -WindowStyle Hidden
    if (!$process.WaitForExit(120000)) { throw 'Uninstaller timed out.' }
    if ($process.ExitCode -ne 0) { throw ('Uninstaller exit code: ' + $process.ExitCode) }
    if (Test-Path -LiteralPath $executable) { throw 'Uninstall left the application EXE.' }
    if (@(Find-Quillhaya).Count -ne 0) { throw 'Uninstall left the registration.' }
    foreach ($link in $links) { if (Test-Path -LiteralPath $link) { throw 'Uninstall left a shortcut.' } }
    if (Test-Path -LiteralPath $report) { 'PASS: uninstall removed EXE, registration and both shortcuts. User appData was never opened by the test.' | Add-Content -LiteralPath $report -Encoding UTF8 }
  }
  # The NSIS installer caches itself outside the install directory. It did not
  # exist before this test; delete only the exact matching synthetic installer.
  $cachedSetup = Join-Path $installerCache 'installer.exe'
  if (Test-Path -LiteralPath $cachedSetup) {
    if ((Get-FileHash -LiteralPath $cachedSetup -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash) { throw 'Unexpected installer cache; preserve it for inspection.' }
    Remove-Item -LiteralPath $cachedSetup
    if (@(Get-ChildItem -LiteralPath $installerCache -Force).Count -eq 0) { Remove-Item -LiteralPath $installerCache }
  }
}
Get-Content -LiteralPath $report
