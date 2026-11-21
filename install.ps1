#Requires -Version 5.1
<#
.SYNOPSIS
    ALLINONE-AGENT installer orchestrator.
.DESCRIPTION
    Implements Fresh / Adopt-Existing / Repair / Dev installation modes. Idempotent: re-running
    without -Force skips stages already recorded as completed in runtime\install-state.json.

    STATUS OF THIS SCRIPT (read before relying on it): written and statically parse-validated
    (Phase 45) against a staged copy of the real ALLINONE-AGENT source tree. It has NOT yet been
    executed end-to-end on a real machine - that is Phase 52's job, with explicit scoping. Stages
    marked "[STUB]" below are intentionally not implemented yet; they print a clear message and
    do not pretend to succeed.
.PARAMETER InstallPath
    Where to install ALLINONE-AGENT. Defaults to $env:ALLINONE_HOME, or "$HOME\ALLINONE-AGENT".
.PARAMETER Mode
    Auto (default, detect), Fresh, Adopt, Repair, or Dev.
.PARAMETER DryRun
    Print the install plan and detected mode; make no changes at all.
.PARAMETER Force
    Re-run stages even if already marked completed in the install state file.
.PARAMETER NonInteractive
    Do not prompt; fail instead of asking when a required value is missing.
.EXAMPLE
    .\install.ps1 -DryRun
.EXAMPLE
    .\install.ps1 -InstallPath D:\ALLINONE-AGENT -Mode Fresh
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$InstallPath,
    [ValidateSet('Auto', 'Fresh', 'Adopt', 'Repair', 'Dev')]
    [string]$Mode = 'Auto',
    [switch]$DryRun,
    [switch]$Force,
    [switch]$NonInteractive
)

$ErrorActionPreference = 'Stop'
$ScriptRoot = $PSScriptRoot
Import-Module (Join-Path $ScriptRoot 'scripts\lib\Preflight.psm1') -Force
Import-Module (Join-Path $ScriptRoot 'scripts\lib\InstallState.psm1') -Force

function Write-Stage {
    param([string]$Text)
    Write-Host ""
    Write-Host "==> $Text" -ForegroundColor Cyan
}

function Write-Result {
    param([Parameter(ValueFromPipeline)] $Result)
    process {
        $color = switch ($Result.Status) {
            'Pass' { 'Green' }; 'Warn' { 'Yellow' }; 'Fail' { 'Red' }; default { 'Gray' }
        }
        Write-Host ("  [{0,-4}] {1}: {2}" -f $Result.Status, $Result.Name, $Result.Detail) -ForegroundColor $color
    }
}

# ---------------------------------------------------------------------------
# Resolve install path and mode
# ---------------------------------------------------------------------------
$AllinoneHome = Get-AllinoneHome -InstallPath $InstallPath
$env:ALLINONE_HOME = $AllinoneHome

Write-Stage "ALLINONE-AGENT install target: $AllinoneHome"

$detected = Get-AllinoneInstallMode
if ($Mode -eq 'Auto') {
    $effectiveMode = $detected.RecommendedMode
    Write-Host "  Auto-detected mode: $effectiveMode" -ForegroundColor Gray
    $detected.Signals | Format-List | Out-String | Write-Verbose
} else {
    $effectiveMode = $Mode
}

# ---------------------------------------------------------------------------
# Stage: Preflight
# ---------------------------------------------------------------------------
Write-Stage "Stage 1/8: Preflight"
$preflightResults = @(
    Test-AllinoneOsCompatibility
    Test-AllinoneHardware
    Test-AllinoneDiskSpace -Path $AllinoneHome -MinimumFreeGb 8
    Test-AllinoneNodeRuntime -MinimumVersion '22.0.0'
    Test-AllinoneCommandPresent -Command 'git' -VersionArg '--version'
    Test-AllinoneCommandPresent -Command 'python' -VersionArg '--version'
    Test-AllinonePortAvailable -Port 3100   # Paperclip
    Test-AllinonePortAvailable -Port 54329  # PostgreSQL (embedded)
    Test-AllinonePortAvailable -Port 3200   # Hermes3D
    Test-AllinonePortAvailable -Port 3210   # Office Bridge
    Test-AllinoneNetworkConnectivity
)
$preflightResults | Write-Result
$hardFailures = $preflightResults | Where-Object { $_.Status -eq 'Fail' -and $_.Name -notmatch '^Port ' }
if ($hardFailures -and $effectiveMode -ne 'Repair') {
    Write-Host ""
    Write-Host "Preflight found blocking issues. Fix these and re-run, or run with -Mode Repair if you understand the risk:" -ForegroundColor Red
    $hardFailures | ForEach-Object { Write-Host "  - $($_.Name): $($_.Detail)" -ForegroundColor Red }
    if (-not $DryRun) { exit 1 }
}

