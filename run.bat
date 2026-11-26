@echo off
title NAVAID-COLREGS : Autonomous Collision Avoidance System
echo ====================================================================
echo   NAVAID-COLREGS : Autonomous Marine Collision Avoidance System
echo   Bridge Decision Support & ARPA Radar Console
echo ====================================================================
echo Starting server on http://localhost:8090 ...
python -u "%~dp0server.py"
pause
