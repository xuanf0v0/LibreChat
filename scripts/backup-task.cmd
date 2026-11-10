@echo off
REM Runs the verified dump and appends its output to a log, so a Task Scheduler
REM failure leaves evidence instead of vanishing. Task: LibreChat-MongoBackup.
setlocal
set LOG=D:\LibreChatData\backup.log
echo [%DATE% %TIME%] start>>"%LOG%"
"C:\Program Files\nodejs\node.exe" "D:\Projects\LibreChat\scripts\dump.cjs" >>"%LOG%" 2>&1
set CODE=%ERRORLEVEL%
echo [%DATE% %TIME%] exit=%CODE%>>"%LOG%"
exit /b %CODE%