# ---------------------------------------------------------------------------
# Stage: Install plan
# ---------------------------------------------------------------------------
Write-Stage "Stage 2/8: Install Plan"
Write-Host "  Mode:          $effectiveMode"
Write-Host "  Install path:  $AllinoneHome"
Write-Host "  Would perform: dependency resolution, upstream retrieval (Fresh only), local config init,"
Write-Host "                 database init [STUB], agent/office provisioning [defers to later phases],"
Write-Host "                 health verification, installation report."
if ($DryRun) {
    Write-Host ""
    Write-Host "DryRun: stopping here. No changes made." -ForegroundColor Yellow
    exit 0
}

if (-not (Test-Path $AllinoneHome)) {
    if ($PSCmdlet.ShouldProcess($AllinoneHome, 'Create install directory')) {
        New-Item -ItemType Directory -Path $AllinoneHome -Force | Out-Null
    }
}
$lockPath = Enter-AllinoneSingletonLock -AllinoneHome $AllinoneHome
try {
    $state = Read-AllinoneInstallState -AllinoneHome $AllinoneHome
    $state.Mode = $effectiveMode

    function Invoke-Stage {
        param([string]$Name, [scriptblock]$Action)
        if (-not $Force -and (Test-AllinoneStageCompleted -State $state -StageName $Name)) {
            Write-Host "  Skipping '$Name' (already completed; use -Force to re-run)." -ForegroundColor DarkGray
            return
        }
        if ($PSCmdlet.ShouldProcess($Name, 'Run install stage')) {
            & $Action
            $script:state = Add-AllinoneCompletedStage -State $state -StageName $Name
            Save-AllinoneInstallState -AllinoneHome $AllinoneHome -State $state
        }
    }

    # -----------------------------------------------------------------------
    # Stage: Dependency resolution + upstream retrieval
    # -----------------------------------------------------------------------
    Write-Stage "Stage 3/8: Dependency Resolution & Upstream Retrieval"
    Invoke-Stage -Name 'upstream-retrieval' -Action {
        $lockFile = Join-Path $ScriptRoot 'upstream\components.lock.json'
        if (-not (Test-Path $lockFile)) {
            throw "upstream\components.lock.json not found next to install.ps1 - run this script from the repository root."
        }
        $lock = Get-Content -LiteralPath $lockFile -Raw | ConvertFrom-Json
        $upstreamDir = Join-Path $AllinoneHome 'upstream-checkouts'
        New-Item -ItemType Directory -Path $upstreamDir -Force | Out-Null

        foreach ($component in $lock.components) {
            switch ($component.component) {
                'paperclip' {
                    $dest = Join-Path $upstreamDir 'paperclip'
                    if (Test-Path (Join-Path $dest '.git')) {
                        Write-Host "    paperclip: already cloned at $dest (Adopt/idempotent-skip)." -ForegroundColor DarkGray
                    } elseif ($effectiveMode -eq 'Fresh' -or -not (Test-Path $dest)) {
                        Write-Host "    paperclip: cloning $($component.upstream_url) @ $($component.git_commit) ..."
                        git clone --quiet $component.upstream_url $dest
                        git -C $dest checkout --quiet $component.git_commit
                    }
                }
                'vulnclaw' {
                    $dest = Join-Path $upstreamDir 'vulnclaw'
                    if (Test-Path (Join-Path $dest '.git')) {
                        Write-Host "    vulnclaw: already cloned at $dest (Adopt/idempotent-skip)." -ForegroundColor DarkGray
                    } elseif ($effectiveMode -eq 'Fresh' -or -not (Test-Path $dest)) {
                        Write-Host "    vulnclaw: cloning $($component.upstream_url) @ $($component.release_tag) ..."
                        git clone --quiet $component.upstream_url $dest
                        git -C $dest checkout --quiet $component.git_commit
                    }
                }
                'hermes-agent-npm-bridge' {
                    $installed = & npm ls -g hermes-agent --depth=0 2>$null | Select-String 'hermes-agent@'
                    if ($installed) {
                        Write-Host "    hermes-agent: already installed globally ($installed) - skipping (Adopt/idempotent-skip)." -ForegroundColor DarkGray
                    } else {
                        Write-Host "    hermes-agent: run 'npm install -g hermes-agent@$($component.resolved_version)' yourself - this installer does not install global npm packages on your behalf without confirmation. See INSTALLATION.md."
                    }
                }
                'hermes3d' {
                    Write-Host "    hermes3d: vendored in this repo at apps\hermes3d - no retrieval needed. The patch in upstream\patches\ documents provenance only." -ForegroundColor DarkGray
                }
            }
        }
    }

    # -----------------------------------------------------------------------
    # Stage: Local configuration initialization
    # -----------------------------------------------------------------------
    Write-Stage "Stage 4/8: Local Configuration"
    Invoke-Stage -Name 'local-config-init' -Action {
        $configDir = Join-Path $AllinoneHome 'config'
        New-Item -ItemType Directory -Path $configDir -Force | Out-Null
        $templates = @(
            @{ Example = Join-Path $ScriptRoot 'config\resource-limits.example.json'; Target = Join-Path $configDir 'resource-limits.json' }
            @{ Example = Join-Path $ScriptRoot 'config\platform.local.env.example'; Target = Join-Path $configDir 'platform.local.env' }
            @{ Example = Join-Path $ScriptRoot 'agents\roles\organization-roster.example.json'; Target = Join-Path $configDir 'organization-roster.json' }
        )
        foreach ($t in $templates) {
            if (-not (Test-Path $t.Example)) {
                Write-Warning "Template not found, skipping: $($t.Example)"
                continue
            }
            if (Test-Path $t.Target) {
                Write-Host "    $(Split-Path -Leaf $t.Target): already exists, leaving your adopted config untouched." -ForegroundColor DarkGray
            } else {
                Copy-Item -LiteralPath $t.Example -Destination $t.Target
                Write-Host "    Created $($t.Target) from template. Edit it before relying on real credentials - it ships with placeholders only." -ForegroundColor Gray
            }
        }
        Write-Host "    NOTE: this is a minimal Phase-45 config set. The full interactive first-run wizard (owner auth, Telegram opt-in, provider connectivity check) is setup.ps1 (Phase 46) - run that next." -ForegroundColor Yellow
    }

    # -----------------------------------------------------------------------
    # Stage: Database initialization [STUB]
    # -----------------------------------------------------------------------
    Write-Stage "Stage 5/8: Database Initialization [STUB]"
    Invoke-Stage -Name 'database-init-stub' -Action {
        Write-Host "    [STUB] Embedded PostgreSQL initialization is not yet scripted in this phase." -ForegroundColor Yellow
        Write-Host "    This reference install uses PostgreSQL on 127.0.0.1:54329 managed outside this installer." -ForegroundColor Yellow
        Write-Host "    A real embedded-Postgres bootstrap (initdb, data dir under `$ALLINONE_HOME\data\paperclip, migrations) is future work - do not assume a database is ready after this stage." -ForegroundColor Yellow
        if ($effectiveMode -ne 'Adopt') {
            Write-Host "    On a Fresh install, Paperclip itself also still needs its own first-run bootstrap (owner account, Board API key, paperclip-board-key.json) before Office Bridge can authenticate to it." -ForegroundColor Yellow
            Write-Host "    scripts\bootstrap_and_verify_paperclip.py does this - it is NOT auto-run here, same reviewable-step discipline as org_provisioner.py below, because it mints real credentials, creates an initial company, and stops/restarts the PaperclipServer task as part of its own verification." -ForegroundColor Yellow
            Write-Host "    Review it, then run it yourself once config\secrets\paperclip-admin.json exists with real admin credentials you control." -ForegroundColor Yellow
        }
    }

    # -----------------------------------------------------------------------
    # Stage: Agent & office provisioning (defer to later phase content already vendored)
    # -----------------------------------------------------------------------
    Write-Stage "Stage 6/8: Agent & Office Provisioning"
    Invoke-Stage -Name 'agent-office-note' -Action {
        Write-Host "    Role templates are present under agents\roles\*\ (11 roles) and config\organization-roster.json was seeded in Stage 4." -ForegroundColor Gray
        Write-Host "    Actually running integration\org_provisioner.py to materialize live agent identities is intentionally NOT done automatically by install.ps1 -" -ForegroundColor Yellow
        Write-Host "    run it explicitly yourself once you've reviewed config\organization-roster.json, so you don't get agent identities you didn't ask for." -ForegroundColor Yellow
    }

    # -----------------------------------------------------------------------
    # Stage: Scheduled tasks (Fresh/Repair only - never duplicate on Adopt)
    # -----------------------------------------------------------------------
    Write-Stage "Stage 7/8: Scheduled Tasks"
    Invoke-Stage -Name 'scheduled-tasks' -Action {
        if ($effectiveMode -eq 'Adopt') {
            Write-Host "    Adopt mode: leaving existing scheduled tasks as-is (not re-registering)." -ForegroundColor DarkGray
        } else {
            $registerScripts = @(
                (Join-Path $ScriptRoot 'automation\scheduled-tasks\register-platform-tasks.ps1')
                (Join-Path $ScriptRoot 'automation\scheduled-tasks\register-paperclip-task.ps1')
            )
            foreach ($rs in $registerScripts) {
                if (Test-Path $rs) {
                    Write-Host "    Would run: $rs (not auto-executed here - registering scheduled tasks changes system state outside this repo checkout; run it yourself after reviewing it, or pass -Force -Mode Fresh once you've reviewed this script's source)." -ForegroundColor Yellow
                } else {
                    Write-Warning "Expected scheduled-task registration script not found: $rs"
                }
            }
        }
    }

    # -----------------------------------------------------------------------
    # Stage: Health verification + report
    # -----------------------------------------------------------------------
    Write-Stage "Stage 8/8: Health Verification & Report"
    $reportPath = Join-Path $AllinoneHome 'runtime\installation-report.md'
    $healthScript = Join-Path $ScriptRoot 'health.ps1'
    $healthSummary = if (Test-Path $healthScript) { "Run '.\health.ps1' now to verify service state." } else { 'health.ps1 not found next to install.ps1.' }

    $report = @"
# ALLINONE-AGENT Installation Report

- Generated: $(Get-Date -Format 'o')
- Mode: $effectiveMode
- Install path: $AllinoneHome
- Preflight: see console output above (not re-saved verbatim here yet - future improvement)
- Stages completed this run / previously: $($state.CompletedStages -join ', ')

## Next steps
1. $healthSummary
2. Review and edit `$AllinoneHome\config\platform.local.env` before starting any component that needs real credentials.
3. Run .\setup.ps1 for the interactive first-run wizard (owner auth, provider, Telegram opt-in).
4. Database initialization is a STUB in this version - see Stage 5 output above.
5. Scheduled task registration and agent provisioning were intentionally not auto-executed - review the referenced scripts first.

## Application URLs (defaults, confirm against your local config)
- Paperclip:     http://127.0.0.1:3100
- Hermes3D:      http://127.0.0.1:3200/office
- Office Bridge: http://127.0.0.1:3210
"@
    New-Item -ItemType Directory -Path (Split-Path -Parent $reportPath) -Force | Out-Null
    $report | Set-Content -LiteralPath $reportPath -Encoding utf8
    Write-Host "  Installation report written to: $reportPath" -ForegroundColor Green
    Write-Host ""
    Write-Host "Install stages complete (with the STUB/deferred items noted above). This has NOT been exercised end-to-end yet - review the report before trusting any component is actually running." -ForegroundColor Cyan
}
finally {
    Exit-AllinoneSingletonLock -LockPath $lockPath
}
