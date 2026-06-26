@echo off
:: EyeType — Windows launcher
:: Opens the app in Chrome (preferred) or Edge, then falls back to default browser

set "APP_PATH=%~dp0index.html"

where chrome >nul 2>&1
if %ERRORLEVEL%==0 (
    echo Launching in Chrome...
    start chrome --allow-file-access-from-files "%APP_PATH%"
    goto :done
)

where msedge >nul 2>&1
if %ERRORLEVEL%==0 (
    echo Launching in Edge...
    start msedge --allow-file-access-from-files "%APP_PATH%"
    goto :done
)

echo Launching in default browser...
start "" "%APP_PATH%"

:done
echo.
echo EyeType is launching...
echo If camera access is blocked, try opening Chrome and navigating to:
echo   %APP_PATH%
echo.
