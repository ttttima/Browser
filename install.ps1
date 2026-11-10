# Installs Nya for the current user - no administrator rights needed.
#
#   irm https://raw.githubusercontent.com/ttttima/Browser/main/install.ps1 | iex
#
# Downloads the newest Nya release from GitHub, puts it in
# %LOCALAPPDATA%\Programs\Nya, adds Start menu and desktop shortcuts and an
# entry in Windows "Installed apps" (with uninstall), then starts Nya.
# Running it again updates Nya to the newest version.

param(
    # Install from a local zip instead of downloading (for testing).
    [string]$ZipPath,
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\Nya'),
    [switch]$NoLaunch
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # much faster downloads in PowerShell 5
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = 'ttttima/Browser'
$AppName = 'Nya'
$Exe = Join-Path $InstallDir 'Nya.exe'

function Write-Step($text) { Write-Host "  $text" -ForegroundColor Gray }

Write-Host ''
Write-Host "  Installing $AppName" -ForegroundColor White
Write-Host ''

# --- 1. Get the zip --------------------------------------------------------
$temp = Join-Path ([IO.Path]::GetTempPath()) ("nya-install-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force $temp | Out-Null
try {
    if ($ZipPath) {
        $zip = (Resolve-Path $ZipPath).Path
        $version = ([regex]::Match((Split-Path $zip -Leaf), '\d+\.\d+\.\d+')).Value
    } else {
        Write-Step 'Finding the newest version...'
        # All releases (not /latest), so preview releases count too.
        $releases = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases" `
            -Headers @{ 'User-Agent' = 'Nya-installer' }
        $release = $releases | Where-Object { -not $_.draft } | Select-Object -First 1
        $asset = $release.assets | Where-Object { $_.name -like '*portable.zip' } |
            Select-Object -First 1
        if (-not $asset) { throw "No download found in the newest release." }
        $version = $release.tag_name.TrimStart('v')
        $zip = Join-Path $temp $asset.name
        Write-Step "Downloading Nya $version ($([math]::Round($asset.size / 1MB)) MB)..."
        Invoke-WebRequest $asset.browser_download_url -OutFile $zip -UseBasicParsing
    }

    # --- 2. Close a running Nya and replace the old files --------------------
    Get-Process -Name 'Nya' -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path.StartsWith($InstallDir, 'OrdinalIgnoreCase') } |
        Stop-Process -Force
    Start-Sleep -Milliseconds 500

    Write-Step 'Installing...'
    $unpacked = Join-Path $temp 'app'
    Expand-Archive -Path $zip -DestinationPath $unpacked -Force
    # The zip may hold the files directly or inside one folder.
    $source = $unpacked
    if (-not (Test-Path (Join-Path $source 'Nya.exe'))) {
        $inner = Get-ChildItem $unpacked -Directory | Select-Object -First 1
        if ($inner -and (Test-Path (Join-Path $inner.FullName 'Nya.exe'))) { $source = $inner.FullName }
        else { throw 'The download does not contain Nya.exe.' }
    }
    if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
    New-Item -ItemType Directory -Force (Split-Path $InstallDir) | Out-Null
    Move-Item $source $InstallDir
    Get-ChildItem $InstallDir -Recurse -File | Unblock-File

    # --- 3. Shortcuts ---------------------------------------------------------
    Write-Step 'Adding shortcuts...'
    $shell = New-Object -ComObject WScript.Shell
    $startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) "$AppName.lnk"
    $desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) "$AppName.lnk"
    foreach ($path in @($startMenu, $desktop)) {
        $link = $shell.CreateShortcut($path)
        $link.TargetPath = $Exe
        $link.WorkingDirectory = $InstallDir
        $link.IconLocation = "$Exe,0"
        $link.Description = 'Nya web browser'
        $link.Save()
    }

    # --- 4. Uninstaller + "Installed apps" entry ------------------------------
    $uninstaller = Join-Path $InstallDir 'uninstall.ps1'
    @"
# Removes Nya (installed by install.ps1). Your settings and history stay in
# %APPDATA%\Nya - delete that folder too if you want them gone.
Get-Process -Name 'Nya' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500
Remove-Item '$startMenu', '$desktop' -Force -ErrorAction SilentlyContinue
Remove-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$AppName' -Recurse -Force -ErrorAction SilentlyContinue
Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile', '-Command', "Start-Sleep 2; Remove-Item -LiteralPath '$InstallDir' -Recurse -Force"
"@ | Set-Content -Path $uninstaller -Encoding UTF8

    $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$AppName"
    New-Item -Path $key -Force | Out-Null
    $size = [math]::Round((Get-ChildItem $InstallDir -Recurse -File | Measure-Object Length -Sum).Sum / 1KB)
    $values = @{
        DisplayName     = $AppName
        DisplayVersion  = $version
        Publisher       = 'Tima'
        DisplayIcon     = "$Exe,0"
        InstallLocation = $InstallDir
        URLInfoAbout    = "https://github.com/$Repo"
        UninstallString = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$uninstaller`""
    }
    foreach ($name in $values.Keys) {
        New-ItemProperty -Path $key -Name $name -Value $values[$name] -PropertyType String -Force | Out-Null
    }
    New-ItemProperty -Path $key -Name EstimatedSize -Value $size -PropertyType DWord -Force | Out-Null
    New-ItemProperty -Path $key -Name NoModify -Value 1 -PropertyType DWord -Force | Out-Null
    New-ItemProperty -Path $key -Name NoRepair -Value 1 -PropertyType DWord -Force | Out-Null

    Write-Host ''
    Write-Host "  Nya $version is installed." -ForegroundColor Green
    Write-Host "  Find it in the Start menu or on your desktop." -ForegroundColor Gray
    Write-Host ''

    if (-not $NoLaunch) { Start-Process $Exe }
}
finally {
    Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
}
