#!/usr/bin/env bash
echo "===================================================================="
echo "  NAVAID-COLREGS : Autonomous Marine Collision Avoidance System"
echo "  Bridge Decision Support & ARPA Radar Console"
echo "===================================================================="
echo "Starting server on http://localhost:8090 ..."
python3 "$(dirname "$0")/server.py"
