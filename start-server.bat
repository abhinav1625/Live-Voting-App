@echo off
title Live Voting App Server
echo Starting Live Voting App on Windows...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
pause

