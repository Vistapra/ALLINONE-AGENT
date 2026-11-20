using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading;

internal static class PaperclipServiceLauncher
{
    private const string MutexName = @"Local\PaperclipServer_Singleton";
    private static readonly string PlatformRoot = Environment.GetEnvironmentVariable("ALLINONE_HOME")
        ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "ALLINONE-AGENT");
    private static readonly string HermesHome = Environment.GetEnvironmentVariable("ALLINONE_HERMES_HOME")
        ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "hermes");
    private static readonly string PaperclipHome = Path.Combine(PlatformRoot, @"data\paperclip");
    private static readonly string InstanceEnvPath = Path.Combine(PaperclipHome, @"instances\default\.env");
    private static readonly string SecretsEnvPath = Path.Combine(PlatformRoot, @"config\secrets\paperclip-auth.env");
    private static readonly string MaintLockPath = Path.Combine(PlatformRoot, @"data\maintenance\maintenance.lock");
    private static readonly string PidFilePath = Path.Combine(PaperclipHome, "launcher-state.json");
    private static readonly string LauncherLogPath = Path.Combine(PlatformRoot, @"logs\paperclip-launcher.log");
    private static readonly string NodeExe = Path.Combine(HermesHome, @"tools\node-26.12.1-win32-x64\node.exe");
    private static readonly string PaperclipEntry = Path.Combine(PlatformRoot, @"scripts\paperclip-server-entry.mjs");
    private static readonly string PgCtlExe = Path.Combine(PlatformRoot, @"runtime\paperclip-app\node_modules\@embedded-postgres\windows-x64\native\bin\pg_ctl.exe");
    private static readonly string PgDataDir = Path.Combine(PaperclipHome, @"instances\default\db");

    private static volatile Process _child;
    private static volatile bool _stopping;

    private static void Log(string level, string msg)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(LauncherLogPath));
            var fi = new FileInfo(LauncherLogPath);
            if (fi.Exists && fi.Length > 5 * 1024 * 1024)
            {
                string bak = LauncherLogPath + ".1";
                if (File.Exists(bak)) File.Delete(bak);
                File.Move(LauncherLogPath, bak);
            }
            string line = string.Format("{0:yyyy-MM-ddTHH:mm:sszzz} [{1}] {2}{3}", DateTimeOffset.Now, level, msg, Environment.NewLine);
            File.AppendAllText(LauncherLogPath, line);
        }
        catch { }
    }

    private static bool IsMaintenanceActive()
    {
        try
        {
            if (!File.Exists(MaintLockPath)) return false;
            var age = DateTime.UtcNow - File.GetLastWriteTimeUtc(MaintLockPath);
            return age.TotalMinutes < 90;
        }
        catch { return false; }
    }

    private static Dictionary<string, string> ReadEnvFile(string path)
    {
        var dict = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (!File.Exists(path)) return dict;
        foreach (string raw in File.ReadAllLines(path))
        {
            string line = raw.Trim();
            if (line.Length == 0 || line.StartsWith("#")) continue;
            int idx = line.IndexOf('=');
            if (idx <= 0) continue;
            string k = line.Substring(0, idx).Trim();
            string v = line.Substring(idx + 1).Trim().Trim('"', '\'');
            dict[k] = v;
        }
        return dict;
    }

    private static void WriteState(int childPid, string status, int restartCount)
    {
        try
        {
            Directory.CreateDirectory(PaperclipHome);
            string json = string.Format(
                "{{\"launcher_pid\":{0},\"server_pid\":{1},\"status\":\"{2}\",\"restart_count\":{3},\"updated_at\":\"{4:o}\"}}",
                Process.GetCurrentProcess().Id, childPid, status, restartCount, DateTimeOffset.Now);
            File.WriteAllText(PidFilePath, json);
        }
        catch { }
    }

    private static int Main(string[] args)
    {
        if (args.Length > 0 && string.Equals(args[0], "--stop", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                if (File.Exists(PidFilePath))
                {
                    string txt = File.ReadAllText(PidFilePath);
                    foreach (string key in new[] { "\"server_pid\":", "\"launcher_pid\":" })
                    {
                        int idx = txt.IndexOf(key, StringComparison.Ordinal);
                        if (idx >= 0)
                        {
                            int s = idx + key.Length;
                            int e = s;
                            while (e < txt.Length && char.IsDigit(txt[e])) e++;
                            int pid;
                            if (int.TryParse(txt.Substring(s, e - s), out pid) && pid > 0)
                            {
                                try { var p = Process.GetProcessById(pid); if (!p.HasExited) p.Kill(); } catch { }
                            }
                        }
                    }
                }
            }
            catch { }
            return 0;
        }

        if (IsMaintenanceActive())
        {
            Log("INFO", "Maintenance lock active; PaperclipServiceLauncher deferring startup.");
            return 0;
        }

        bool createdNew;
        using (var mutex = new Mutex(true, MutexName, out createdNew))
        {
            if (!createdNew)
            {
                return 0; // Singleton already running
            }

            Console.CancelKeyPress += (s, e) =>
            {
                e.Cancel = true;
                _stopping = true;
                try { if (_child != null && !_child.HasExited) _child.Kill(); } catch { }
            };

            int consecutiveQuickFailures = 0;
            int totalRestarts = 0;

            while (!_stopping)
            {
                if (IsMaintenanceActive())
                {
                    WriteState(0, "maintenance_deferred", totalRestarts);
                    Log("INFO", "Maintenance lock detected; pausing supervisor loop.");
                    Thread.Sleep(10000);
                    continue;
                }

                var startUtc = DateTime.UtcNow;
                try
                {
                    CleanupOrphanedChildren();
                    var psi = new ProcessStartInfo
                    {
                        FileName = NodeExe,
                        Arguments = string.Format("\"{0}\"", PaperclipEntry),
                        WorkingDirectory = PlatformRoot,
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true
                    };

                    psi.EnvironmentVariables["PAPERCLIP_HOME"] = PaperclipHome;
                    psi.EnvironmentVariables["PAPERCLIP_NO_BROWSER"] = "true";
                    psi.EnvironmentVariables["PAPERCLIP_OPEN_ON_LISTEN"] = "false";
                    psi.EnvironmentVariables["PAPERCLIP_TELEMETRY_DISABLED"] = "1";
                    psi.EnvironmentVariables["DO_NOT_TRACK"] = "1";
                    psi.EnvironmentVariables["HOST"] = "127.0.0.1";
                    psi.EnvironmentVariables["PORT"] = "3100";
                    psi.EnvironmentVariables["NODE_OPTIONS"] = "--max-old-space-size=1024";

                    string nodeDir = Path.GetDirectoryName(NodeExe);
                    string hermesBin = Path.Combine(HermesHome, "bin");
                    string pmGit = Path.Combine(HermesHome, @"tools\git-2.56.1+1-win32-x64\cmd");
                    string curPath = psi.EnvironmentVariables["PATH"] ?? "";
                    psi.EnvironmentVariables["PATH"] = string.Format("{0};{1};{2};{3}", nodeDir, hermesBin, pmGit, curPath);

                    foreach (var kv in ReadEnvFile(SecretsEnvPath)) psi.EnvironmentVariables[kv.Key] = kv.Value;
                    foreach (var kv in ReadEnvFile(InstanceEnvPath)) psi.EnvironmentVariables[kv.Key] = kv.Value;

                    var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
                    proc.OutputDataReceived += (s, e) => { if (!string.IsNullOrEmpty(e.Data)) Log("STDOUT", Redact(e.Data)); };
                    proc.ErrorDataReceived += (s, e) => { if (!string.IsNullOrEmpty(e.Data)) Log("STDERR", Redact(e.Data)); };

                    proc.Start();
                    try { proc.PriorityClass = ProcessPriorityClass.Normal; } catch { }
                    _child = proc;
                    proc.BeginOutputReadLine();
                    proc.BeginErrorReadLine();

                    WriteState(proc.Id, "running", totalRestarts);
                    Log("INFO", "Started Paperclip server PID=" + proc.Id);

                    // Poll HasExited rather than blocking on WaitForExit(), because grandchild postgres.exe
                    // inherits stdout/stderr handles on Windows and would hold WaitForExit() open after node.exe dies.
                    while (!proc.HasExited && !_stopping)
                    {
                        Thread.Sleep(1000);
                    }
                    int exitedPid = proc.Id;
                    int code = proc.HasExited ? proc.ExitCode : -1;
                    try { proc.CancelOutputRead(); } catch { }
                    try { proc.CancelErrorRead(); } catch { }
                    try { proc.Dispose(); } catch { }
                    double ranSec = (DateTime.UtcNow - startUtc).TotalSeconds;
                    Log("WARN", string.Format("Paperclip server PID={0} exited with code={1} after {2:F1}s", exitedPid, code, ranSec));

                    if (_stopping) break;

                    if (ranSec >= 45.0) consecutiveQuickFailures = 0;
                    else consecutiveQuickFailures++;

                    if (consecutiveQuickFailures >= 6)
                    {
                        WriteState(0, "crash_loop_cooldown", totalRestarts);
                        Log("ERROR", "Crash-loop guard triggered (6 quick exits); cooling down for 180s.");
                        Thread.Sleep(180000);
                        consecutiveQuickFailures = 0;
                    }
                    else
                    {
                        int delaySec = Math.Min(60, (int)(3 * Math.Pow(2, Math.Min(consecutiveQuickFailures, 4))));
                        WriteState(0, "restarting", totalRestarts + 1);
                        Thread.Sleep(delaySec * 1000);
                    }
                    totalRestarts++;
                }
                catch (Exception ex)
                {
                    Log("ERROR", "Supervisor exception: " + ex.Message);
                    Thread.Sleep(10000);
                }
            }

            WriteState(0, "stopped", totalRestarts);
            return 0;
        }
    }

    private static void CleanupOrphanedChildren()
    {
        try
        {
            string pidMarker = Path.Combine(PgDataDir, "postmaster.pid");
            if (File.Exists(pidMarker) && File.Exists(PgCtlExe))
            {
                var pgPsi = new ProcessStartInfo
                {
                    FileName = PgCtlExe,
                    Arguments = string.Format("stop -D \"{0}\" -m fast -w -t 10", PgDataDir),
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                };
                using (var pgStop = Process.Start(pgPsi))
                {
                    if (pgStop != null) pgStop.WaitForExit(12000);
                }
            }
            if (File.Exists(pidMarker))
            {
                string[] lines = File.ReadAllLines(pidMarker);
                int pgPid;
                if (lines.Length > 0 && int.TryParse(lines[0].Trim(), out pgPid) && pgPid > 0)
                {
                    bool alive = false;
                    try { var p = Process.GetProcessById(pgPid); alive = !p.HasExited && p.ProcessName.IndexOf("postgres", StringComparison.OrdinalIgnoreCase) >= 0; } catch { alive = false; }
                    if (!alive)
                    {
                        File.Delete(pidMarker);
                        Log("INFO", "Removed stale postmaster.pid for dead PID=" + pgPid);
                    }
                }
            }
        }
        catch (Exception ex)
        {
            Log("WARN", "CleanupOrphanedChildren warning: " + ex.Message);
        }
    }

    private static string Redact(string s)
    {
        if (string.IsNullOrEmpty(s)) return s;
        // Redact bootstrap invite tokens or bearer tokens in launcher logs
        s = System.Text.RegularExpressions.Regex.Replace(s, @"pcp_(bootstrap|invite|claim|board|agent)_[A-Za-z0-9_-]+", "pcp_$1_[REDACTED]");
        s = System.Text.RegularExpressions.Regex.Replace(s, @"Bearer\s+\S+", "Bearer [REDACTED]");
        return s;
    }
}
