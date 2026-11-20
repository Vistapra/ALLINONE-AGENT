using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

internal static class Program {
    private static readonly string HermesHome = Environment.GetEnvironmentVariable("ALLINONE_HERMES_HOME")
        ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "hermes");
    private static readonly string ToolsRoot = Path.Combine(HermesHome, "tools");
    private const string DefaultPipeName = "cua-driver";
    private const string DefaultPipePath = @"\\.\pipe\cua-driver";

    private static string ResolveDriverBinary() {
        try {
            if (Directory.Exists(ToolsRoot)) {
                string[] dirs = Directory.GetDirectories(ToolsRoot, "cua-driver-*");
                Array.Sort(dirs, StringComparer.OrdinalIgnoreCase);
                for (int i = dirs.Length - 1; i >= 0; i--) {
                    string candidate = Path.Combine(dirs[i], "cua-driver.exe");
                    if (File.Exists(candidate)) return candidate;
                }
            }
        } catch {}
        return Path.Combine(ToolsRoot, @"cua-driver-0.21.0-win32-x64\cua-driver.exe");
    }

    private static bool IsDaemonPipePresent() {
        try {
            return Directory.GetFiles(@"\\.\pipe\", DefaultPipeName).Length > 0;
        } catch {
            return false;
        }
    }

    private static bool EnsureDaemonPipeIfInteractive() {
        if (IsDaemonPipePresent()) return true;
        try {
            if (Process.GetCurrentProcess().SessionId <= 0) return false;

            var psi = new ProcessStartInfo {
                FileName = "schtasks.exe",
                Arguments = "/Run /TN \"\\cua-driver-serve\"",
                CreateNoWindow = true,
                UseShellExecute = false,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            using (Process p = Process.Start(psi)) {
                if (p != null) p.WaitForExit(3000);
            }
            for (int i = 0; i < 12; i++) {
                Thread.Sleep(200);
                if (IsDaemonPipePresent()) return true;
            }
        } catch {}
        return IsDaemonPipePresent();
    }

    private static string QuoteArg(string arg) {
        if (arg == null) return "\"\"";
        if (arg.Length > 0 && arg.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0) {
            return arg;
        }
        var sb = new StringBuilder();
        sb.Append('"');
        int backslashes = 0;
        foreach (char c in arg) {
            if (c == '\\') {
                backslashes++;
            } else if (c == '"') {
                sb.Append('\\', backslashes * 2 + 1);
                sb.Append('"');
                backslashes = 0;
            } else {
                sb.Append('\\', backslashes);
                sb.Append(c);
                backslashes = 0;
            }
        }
        sb.Append('\\', backslashes * 2);
        sb.Append('"');
        return sb.ToString();
    }

    private static string BuildArgString(IList<string> args) {
        var parts = new string[args.Count];
        for (int i = 0; i < args.Count; i++) {
            parts[i] = QuoteArg(args[i]);
        }
        return string.Join(" ", parts);
    }

    private static int Main(string[] args) {
        string binary = ResolveDriverBinary();
        if (!File.Exists(binary)) {
            Console.Error.WriteLine("cua-driver binary not found at: " + binary);
            return 1;
        }

        if (args.Length >= 1 && string.Equals(args[0], "manifest", StringComparison.OrdinalIgnoreCase)) {
            var psi = new ProcessStartInfo {
                FileName = binary,
                Arguments = BuildArgString(args),
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
                CreateNoWindow = true
            };
            using (Process p = Process.Start(psi)) {
                if (p == null) return 1;
                string stdout = p.StandardOutput.ReadToEnd();
                string stderr = p.StandardError.ReadToEnd();
                p.WaitForExit();
                if (p.ExitCode == 0 && EnsureDaemonPipeIfInteractive()) {
                    stdout = Regex.Replace(
                        stdout,
                        @"""mcp_invocation""\s*:\s*\{\s*""args""\s*:\s*\[\s*""mcp""\s*\]",
                        "\"mcp_invocation\":{\"args\":[\"mcp\",\"--socket\",\"\\\\\\\\.\\\\pipe\\\\cua-driver\"]"
                    );
                }
                if (!string.IsNullOrEmpty(stderr)) Console.Error.Write(stderr);
                Console.Out.Write(stdout);
                return p.ExitCode;
            }
        }

        var forwardArgs = new List<string>(args);
        if (forwardArgs.Count >= 1 && string.Equals(forwardArgs[0], "mcp", StringComparison.OrdinalIgnoreCase)) {
            bool hasSocketOrDirect = false;
            for (int i = 1; i < forwardArgs.Count; i++) {
                if (string.Equals(forwardArgs[i], "--socket", StringComparison.OrdinalIgnoreCase) ||
                    forwardArgs[i].StartsWith("--socket=", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(forwardArgs[i], "--direct", StringComparison.OrdinalIgnoreCase)) {
                    hasSocketOrDirect = true;
                    break;
                }
            }
            if (!hasSocketOrDirect && EnsureDaemonPipeIfInteractive()) {
                forwardArgs.Add("--socket");
                forwardArgs.Add(DefaultPipePath);
            }
        }

        var passthrough = new ProcessStartInfo {
            FileName = binary,
            Arguments = BuildArgString(forwardArgs),
            UseShellExecute = false,
            CreateNoWindow = true
        };
        using (Process child = Process.Start(passthrough)) {
            if (child == null) return 1;
            child.WaitForExit();
            return child.ExitCode;
        }
    }
}
