# NAVAID-COLREGS

An autonomous marine collision avoidance and bridge decision support system developed for surface navigation research.

---

## Overview

NAVAID-COLREGS evaluates maritime traffic encounters using planar vector kinematics and international collision regulations (COLREGS Rules 13–18). It calculates Closest Point of Approach (CPA), Time to CPA (TCPA), Bow Crossing Range (BCR), and searches candidate courses to determine collision-free maneuvers.

---

## Directory Structure

```
NAVAID/
├── .gitignore             # Git ignore patterns
├── README.md              # Project documentation
├── requirements.txt       # Dependencies (Standard Library)
├── run.bat                # Windows launcher
├── run.sh                 # Linux/macOS launcher
├── server.py              # Multi-threaded HTTP and REST API server
└── static/
    ├── index.html         # Marine ARPA radar and bridge console
    ├── css/
    │   └── ecdis.css      # Console styling and layout
    └── js/
        ├── app.js         # Interface coordinator
        ├── colregs_math.js    # Vector mathematics and NMEA stream
        ├── colregs_rules.js   # Decision logic engine
        └── radar_display.js   # Canvas radar display
```

---

## Quickstart

### Prerequisites
* Python 3.8 or higher installed on your system.

### Running the System
* **Windows:** Double-click `run.bat` or run:
  ```cmd
  python server.py
  ```
* **Linux / macOS:**
  ```bash
  chmod +x run.sh
  ./run.sh
  ```
* Open your browser to `http://localhost:8090`.

---

## System Capabilities

1. **Plan Position Indicator (PPI) Radar:**
   * 360-degree rotating beam simulation.
   * Motion vector projection (True and Relative motion).
   * Range selection from 2 NM to 16 NM.

2. **Collision Risk Evaluation:**
   * Automated CPA and TCPA calculation.
   * Identification of Give-Way and Stand-On roles under Rule 14 (Head-on), Rule 15 (Crossing), and Rule 13 (Overtaking).

3. **Trial Maneuver Simulator:**
   * Real-time course alteration preview.
   * Multi-target clearance verification before commanding helm changes.

4. **Telemetry & Sensor Streaming:**
   * Integrated NMEA 0183 serial stream simulation ($GPRMC, $HEHDT, !AIVDM, $SDDPT).
   * Voyage Data Recorder (VDR) audit export in JSON format.
