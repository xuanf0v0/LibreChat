@echo off
REM Starts MongoDB for LibreChat. Launched from the startup folder shortcut
REM LibreChat-Mongo.lnk (a logon scheduled task needs admin rights).
"D:\Projects\LibreChat\node_modules\.cache\mongodb-memory-server\mongod-x64-win32-8.2.6.exe" ^
  --dbpath D:\LibreChatData\mongo ^
  --port 27017 ^
  --bind_ip 127.0.0.1 ^
  --logpath D:\LibreChatData\mongod.log ^
  --logappend
