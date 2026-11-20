#Requires -Version 5.1
<#
.SYNOPSIS
    ALLINONE-AGENT preflight checks: OS, runtime prerequisites, ports, disk, network.
.DESCRIPTION
    Pure read-only checks. Never installs or mutates anything. Every function returns a
    PSCustomObject with at least: Name, Status (Pass/Fail/Warn/Unknown), Detail.
#>

function Test-AllinoneOsCompatibility {
    [CmdletBinding()]
    param()
    $os = Get-CimInstance Win32_OperatingSystem
    $isWin10 = $os.Caption -match 'Windows 10'
    $isWin11 = $os.Caption -match 'Windows 11'
    $isServer = $os.Caption -match 'Server'
    $status = if ($isWin10 -or $isWin11 -or $isServer) { 'Pass' } else { 'Warn' }
    $detail = "$($os.Caption) build $($os.BuildNumber), architecture $($os.OSArchitecture)"
    if ($isWin10) {
        $detail += '. Windows 10: confirm this edition/build still receives security updates from Microsoft before using this machine for anything internet-facing; this script does not verify that for you.'
    }
    [PSCustomObject]@{ Name = 'OS Compatibility'; Status = $status; Detail = $detail }
}

function Test-AllinoneHardware {
    [CmdletBinding()]
    param()
    $cs = Get-CimInstance Win32_ComputerSystem
    $ramGb = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
    $status = if ($ramGb -ge 8) { 'Pass' } elseif ($ramGb -ge 4) { 'Warn' } else { 'Fail' }
    [PSCustomObject]@{
        Name   = 'Hardware (RAM)'
        Status = $status
        Detail = "$ramGb GB RAM detected. This is informational only - no hardware minimum is enforced by this installer, since the project has not run enough installs on varied hardware to assert a universal minimum. Low-RAM machines may see degraded performance, especially running Hermes3D's 3D mode; a 2D-only / low-power mode may be more appropriate."
    }
}

function Test-AllinoneDiskSpace {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]$Path,
        [double]$MinimumFreeGb = 8
    )
    $root = [System.IO.Path]::GetPathRoot((Resolve-Path -LiteralPath (Split-Path -Parent $Path) -ErrorAction SilentlyContinue).Path)
    if (-not $root) { $root = [System.IO.Path]::GetPathRoot($Path) }
    $drive = Get-PSDrive -Name $root.TrimEnd(':\') -ErrorAction SilentlyContinue
    if (-not $drive) {
        return [PSCustomObject]@{ Name = 'Disk Space'; Status = 'Unknown'; Detail = "Could not resolve drive for '$Path'." }
    }
    $freeGb = [math]::Round($drive.Free / 1GB, 2)
    $status = if ($freeGb -ge $MinimumFreeGb) { 'Pass' } else { 'Fail' }
    [PSCustomObject]@{
        Name   = 'Disk Space'
        Status = $status
        Detail = "$freeGb GB free on $($drive.Root) (recommend >= $MinimumFreeGb GB for dependency install + Hermes3D build artifacts)."
    }
}

