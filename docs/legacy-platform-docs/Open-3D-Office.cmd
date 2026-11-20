@echo off
REM Copies your local Owner Studio Access Token to the Windows Clipboard (without displaying it)
REM and opens the Unified Autonomous AI Company 3D Virtual Office in your default browser.
python -c "import json, subprocess; tok=json.load(open(r'${ALLINONE_HOME}\config\secrets\office-bridge-auth.json', encoding='utf-8'))['studioAccessToken']; subprocess.run(['clip.exe'], input=tok.encode('utf-8'), check=True)"
start "" "http://127.0.0.1:3200/office"
