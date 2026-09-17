@echo off
REM Double-click to run WaveSensr on Windows.
cd /d "%~dp0"

REM Find Python: the py launcher, or plain python (Anaconda and the Store build have no py).
set PY=
where py >nul 2>&1
if not errorlevel 1 set PY=py
if defined PY goto check
where python >nul 2>&1
if not errorlevel 1 set PY=python
if defined PY goto check
goto nopython

:check
%PY% -c "import sys" >nul 2>&1
if errorlevel 1 goto nopython

%PY% -c "import serial" >nul 2>&1
if not errorlevel 1 goto run
echo Installing pyserial (once)...
%PY% -m pip install --quiet pyserial
%PY% -c "import serial" >nul 2>&1
if not errorlevel 1 goto run
%PY% -m pip install --quiet --user pyserial

:run
echo WaveSensr - plug the receiver into this PC by USB, power the sender.
echo The page opens in a moment. Close this window to stop.
%PY% server.py --open
pause
exit /b

:nopython
echo Python was not found on this PC.
echo Install it from https://www.python.org/downloads/ and tick "Add python.exe to PATH",
echo then double-click this file again.
pause
