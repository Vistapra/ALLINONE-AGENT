#Requires -Version 5.1
<#
.SYNOPSIS
    Restarts ALLINONE-AGENT's own managed components (stop.ps1 then start.ps1).
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ScriptRoot = $PSScriptRoot

& (Join-Path $ScriptRoot 'stop.ps1')
Start-Sleep -Seconds 3
& (Join-Path $ScriptRoot 'start.ps1')
