@echo off
rem Real-model pilot for the selection study (oracle-target and same-budget list). Uses GEMINI_API_KEY from .env.
cd /d "%~dp0\..\..\.."
echo started %date% %time% > eval\results\selection\e2e\pilot\run.log
node --no-warnings eval\selection\e2e\run-e2e.mjs --rpm 14 >> eval\results\selection\e2e\pilot\run.log 2>&1
echo exit %errorlevel% finished %date% %time% >> eval\results\selection\e2e\pilot\run.log
