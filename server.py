#!/usr/bin/env python3
"""
NAVAID-COLREGS - Autonomous Ship Collision Avoidance & Decision Support Server
Zero-dependency Python HTTP + REST API Server.
"""

import os
import sys
import json
import time
import math
import mimetypes
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

PORT = 8090
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "colregs_state.json")

# 1 Nautical Mile in meters = 1852.0
# 1 Knot in m/s = 1852.0 / 3600.0 = 0.514444

def get_default_state():
    return {
        "own_ship": {
            "mmsi": "368920000",
            "name": "M/V PACIFIC PIONEER",
            "callsign": "WDF8821",
            "type": "Autonomous Container Ship",
            "lat": 1.2500,     # Singapore / Malacca Strait coordinates
            "lon": 103.8500,
            "cog": 070.0,      # Course Over Ground (degrees)
            "sog": 16.5,       # Speed Over Ground (knots)
            "heading": 070.0,
            "length": 220.0,   # meters
            "beam": 32.0,      # meters
            "draft": 11.2,     # meters
            "domain_radius_nm": 1.5 # Safety clearance zone
        },
        "safety_thresholds": {
            "cpa_limit_nm": 2.0,      # Critical warning if CPA < 2.0 NM
            "tcpa_limit_min": 15.0,   # Critical warning if TCPA < 15.0 min
            "caution_cpa_nm": 3.0,
            "caution_tcpa_min": 25.0,
            "vector_time_min": 12.0   # Length of motion prediction vectors
        },
        "simulation": {
            "running": True,
            "speed_multiplier": 1.0,
            "last_tick": time.time(),
            "active_scenario": "malacca_multi"
        },
        "contacts": [
            {
                "mmsi": "477123400",
                "name": "C/V MAJESTIC LEADER",
                "callsign": "VRAB8",
                "type": "Container Ship",
                "lat": 1.3400,
                "lon": 104.0900,
                "cog": 248.0,   # Near reciprocal course (Head-on encounter Rule 14)
                "sog": 18.0,
                "heading": 248.0,
                "length": 330.0,
                "beam": 48.0,
                "draft": 13.5
            },
            {
                "mmsi": "538009800",
                "name": "M/T NORDIC VALOR",
                "callsign": "V7KT4",
                "type": "Crude Oil Tanker",
                "lat": 1.1500,
                "lon": 103.9800,
                "cog": 345.0,   # Crossing from Starboard (Rule 15 Give-Way encounter)
                "sog": 13.2,
                "heading": 345.0,
                "length": 250.0,
                "beam": 44.0,
                "draft": 14.8
            },
            {
                "mmsi": "311000540",
                "name": "M/V ASIAN HORIZON",
                "callsign": "C6TX2",
                "type": "Bulk Carrier",
                "lat": 1.2200,
                "lon": 103.7500,
                "cog": 072.0,   # Ahead of us traveling slower (Overtaking Rule 13)
                "sog": 9.5,
                "heading": 072.0,
                "length": 190.0,
                "beam": 30.0,
                "draft": 9.8
            },
            {
                "mmsi": "563004320",
                "name": "TUG RESOLUTE",
                "callsign": "9V8123",
                "type": "Tug & Tow (RAM)",
                "lat": 1.3200,
                "lon": 103.8800,
                "cog": 135.0,
                "sog": 6.0,
                "heading": 135.0,
                "length": 45.0,
                "beam": 12.0,
                "draft": 4.5,
                "nav_status": "Restricted Ability to Maneuver" # Rule 18
            }
        ],
        "vdr_log": [
            {"time": "08:30:00", "event": "SYSTEM START: NAVAID-COLREGS ENGINE ACTIVE. WATCH LEVEL 1.", "severity": "INFO"},
            {"time": "08:30:15", "event": "TARGET ACQUIRED: MMSI 477123400 (C/V MAJESTIC LEADER) ON RECIPROCAL TRACK.", "severity": "WARN"},
            {"time": "08:30:45", "event": "COLLISION THREAT DETECTED: M/T NORDIC VALOR ON STARBOARD CROSSING VECTOR. CPA 0.4 NM.", "severity": "CRIT"}
        ]
    }

