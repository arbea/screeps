@echo off
cd /d "%~dp0"

set /p MSG=Commit message (leave empty for timestamp):
if "%MSG%"=="" set MSG=sync %date% %time%

git add -A
git commit -m "%MSG%"
git push

echo.
echo ---------------------------------
echo Done.
pause
