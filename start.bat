@echo off
REM Double-click to run WaveSensr on Windows. Needs Python once; nothing else.
cd /d "%~dp0"
where py >nul 2>&1 || goto nopython
py -c "import serial" >nul 2>&1 || (echo Installing pyserial... & py -m pip install --user --quiet pyserial)
echo WaveSensr - plug the receiver into this PC by USB, power the sender.
echo The page opens in a moment. Close this window to stop.
py server.py --open
pause
exit /b

:nopython
echo Python is not installed.
echo Get it from https://www.python.org/downloads/ and tick "Add python.exe to PATH",
echo then double-click this file again.
pause