function Test-AllinoneCommandPresent {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]$Command,
        [string]$MinimumVersion,
        [string]$VersionArg = '--version'
    )
    $cmd = Get-Command $Command -ErrorAction SilentlyContinue
    if (-not $cmd) {
        return [PSCustomObject]@{ Name = $Command; Status = 'Fail'; Detail = "'$Command' not found on PATH." }
    }
    $verOut = & $Command $VersionArg 2>&1 | Select-Object -First 1

    if (-not $MinimumVersion) {
        return [PSCustomObject]@{ Name = $Command; Status = 'Pass'; Detail = "Found at $($cmd.Source): $verOut" }
    }

    # Extract the first x.y.z-looking token from the version output (handles 'v20.16.0', 'Python 3.14.9', etc.)
    $match = [regex]::Match([string]$verOut, '\d+(\.\d+){1,3}')
    if (-not $match.Success) {
        return [PSCustomObject]@{
            Name   = $Command
            Status = 'Unknown'
            Detail = "Found at $($cmd.Source), but could not parse a version number out of '$verOut' to compare against required minimum $MinimumVersion."
        }
    }

    try {
        $actual = [version]$match.Value
        $required = [version]$MinimumVersion
    } catch {
        return [PSCustomObject]@{
            Name   = $Command
            Status = 'Unknown'
            Detail = "Found at $($cmd.Source) ($verOut), but '$MinimumVersion' or the parsed version '$($match.Value)' is not a comparable version string."
        }
    }

    $status = if ($actual -ge $required) { 'Pass' } else { 'Fail' }
    $detail = "Found at $($cmd.Source): $verOut (parsed $actual, required >= $required)."
    if ($status -eq 'Fail') {
        $detail += " This version is below the documented minimum - see INSTALLATION.md prerequisites."
    }
    [PSCustomObject]@{ Name = $Command; Status = $status; Detail = $detail }
}

function Test-AllinonePortAvailable {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [int]$Port)
    $inUse = $false
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
        $listener.Start()
        $listener.Stop()
    } catch {
        $inUse = $true
    }
    [PSCustomObject]@{
        Name   = "Port $Port"
        Status = if ($inUse) { 'Warn' } else { 'Pass' }
        Detail = if ($inUse) { "Port $Port appears to be in use already - this is expected if adopting an existing installation, otherwise pick a different port in your local config." } else { "Port $Port is free." }
    }
}

function Test-AllinoneNetworkConnectivity {
    [CmdletBinding()]
    param([string]$TestHost = 'github.com')
    try {
        $result = Test-NetConnection -ComputerName $TestHost -Port 443 -WarningAction SilentlyContinue -ErrorAction Stop
        $status = if ($result.TcpTestSucceeded) { 'Pass' } else { 'Warn' }
        [PSCustomObject]@{ Name = 'Network Connectivity'; Status = $status; Detail = "HTTPS reachability to $TestHost : $($result.TcpTestSucceeded)" }
    } catch {
        [PSCustomObject]@{ Name = 'Network Connectivity'; Status = 'Unknown'; Detail = "Could not test connectivity to $TestHost ($($_.Exception.Message)). Fresh-mode git clones will fail without network access." }
    }
}

function Get-AllinoneInstallMode {
    <#
    .SYNOPSIS
        Detects whether this looks like a fresh machine or one with an existing
        ALLINONE/Hermes-family installation, WITHOUT assuming the brief's original
        reference paths are the only possible layout - callers should treat this as a
        best-effort signal, not a guarantee.
    #>
    [CmdletBinding()]
    param()
    $signals = [ordered]@{
        HermesHomeExists        = Test-Path (Join-Path $env:LOCALAPPDATA 'hermes')
        HermesAgentNpmInstalled = [bool](& npm ls -g hermes-agent --depth=0 2>$null | Select-String 'hermes-agent@')
        PlatformTasksRegistered = [bool](Get-ScheduledTask -TaskName 'PaperclipServer','OfficeVirtualCompany','PlatformMaintenance','PlatformHealthWatchdog' -ErrorAction SilentlyContinue)
        AllinoneHomeExists      = [bool]($env:ALLINONE_HOME -and (Test-Path $env:ALLINONE_HOME))
    }
    $existingSignalCount = ($signals.Values | Where-Object { $_ }).Count
    $mode = if ($existingSignalCount -ge 2) { 'Adopt-Existing' } elseif ($existingSignalCount -eq 1) { 'Adopt-Existing' } else { 'Fresh' }
    [PSCustomObject]@{
        RecommendedMode = $mode
        Signals         = [PSCustomObject]$signals
    }
}

Export-ModuleMember -Function Test-AllinoneOsCompatibility, Test-AllinoneHardware, Test-AllinoneDiskSpace, `
    Test-AllinoneCommandPresent, Test-AllinonePortAvailable, Test-AllinoneNetworkConnectivity, Get-AllinoneInstallMode
