using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text.RegularExpressions;
using System.Threading;

internal static class OfficeServiceLauncher
{
    private const string MutexName = @"Local\OfficeVirtualCompany_Singleton";
    private static readonly string PlatformRoot = Environment.GetEnvironmentVariable("ALLINONE_HOME")
        ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "ALLINONE-AGENT");
    private static readonly string HermesHome = Environment.GetEnvironmentVariable("ALLINONE_HERMES_HOME")
        ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "hermes");
    private static readonly string NodeExe = Path.Combine(HermesHome, @"tools\node-26.12.1-win32-x64\node.exe");

    private static readonly string BridgeScript = Path.Combine(PlatformRoot, @"office-bridge\server.js");
    private static readonly string Hermes3dDir = Path.Combine(PlatformRoot, @"hermes3d\source");
    private static readonly string Hermes3dScript = Path.Combine(Hermes3dDir, @"server\index.js");

    private static readonly string SecretsJsonPath = Path.Combine(PlatformRoot, @"config\secrets\office-bridge-auth.json");
    private static readonly string StudioStateDir = Path.Combine(PlatformRoot, @"office-data\studio-state");
    private static readonly string StudioSettingsPath = Path.Combine(StudioStateDir, @"hermes3d\settings.json");
    private static readonly string MaintLockPath = Path.Combine(PlatformRoot, @"data\maintenance\maintenance.lock");
    private static readonly string StateJsonPath = Path.Combine(PlatformRoot, @"office-data\launcher-state.json");
    private static readonly string LogPath = Path.Combine(PlatformRoot, @"logs\office-launcher.log");

    private static volatile Process _bridgeProc;
    private static volatile Process _h3dProc;
    private static volatile bool _stopping;

    private static void Log(string level, string msg)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(LogPath));
            var fi = new FileInfo(LogPath);
            if (fi.Exists && fi.Length > 5 * 1024 * 1024)
            {
                string bak = LogPath + ".1";
                if (File.Exists(bak)) File.Delete(bak);
                File.Move(LogPath, bak);
            }
            string line = string.Format("{0:yyyy-MM-ddTHH:mm:sszzz} [{1}] {2}{3}", DateTimeOffset.Now, level, Redact(msg), Environment.NewLine);
            File.AppendAllText(LogPath, line);
        }
        catch { }
    }

    private static string Redact(string s)
    {
        if (string.IsNullOrEmpty(s)) return s;
        s = Regex.Replace(s, @"(ob_tok|st_tok|pcp_[a-z]+|sk)-[A-Za-z0-9_-]+", "[REDACTED_TOKEN]");
        s = Regex.Replace(s, @"(ob_tok|st_tok)_[A-Za-z0-9_-]+", "[REDACTED_TOKEN]");
        s = Regex.Replace(s, @"Bearer\s+\S+", "Bearer [REDACTED]");
        return s;
    }

    private static bool IsMaintenanceActive()
    {
        try
        {
            if (!File.Exists(MaintLockPath)) return false;
            return (DateTime.UtcNow - File.GetLastWriteTimeUtc(MaintLockPath)).TotalMinutes < 90;
        }
        catch { return false; }
    }

    private static bool ProbeHttpOk(string url, int timeoutMs)
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.Method = "GET";
            req.Timeout = timeoutMs;
            req.ReadWriteTimeout = timeoutMs;
            using (var resp = (HttpWebResponse)req.GetResponse())
            {
                return (int)resp.StatusCode >= 200 && (int)resp.StatusCode < 300;
            }
        }
        catch { return false; }
    }

    private static string ExtractJsonString(string json, string key)
    {
        var m = Regex.Match(json ?? "", "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"([^\"]+)\"");
        return m.Success ? m.Groups[1].Value : "";
    }

    private static void EnsureStudioSettingsSeeded(string bridgeToken)
    {
        if (string.IsNullOrEmpty(bridgeToken)) return;
        Directory.CreateDirectory(Path.GetDirectoryName(StudioSettingsPath));
        string title = "UNIFIED AUTONOMOUS AI COMPANY";
        if (File.Exists(StudioSettingsPath))
        {
            try
            {
                string existing = File.ReadAllText(StudioSettingsPath);
                string existingTitle = ExtractJsonString(existing, "title");
                if (!string.IsNullOrEmpty(existingTitle)) title = existingTitle;
            }
            catch { }
        }
        string content =
            "{\n" +
            "  \"version\": 1,\n" +
            "  \"gateway\": {\n" +
            "    \"url\": \"ws://127.0.0.1:3210/ws\",\n" +
            "    \"token\": \"" + bridgeToken + "\",\n" +
            "    \"adapterType\": \"hermes\",\n" +
            "    \"profiles\": {\n" +
            "      \"hermes\": {\n" +
            "        \"url\": \"ws://127.0.0.1:3210/ws\",\n" +
            "        \"token\": \"" + bridgeToken + "\"\n" +
            "      }\n" +
            "    }\n" +
            "  },\n" +
            "  \"office\": {\n" +
            "    \"title\": \"" + title.Replace("\"", "") + "\"\n" +
            "  },\n" +
            "  \"focused\": {}\n" +
            "}\n";
        File.WriteAllText(StudioSettingsPath, content);
    }

    private static void WriteLauncherState(string status, int bridgeRestarts, int h3dRestarts)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(StateJsonPath));
            int bPid = (_bridgeProc != null && !_bridgeProc.HasExited) ? _bridgeProc.Id : 0;
            int hPid = (_h3dProc != null && !_h3dProc.HasExited) ? _h3dProc.Id : 0;
            string json = string.Format(
                "{{\"launcher_pid\":{0},\"bridge_pid\":{1},\"hermes3d_pid\":{2},\"status\":\"{3}\",\"bridge_restarts\":{4},\"hermes3d_restarts\":{5},\"updated_at\":\"{6:o}\"}}",
                Process.GetCurrentProcess().Id, bPid, hPid, status, bridgeRestarts, h3dRestarts, DateTimeOffset.Now);
            File.WriteAllText(StateJsonPath, json);
        }
        catch { }
    }

    private static Process StartBridgeProcess()
    {
        var psi = new ProcessStartInfo
        {
            FileName = NodeExe,
            Arguments = string.Format("\"{0}\"", BridgeScript),
            WorkingDirectory = PlatformRoot,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        psi.EnvironmentVariables["OFFICE_BRIDGE_HOST"] = "127.0.0.1";
        psi.EnvironmentVariables["OFFICE_BRIDGE_PORT"] = "3210";
        psi.EnvironmentVariables["HERMES3D_PORT"] = "3200";
        psi.EnvironmentVariables["NODE_OPTIONS"] = "--max-old-space-size=256";
        string nodeDir = Path.GetDirectoryName(NodeExe);
        string gitDir = Path.Combine(HermesHome, @"tools\git-2.56.1+1-win32-x64\cmd");
        string pyDir = Path.Combine(HermesHome, @"tools\python-3.14.9+20261021-win32-x64");
        psi.EnvironmentVariables["PATH"] = string.Format("{0};{1};{2};{3}", nodeDir, gitDir, pyDir, psi.EnvironmentVariables["PATH"] ?? "");

        var p = new Process { StartInfo = psi, EnableRaisingEvents = true };
        p.OutputDataReceived += (s, e) => { if (!string.IsNullOrEmpty(e.Data)) Log("BRIDGE", e.Data); };
        p.ErrorDataReceived += (s, e) => { if (!string.IsNullOrEmpty(e.Data)) Log("BRIDGE_ERR", e.Data); };
        p.Start();
        try { p.PriorityClass = ProcessPriorityClass.Normal; } catch { }
        p.BeginOutputReadLine();
        p.BeginErrorReadLine();
        Log("INFO", "Started Office Bridge PID=" + p.Id + " on 127.0.0.1:3210");
        return p;
    }

    private static Process StartHermes3dProcess(string studioToken, string bridgeToken)
    {
        var psi = new ProcessStartInfo
        {
            FileName = NodeExe,
            Arguments = string.Format("\"{0}\"", Hermes3dScript),
            WorkingDirectory = Hermes3dDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        psi.EnvironmentVariables["NODE_ENV"] = "production";
        psi.EnvironmentVariables["HOST"] = "127.0.0.1";
        psi.EnvironmentVariables["PORT"] = "3200";
        psi.EnvironmentVariables["HERMES_STATE_DIR"] = StudioStateDir;
        psi.EnvironmentVariables["HERMES3D_GATEWAY_URL"] = "ws://127.0.0.1:3210/ws";
        psi.EnvironmentVariables["HERMES3D_GATEWAY_ADAPTER_TYPE"] = "hermes";
        if (!string.IsNullOrEmpty(bridgeToken))
        {
            psi.EnvironmentVariables["HERMES3D_GATEWAY_TOKEN"] = bridgeToken;
        }
        psi.EnvironmentVariables["OFFICE_BRIDGE_HTTP_URL"] = "http://127.0.0.1:3210";
        psi.EnvironmentVariables["OFFICE_BRIDGE_WS_URL"] = "ws://127.0.0.1:3210";
        psi.EnvironmentVariables["UPSTREAM_ALLOWLIST"] = "127.0.0.1,localhost";
        psi.EnvironmentVariables["CUSTOM_RUNTIME_ALLOWLIST"] = "127.0.0.1:3210,localhost:3210";
        psi.EnvironmentVariables["UNIFIED_COMPANY_GOVERNANCE"] = "1";
        psi.EnvironmentVariables["NEXT_TELEMETRY_DISABLED"] = "1";
        psi.EnvironmentVariables["NODE_OPTIONS"] = "--max-old-space-size=768";
        if (!string.IsNullOrEmpty(studioToken))
        {
            psi.EnvironmentVariables["STUDIO_ACCESS_TOKEN"] = studioToken;
        }
        string nodeDir = Path.GetDirectoryName(NodeExe);
        psi.EnvironmentVariables["PATH"] = string.Format("{0};{1}", nodeDir, psi.EnvironmentVariables["PATH"] ?? "");

        var p = new Process { StartInfo = psi, EnableRaisingEvents = true };
        p.OutputDataReceived += (s, e) => { if (!string.IsNullOrEmpty(e.Data)) Log("H3D", e.Data); };
        p.ErrorDataReceived += (s, e) => { if (!string.IsNullOrEmpty(e.Data)) Log("H3D_ERR", e.Data); };
        p.Start();
        try { p.PriorityClass = ProcessPriorityClass.Normal; } catch { }
        p.BeginOutputReadLine();
        p.BeginErrorReadLine();
        Log("INFO", "Started Hermes3D Production Server PID=" + p.Id + " on 127.0.0.1:3200");
        return p;
    }

    private static void KillSafe(Process p)
    {
        try { if (p != null && !p.HasExited) p.Kill(); } catch { }
    }

    private static int Main(string[] args)
    {
        if (args.Length > 0 && string.Equals(args[0], "--stop", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                if (File.Exists(StateJsonPath))
                {
                    string txt = File.ReadAllText(StateJsonPath);
                    foreach (Match m in Regex.Matches(txt, "\"(?:bridge_pid|hermes3d_pid|launcher_pid)\":(\\d+)"))
                    {
                        int pid;
                        if (int.TryParse(m.Groups[1].Value, out pid) && pid > 0 && pid != Process.GetCurrentProcess().Id)
                        {
                            try { var proc = Process.GetProcessById(pid); if (!proc.HasExited) proc.Kill(); } catch { }
                        }
                    }
                }
            }
            catch { }
            return 0;
        }

        bool createdNew;
        using (var mutex = new Mutex(true, MutexName, out createdNew))
        {
            if (!createdNew)
            {
                return 0; // Singleton already active
            }

            Console.CancelKeyPress += (s, e) =>
            {
                e.Cancel = true;
                _stopping = true;
                KillSafe(_h3dProc);
                KillSafe(_bridgeProc);
            };

            // Wait up to 35s for Paperclip on 127.0.0.1:3100 on cold boot (non-fatal if Paperclip still booting)
            for (int i = 0; i < 35 && !_stopping; i++)
            {
                if (ProbeHttpOk("http://127.0.0.1:3100/api/health", 1500)) break;
                Thread.Sleep(1000);
            }

            int bridgeQuickFails = 0, h3dQuickFails = 0;
            int bridgeRestarts = 0, h3dRestarts = 0;
            DateTime bridgeStartUtc = DateTime.MinValue, h3dStartUtc = DateTime.MinValue;
            DateTime bridgeNextStartUtc = DateTime.MinValue, h3dNextStartUtc = DateTime.MinValue;

            while (!_stopping)
            {
                if (IsMaintenanceActive())
                {
                    KillSafe(_h3dProc);
                    KillSafe(_bridgeProc);
                    WriteLauncherState("maintenance_deferred", bridgeRestarts, h3dRestarts);
                    Thread.Sleep(8000);
                    continue;
                }

                // 1. Supervise Office Bridge (127.0.0.1:3210)
                if (_bridgeProc == null || _bridgeProc.HasExited)
                {
                    if (_bridgeProc != null)
                    {
                        double ran = (DateTime.UtcNow - bridgeStartUtc).TotalSeconds;
                        Log("WARN", string.Format("Office Bridge exited (code={0}) after {1:F1}s", _bridgeProc.ExitCode, ran));
                        if (ran >= 45.0) bridgeQuickFails = 0; else bridgeQuickFails++;
                        int delaySec = bridgeQuickFails >= 6 ? 180 : Math.Min(30, (int)(3 * Math.Pow(2, Math.Min(bridgeQuickFails, 3))));
                        if (bridgeQuickFails >= 6) bridgeQuickFails = 0;
                        bridgeNextStartUtc = DateTime.UtcNow.AddSeconds(delaySec);
                        bridgeRestarts++;
                        _bridgeProc = null;
                    }
                    if (DateTime.UtcNow >= bridgeNextStartUtc)
                    {
                        try
                        {
                            bridgeStartUtc = DateTime.UtcNow;
                            _bridgeProc = StartBridgeProcess();
                            // Wait up to 12s for bridge health & secret generation
                            for (int w = 0; w < 24 && !_stopping; w++)
                            {
                                if (ProbeHttpOk("http://127.0.0.1:3210/health", 1000) && File.Exists(SecretsJsonPath)) break;
                                Thread.Sleep(500);
                            }
                        }
                        catch (Exception ex)
                        {
                            Log("ERROR", "Failed starting Office Bridge: " + ex.Message);
                            bridgeNextStartUtc = DateTime.UtcNow.AddSeconds(10);
                        }
                    }
                }

                // 2. Supervise Hermes3D (127.0.0.1:3200) once SecretsJsonPath exists
                if ((_h3dProc == null || _h3dProc.HasExited) && File.Exists(SecretsJsonPath))
                {
                    if (_h3dProc != null)
                    {
                        double ran = (DateTime.UtcNow - h3dStartUtc).TotalSeconds;
                        Log("WARN", string.Format("Hermes3D exited (code={0}) after {1:F1}s", _h3dProc.ExitCode, ran));
                        if (ran >= 45.0) h3dQuickFails = 0; else h3dQuickFails++;
                        int delaySec = h3dQuickFails >= 6 ? 180 : Math.Min(30, (int)(3 * Math.Pow(2, Math.Min(h3dQuickFails, 3))));
                        if (h3dQuickFails >= 6) h3dQuickFails = 0;
                        h3dNextStartUtc = DateTime.UtcNow.AddSeconds(delaySec);
                        h3dRestarts++;
                        _h3dProc = null;
                    }
                    if (DateTime.UtcNow >= h3dNextStartUtc)
                    {
                        try
                        {
                            string secRaw = File.ReadAllText(SecretsJsonPath);
                            string bridgeToken = ExtractJsonString(secRaw, "bridgeToken");
                            string studioToken = ExtractJsonString(secRaw, "studioAccessToken");
                            EnsureStudioSettingsSeeded(bridgeToken);
                            h3dStartUtc = DateTime.UtcNow;
                            _h3dProc = StartHermes3dProcess(studioToken, bridgeToken);
                        }
                        catch (Exception ex)
                        {
                            Log("ERROR", "Failed starting Hermes3D: " + ex.Message);
                            h3dNextStartUtc = DateTime.UtcNow.AddSeconds(10);
                        }
                    }
                }

                WriteLauncherState("running", bridgeRestarts, h3dRestarts);
                Thread.Sleep(1000);
            }

            KillSafe(_h3dProc);
            KillSafe(_bridgeProc);
            WriteLauncherState("stopped", bridgeRestarts, h3dRestarts);
            return 0;
        }
    }
}