class COLREGSStore:
    def __init__(self):
        self.state = self.load()
        self.last_update = time.time()

    def load(self):
        if os.path.exists(STATE_FILE):
            try:
                with open(STATE_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                print(f"[COLREGS] Error reading state file, using defaults: {e}")
        return get_default_state()

    def save(self):
        try:
            with open(STATE_FILE, "w", encoding="utf-8") as f:
                json.dump(self.state, f, indent=2)
        except Exception as e:
            print(f"[COLREGS] Error saving state: {e}")

    def add_log(self, event, severity="INFO"):
        now_str = time.strftime("%H:%M:%S")
        self.state["vdr_log"].insert(0, {
            "time": now_str,
            "event": event,
            "severity": severity
        })
        if len(self.state["vdr_log"]) > 150:
            self.state["vdr_log"] = self.state["vdr_log"][:150]
        self.save()

    def tick_simulation(self, dt_seconds=1.0):
        """Advances positions of own ship and all AIS contacts using dead reckoning."""
        if not self.state["simulation"]["running"]:
            return

        multiplier = self.state["simulation"].get("speed_multiplier", 1.0)
        dt_hours = (dt_seconds * multiplier) / 3600.0

        # Update Own Ship
        own = self.state["own_ship"]
        dist_nm = own["sog"] * dt_hours
        rad_cog = math.radians(own["cog"])
        # 1 degree latitude = 60 NM
        delta_lat = (dist_nm * math.cos(rad_cog)) / 60.0
        # 1 degree longitude = 60 * cos(lat) NM
        cos_lat = math.cos(math.radians(own["lat"]))
        delta_lon = (dist_nm * math.sin(rad_cog)) / (60.0 * max(0.1, cos_lat))
        own["lat"] += delta_lat
        own["lon"] += delta_lon

        # Update Contacts
        for c in self.state["contacts"]:
            c_dist_nm = c["sog"] * dt_hours
            c_rad_cog = math.radians(c["cog"])
            c_delta_lat = (c_dist_nm * math.cos(c_rad_cog)) / 60.0
            c_cos_lat = math.cos(math.radians(c["lat"]))
            c_delta_lon = (c_dist_nm * math.sin(c_rad_cog)) / (60.0 * max(0.1, c_cos_lat))
            c["lat"] += c_delta_lat
            c["lon"] += c_delta_lon

        self.last_update = time.time()

store = COLREGSStore()

class COLREGSHandler(BaseHTTPRequestHandler):
    def send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_HEAD(self):
        self.do_GET()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def read_json_body(self):
        content_len = int(self.headers.get("Content-Length", 0))
        if content_len > 0:
            raw = self.rfile.read(content_len)
            try:
                return json.loads(raw.decode("utf-8"))
            except Exception:
                return {}
        return {}

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/"):
            if path in ["/api/state", "/api/telemetry"]:
                # Advance simulation by elapsed time
                now = time.time()
                dt = min(5.0, now - store.last_update)
                if dt > 0.2:
                    store.tick_simulation(dt)
                self.send_json(store.state)
                return
            elif path == "/api/vdr/export":
                self.send_json({
                    "system": "NAVAID-COLREGS Decision Support Engine",
                    "export_timestamp": time.strftime("%Y-%m-%d %H:%M:%S UTC"),
                    "own_ship": store.state["own_ship"],
                    "contacts": store.state["contacts"],
                    "safety_thresholds": store.state["safety_thresholds"],
                    "vdr_log": store.state["vdr_log"]
                })
                return
            else:
                self.send_json({"error": "Endpoint not found"}, 404)
                return

        # Serve static assets
        if path in ["/", ""]:
            rel_path = "index.html"
        else:
            rel_path = path.lstrip("/")

        file_path = os.path.join(STATIC_DIR, rel_path)
        file_path = os.path.normpath(file_path)

        if not file_path.startswith(STATIC_DIR):
            self.send_response(403)
            self.end_headers()
            self.wfile.write(b"Forbidden")
            return

        if os.path.isfile(file_path):
            content_type, _ = mimetypes.guess_type(file_path)
            content_type = content_type or "application/octet-stream"
            try:
                with open(file_path, "rb") as f:
                    content = f.read()
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(f"Server error: {e}".encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"File not found")

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        body = self.read_json_body()

        if path == "/api/ownship/helm":
            # Command course / speed change
            new_cog = body.get("cog")
            new_sog = body.get("sog")
            if new_cog is not None:
                store.state["own_ship"]["cog"] = float(new_cog) % 360.0
                store.state["own_ship"]["heading"] = store.state["own_ship"]["cog"]
            if new_sog is not None:
                store.state["own_ship"]["sog"] = max(0.0, float(new_sog))
            store.add_log(f"AUTONOMOUS HELM ORDER EXECUTED: COURSE {store.state['own_ship']['cog']:.1f}° | SPEED {store.state['own_ship']['sog']:.1f} KTS", "WARN")
            store.save()
            self.send_json({"success": True, "own_ship": store.state["own_ship"]})
            return

        elif path == "/api/safety/thresholds":
            if "cpa_limit_nm" in body:
                store.state["safety_thresholds"]["cpa_limit_nm"] = float(body["cpa_limit_nm"])
            if "tcpa_limit_min" in body:
                store.state["safety_thresholds"]["tcpa_limit_min"] = float(body["tcpa_limit_min"])
            if "vector_time_min" in body:
                store.state["safety_thresholds"]["vector_time_min"] = float(body["vector_time_min"])
            store.save()
            self.send_json({"success": True, "safety_thresholds": store.state["safety_thresholds"]})
            return

        elif path == "/api/simulation/control":
            if "running" in body:
                store.state["simulation"]["running"] = bool(body["running"])
            if "speed_multiplier" in body:
                store.state["simulation"]["speed_multiplier"] = max(0.1, min(10.0, float(body["speed_multiplier"])))
            state_str = "RESUMED" if store.state["simulation"]["running"] else "PAUSED"
            store.add_log(f"SIMULATION {state_str} (SPEED: {store.state['simulation']['speed_multiplier']}x)", "INFO")
            store.save()
            self.send_json({"success": True, "simulation": store.state["simulation"]})
            return

        elif path == "/api/scenario":
            sc_id = body.get("scenario", "malacca_multi")
            if sc_id == "malacca_multi":
                store.state = get_default_state()
                store.state["simulation"]["active_scenario"] = "malacca_multi"
                store.add_log("LOADED SCENARIO: STRAIT OF MALACCA MULTI-VESSEL TRAFFIC CHOKEPOINT.", "WARN")

            elif sc_id == "head_on_conflict":
                store.state = get_default_state()
                store.state["simulation"]["active_scenario"] = "head_on_conflict"
                store.state["contacts"] = [
                    {
                        "mmsi": "477991200",
                        "name": "M/V EVER ACCORD",
                        "callsign": "BK821",
                        "type": "Ultra Large Container Ship",
                        "lat": 1.2500,
                        "lon": 103.9600, # Directly ahead at 6.6 NM
                        "cog": 250.0,    # Reciprocal heading Rule 14
                        "sog": 19.5,
                        "heading": 250.0,
                        "length": 399.0,
                        "beam": 58.0,
                        "draft": 15.5
                    }
                ]
                store.add_log("LOADED SCENARIO: PURE RULE 14 HEAD-ON ENCOUNTER (RECIPROCAL TRACKS).", "WARN")

            elif sc_id == "starboard_crossing":
                store.state = get_default_state()
                store.state["simulation"]["active_scenario"] = "starboard_crossing"
                store.state["contacts"] = [
                    {
                        "mmsi": "211554000",
                        "name": "M/F BALTIC EXPRESS",
                        "callsign": "DLFX",
                        "type": "High Speed Ro-Pax Ferry",
                        "lat": 1.1700,
                        "lon": 103.9100, # 5.4 NM on starboard quarter crossing at 22 knots
                        "cog": 015.0,
                        "sog": 22.0,
                        "heading": 015.0,
                        "length": 180.0,
                        "beam": 28.0,
                        "draft": 6.8
                    }
                ]
                store.add_log("LOADED SCENARIO: RULE 15 CRITICAL STARBOARD CROSSING (GIVE-WAY OBLIGATION).", "CRIT")

            elif sc_id == "clear_sea":
                store.state = get_default_state()
                store.state["simulation"]["active_scenario"] = "clear_sea"
                store.state["contacts"] = []
                store.add_log("SANDBOX OPENED: CLEAR SEAS. READY FOR CUSTOM AIS CONTACT INJECTION.", "INFO")

            store.save()
            self.send_json({"success": True, "state": store.state})
            return

        elif path == "/api/contacts/add":
            new_contact = {
                "mmsi": str(body.get("mmsi", f"311{int(time.time())%1000000:06d}")),
                "name": str(body.get("name", "M/V TEST TARGET")),
                "callsign": str(body.get("callsign", "TCST1")),
                "type": str(body.get("type", "General Cargo")),
                "lat": float(body.get("lat", store.state["own_ship"]["lat"] + 0.05)),
                "lon": float(body.get("lon", store.state["own_ship"]["lon"] + 0.05)),
                "cog": float(body.get("cog", 200.0)),
                "sog": float(body.get("sog", 12.0)),
                "heading": float(body.get("cog", 200.0)),
                "length": float(body.get("length", 150.0)),
                "beam": float(body.get("beam", 22.0)),
                "draft": float(body.get("draft", 8.0)),
                "nav_status": str(body.get("nav_status", "Underway using engine"))
            }
            store.state["contacts"].append(new_contact)
            store.add_log(f"NEW AIS TARGET INJECTED: {new_contact['name']} (MMSI: {new_contact['mmsi']})", "INFO")
            store.save()
            self.send_json({"success": True, "contact": new_contact})
            return

        self.send_json({"error": "Endpoint not found"}, 404)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/contacts/"):
            mmsi = path.replace("/api/contacts/", "").strip()
            before_len = len(store.state["contacts"])
            store.state["contacts"] = [c for c in store.state["contacts"] if c["mmsi"] != mmsi]
            if len(store.state["contacts"]) < before_len:
                store.add_log(f"AIS TARGET DROPPED: MMSI {mmsi}", "INFO")
                store.save()
                self.send_json({"success": True, "mmsi": mmsi})
                return
            self.send_json({"error": "Target not found"}, 404)
            return

        self.send_json({"error": "Not found"}, 404)

    def log_message(self, format, *args):
        pass

def run_server():
    global PORT
    for try_port in [8090, 8091, 8092, 8095]:
        try:
            server_address = ("", try_port)
            httpd = ThreadingHTTPServer(server_address, COLREGSHandler)
            PORT = try_port
            break
        except OSError:
            continue
    else:
        print("[COLREGS] ERROR: Could not bind to port.")
        return

    print("==================================================================")
    print("  NAVAID-COLREGS : AUTONOMOUS SHIP COLLISION AVOIDANCE ENGINE")
    print(f"  Live ECDIS / ARPA Decision Support Server on http://localhost:{PORT}")
    print("==================================================================")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[COLREGS] Engine shutting down.")
        httpd.server_close()

if __name__ == "__main__":
    run_server()
