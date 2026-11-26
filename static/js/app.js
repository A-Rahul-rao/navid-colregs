/**
 * NAVAID-COLREGS : Human-Centered Decision Support Controller
 * Synchronizes real-time kinematics, COLREGS rules, canvas radar display,
 * procedural tactical audio, and autonomous helm orders.
 */

class TacticalAudio {
    constructor() {
        this.ctx = null;
        this.enabled = true;
    }

    init() {
        if (!this.ctx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
                this.ctx = new AudioContext();
            }
        }
        if (this.ctx && this.ctx.state === "suspended") {
            this.ctx.resume();
        }
    }

    playTone(freq, type = "sine", duration = 0.08, gainVal = 0.08) {
        if (!this.enabled) return;
        this.init();
        if (!this.ctx) return;
        try {
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, now);
            gain.gain.setValueAtTime(gainVal, now);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now);
            osc.stop(now + duration);
        } catch (e) {}
    }

    targetLock() {
        this.playTone(750, "sine", 0.05, 0.08);
        setTimeout(() => this.playTone(1100, "sine", 0.06, 0.1), 40);
    }

    helmExec() {
        this.playTone(523.25, "triangle", 0.09, 0.12);
        setTimeout(() => this.playTone(659.25, "triangle", 0.1, 0.12), 70);
        setTimeout(() => this.playTone(783.99, "triangle", 0.12, 0.15), 140);
    }
}

class ColregsApp {
    constructor() {
        this.state = null;
        this.radar = null;
        this.selectedMmsi = "477123400"; // default selection (head-on container ship)
        this.encounterMap = {};
        this.pollTimer = null;
        this.trialCourseOffset = 0;
        this.isTrialActive = false;
        this.audio = new TacticalAudio();
    }

    async init() {
        this.radar = new RadarDisplay("radar-canvas");
        this.bindEvents();
        await this.fetchState();
        this.startPolling();
        this.startZuluClock();
    }

    startZuluClock() {
        setInterval(() => {
            const now = new Date();
            const hh = String(now.getUTCHours()).padStart(2, '0');
            const mm = String(now.getUTCMinutes()).padStart(2, '0');
            const ss = String(now.getUTCSeconds()).padStart(2, '0');
            const el = document.getElementById("tape-zulu");
            if (el) el.textContent = `${hh}:${mm}:${ss}Z`;
        }, 1000);
    }

    bindEvents() {
        // Tab switching logic
        document.querySelectorAll(".nav-tab-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const targetId = btn.dataset.tab;
                document.querySelectorAll(".nav-tab-btn").forEach(b => b.classList.remove("active"));
                document.querySelectorAll(".tab-view").forEach(v => v.classList.remove("active"));

                btn.classList.add("active");
                const targetView = document.getElementById(targetId);
                if (targetView) targetView.classList.add("active");

                if (targetId === "tab-radar" && this.radar) {
                    setTimeout(() => {
                        this.radar.resize();
                        if (this.state) {
                            this.radar.render(this.state.own_ship, this.state.contacts, this.encounterMap);
                        }
                    }, 50);
                }
                this.audio.playTone(650, "sine", 0.03, 0.05);
            });
        });

        // Mission Controls Popover Toggle
        const btnMissionToggle = document.getElementById("btn-mission-toggle");
        const popoverMenu = document.getElementById("mission-popover");
        const btnPopoverClose = document.getElementById("btn-popover-close");

        if (btnMissionToggle && popoverMenu) {
            btnMissionToggle.addEventListener("click", (e) => {
                e.stopPropagation();
                popoverMenu.classList.toggle("open");
                this.audio.playTone(600, "sine", 0.03, 0.05);
            });
        }
        if (btnPopoverClose && popoverMenu) {
            btnPopoverClose.addEventListener("click", () => {
                popoverMenu.classList.remove("open");
            });
        }
        document.addEventListener("click", (e) => {
            if (popoverMenu && popoverMenu.classList.contains("open")) {
                if (!popoverMenu.contains(e.target) && e.target !== btnMissionToggle) {
                    popoverMenu.classList.remove("open");
                }
            }
        });

        // Range scale selector
        const rangeSelect = document.getElementById("select-range-scale");
        if (rangeSelect) {
            rangeSelect.addEventListener("change", (e) => {
                this.radar.setRangeScale(e.target.value);
                this.audio.playTone(600, "sine", 0.04, 0.05);
            });
        }

        // Orientation mode
        const btnHeadUp = document.getElementById("btn-head-up");
        const btnNorthUp = document.getElementById("btn-north-up");
        if (btnHeadUp && btnNorthUp) {
            btnHeadUp.addEventListener("click", () => {
                btnHeadUp.classList.add("active");
                btnNorthUp.classList.remove("active");
                this.radar.setOrientation("HEAD_UP");
                this.audio.playTone(600, "sine", 0.04, 0.05);
            });
            btnNorthUp.addEventListener("click", () => {
                btnNorthUp.classList.add("active");
                btnHeadUp.classList.remove("active");
                this.radar.setOrientation("NORTH_UP");
                this.audio.playTone(600, "sine", 0.04, 0.05);
            });
        }

        // Vector mode
        const btnTrueVec = document.getElementById("btn-true-vector");
        const btnRelVec = document.getElementById("btn-rel-vector");
        if (btnTrueVec && btnRelVec) {
            btnTrueVec.addEventListener("click", () => {
                btnTrueVec.classList.add("active");
                btnRelVec.classList.remove("active");
                this.radar.setVectorMode("TRUE");
                this.audio.playTone(600, "sine", 0.04, 0.05);
            });
            btnRelVec.addEventListener("click", () => {
                btnRelVec.classList.add("active");
                btnTrueVec.classList.remove("active");
                this.radar.setVectorMode("RELATIVE");
                this.audio.playTone(600, "sine", 0.04, 0.05);
            });
        }

        // Simulation Pause / Play
        const btnSimPlay = document.getElementById("btn-sim-toggle");
        if (btnSimPlay) {
            btnSimPlay.addEventListener("click", async () => {
                const nextRunning = !this.state.simulation.running;
                await fetch("/api/simulation/control", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ running: nextRunning })
                });
                await this.fetchState();
            });
        }

        // Scenario switcher
        const scenarioSelect = document.getElementById("select-scenario");
        if (scenarioSelect) {
            scenarioSelect.addEventListener("change", async (e) => {
                if (e.target.value) {
                    await fetch("/api/scenario", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ scenario: e.target.value })
                    });
                    this.selectedMmsi = null;
                    await this.fetchState();
                }
            });
        }

        // Trial Maneuver Slider
        const trialSlider = document.getElementById("trial-course-slider");
        const trialValText = document.getElementById("trial-course-val");
        if (trialSlider && trialValText) {
            trialSlider.addEventListener("input", (e) => {
                this.trialCourseOffset = parseInt(e.target.value, 10);
                this.isTrialActive = (this.trialCourseOffset !== 0);
                const trialCog = (this.state.own_ship.cog + this.trialCourseOffset + 360) % 360;
                trialValText.textContent = `${this.trialCourseOffset >= 0 ? '+' : ''}${this.trialCourseOffset}° (HDG ${trialCog.toFixed(1)}°)`;

                if (this.isTrialActive) {
                    this.radar.setTrialManeuver({ cog: trialCog, sog: this.state.own_ship.sog });
                } else {
                    this.radar.setTrialManeuver(null);
                }
                this.renderTrialEvaluation(trialCog);
            });
        }

        // Auto-Solve Button
        const btnAutoSolve = document.getElementById("btn-auto-solve");
        if (btnAutoSolve) {
            btnAutoSolve.addEventListener("click", () => {
                this.audio.playTone(850, "sine", 0.06, 0.1);
                this.autoSolveManeuver();
            });
        }

        // Execute Helm Order
        const btnExecuteHelm = document.getElementById("btn-execute-helm");
        if (btnExecuteHelm) {
            btnExecuteHelm.addEventListener("click", () => {
                this.audio.helmExec();
                this.executeTrialHelmOrder();
            });
        }

        // Export VDR
        const btnExportVdr = document.getElementById("btn-export-vdr");
        if (btnExportVdr) {
            btnExportVdr.addEventListener("click", () => this.exportVdrLog());
        }

        // Add Target Modal
        const btnOpenAddTarget = document.getElementById("btn-open-add-target");
        const modalAddTarget = document.getElementById("modal-add-target");
        const btnCloseAddTarget = document.getElementById("btn-close-add-target");
        const formAddTarget = document.getElementById("form-add-target");

        if (btnOpenAddTarget && modalAddTarget) {
            btnOpenAddTarget.addEventListener("click", () => modalAddTarget.classList.add("open"));
        }
        if (btnCloseAddTarget && modalAddTarget) {
            btnCloseAddTarget.addEventListener("click", () => modalAddTarget.classList.remove("open"));
        }
        if (formAddTarget) {
            formAddTarget.addEventListener("submit", async (e) => {
                e.preventDefault();
                await this.submitNewTarget();
                modalAddTarget.classList.remove("open");
            });
        }

        // Radar Target Selection Callback
        this.onContactSelected = (mmsi) => {
            this.selectedMmsi = mmsi;
            this.radar.selectedMmsi = mmsi;
            if (mmsi) {
                this.audio.targetLock();
            }
            this.renderAll();
        };
    }

    async fetchState() {
        try {
            const res = await fetch("/api/state");
            if (res.ok) {
                this.state = await res.json();
                this.processKinematicsAndRules();
                this.renderAll();
            }
        } catch (err) {
            console.warn("[NAVAID-COLREGS] Fetch error:", err);
        }
    }

    startPolling() {
        this.pollTimer = setInterval(async () => {
            await this.fetchState();
        }, 1000);
    }

    processKinematicsAndRules() {
        if (!this.state || !this.state.own_ship || !this.state.contacts) return;
        this.encounterMap = {};

        this.state.contacts.forEach(c => {
            const enc = ColregsMath.calculateEncounter(this.state.own_ship, c);
            const legal = ColregsRulesEngine.evaluate(this.state.own_ship, c, enc, this.state.safety_thresholds);
            this.encounterMap[c.mmsi] = {
                ...enc,
                ...legal
            };
        });

        // If selected MMSI no longer exists, default to first critical threat or first contact
        if (this.selectedMmsi && !this.state.contacts.some(c => c.mmsi === this.selectedMmsi)) {
            this.selectedMmsi = this.state.contacts.length > 0 ? this.state.contacts[0].mmsi : null;
        }
    }

    renderAll() {
        if (!this.state) return;
        this.renderOwnShipTape();
        this.renderEncounterTable();
        this.renderSelectedTargetInspector();
        this.renderAutonomousRecommendation();
        this.updateNmeaTerminal();
    }

    updateNmeaTerminal() {
        const streamBox = document.getElementById("nmea-full-terminal");
        if (!streamBox || !this.state) return;

        const newLines = ColregsMath.generateNmeaSentences(this.state.own_ship, this.state.contacts);
        newLines.forEach(line => {
            const div = document.createElement("div");
            let cls = "nmea-log-line";
            if (line.startsWith("$GPRMC")) cls += " rmc";
            if (line.startsWith("!AIVDM")) cls += " aivdm";
            if (line.startsWith("$HEHDT")) cls += " hdt";
            div.className = cls;
            div.textContent = line;
            streamBox.appendChild(div);
        });

        while (streamBox.children.length > 20) {
            streamBox.removeChild(streamBox.firstChild);
        }
    }

    renderOwnShipTape() {
        const own = this.state.own_ship;
        const hdgEl = document.getElementById("tape-hdg");
        const sogEl = document.getElementById("tape-sog");
        const posEl = document.getElementById("tape-pos");
        const simBtn = document.getElementById("btn-sim-toggle");

        if (hdgEl) hdgEl.textContent = `${own.heading.toFixed(1)}°T`;
        if (sogEl) sogEl.textContent = `${own.sog.toFixed(1)} kts`;

        if (posEl) {
            const latDeg = Math.floor(own.lat);
            const latMin = ((own.lat - latDeg) * 60.0).toFixed(2);
            const lonDeg = Math.floor(own.lon);
            const lonMin = ((own.lon - lonDeg) * 60.0).toFixed(2);
            posEl.textContent = `${latDeg}°${latMin}'N ${lonDeg}°${lonMin}'E`;
        }

        if (simBtn) {
            simBtn.textContent = this.state.simulation.running ? "⏸ Pause" : "▶ Resume";
            simBtn.classList.toggle("active", !this.state.simulation.running);
        }
    }

    renderEncounterTable() {
        const tbody = document.getElementById("encounter-tbody");
        if (!tbody) return;

        tbody.innerHTML = "";

        if (this.state.contacts.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-dim); padding: 24px;">No active AIS targets in range</td></tr>`;
            return;
        }

        const sortedContacts = [...this.state.contacts].sort((a, b) => {
            const encA = this.encounterMap[a.mmsi];
            const encB = this.encounterMap[b.mmsi];
            if (!encA || !encB) return 0;
            return encA.tcpaMin - encB.tcpaMin;
        });

        sortedContacts.forEach(c => {
            const enc = this.encounterMap[c.mmsi];
            if (!enc) return;

            const tr = document.createElement("tr");
            tr.className = `arpa-row ${enc.severity === 'CRITICAL' ? 'critical-threat' : ''} ${this.selectedMmsi === c.mmsi ? 'selected' : ''}`;

            const tagClass = enc.role.includes("GIVE-WAY") ? "badge-giveway" : (enc.role.includes("STAND-ON") ? "badge-standon" : "badge-clear");
            const cpaColor = enc.cpaNm < 2.0 && !enc.isDiverging ? "var(--accent-crimson)" : "var(--text-main)";

            tr.innerHTML = `
                <td>
                    <div class="vessel-name">${c.name}</div>
                    <div class="vessel-mmsi">${c.mmsi}</div>
                </td>
                <td>
                    <span class="metric-mono">${enc.brgTrue}°</span>
                    <span style="color: var(--text-dim); font-size: 0.65rem;"> / </span>
                    <span class="metric-mono">${enc.rangeNm} NM</span>
                </td>
                <td>
                    <span class="metric-mono" style="color: ${cpaColor}; font-weight: 600;">${enc.cpaNm} NM</span>
                    <br>
                    <span style="font-size: 0.65rem; color: var(--text-dim);">
                        ${enc.isDiverging ? 'Diverging' : enc.tcpaMin + ' min'}
                    </span>
                </td>
                <td>
                    <span style="font-weight: 600; color: var(--accent-cyan); font-size: 0.72rem;">${enc.rule}</span>
                </td>
                <td>
                    <span class="role-badge ${tagClass}">${enc.role}</span>
                </td>
            `;

            tr.addEventListener("click", () => {
                this.selectedMmsi = c.mmsi;
                this.radar.selectedMmsi = c.mmsi;
                this.audio.targetLock();
                this.renderAll();
            });

            tbody.appendChild(tr);
        });
    }

    renderSelectedTargetInspector() {
        const inspector = document.getElementById("target-inspector-body");
        if (!inspector) return;

        if (!this.selectedMmsi) {
            inspector.innerHTML = `<div style="text-align: center; color: var(--text-dim); padding: 12px; font-size: 0.74rem;">Click any target on radar or in matrix to inspect kinematics.</div>`;
            return;
        }

        const contact = this.state.contacts.find(c => c.mmsi === this.selectedMmsi);
        const enc = this.encounterMap[this.selectedMmsi];

        if (!contact || !enc) {
            this.selectedMmsi = null;
            return;
        }

        inspector.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
                <span style="font-weight: 700; font-size: 0.88rem; color: #fff;">${contact.name}</span>
                <span style="font-size: 0.68rem; color: var(--accent-cyan); font-weight: 500;">${contact.type}</span>
            </div>

            <div class="inspector-grid">
                <div class="inspector-field">
                    <span class="field-label">Target Aspect</span>
                    <span class="field-value">${enc.aspectAngle}° (Relative)</span>
                </div>
                <div class="inspector-field">
                    <span class="field-label">Target SOG / COG</span>
                    <span class="field-value">${contact.sog} kts @ ${contact.cog}°T</span>
                </div>
                <div class="inspector-field">
                    <span class="field-label">Visible Sidelight</span>
                    <span class="field-value" style="color: ${enc.sidelightColor};">● ${enc.visibleSidelight}</span>
                </div>
                <div class="inspector-field">
                    <span class="field-label">Bow Crossing Range</span>
                    <span class="field-value" style="color: var(--accent-cyan);">${enc.bcrNm}</span>
                </div>
            </div>

            <div style="background: rgba(255,255,255,0.03); border-left: 3px solid var(--accent-cyan); padding: 8px 10px; margin: 8px 0; border-radius: 4px;">
                <div style="font-weight: 700; font-size: 0.75rem; color: var(--accent-cyan); margin-bottom: 2px;">
                    ${enc.ruleName}
                </div>
                <div style="font-size: 0.7rem; color: var(--text-muted); line-height: 1.35;">
                    ${enc.legalSummary}
                </div>
                <div style="margin-top: 5px; font-size: 0.72rem; color: #fda4af; font-weight: 600;">
                    Directive: ${enc.actionDirective}
                </div>
            </div>

            <button class="btn-clean" style="width: 100%; border-color: rgba(244, 63, 94, 0.4); color: #fda4af; justify-content: center; font-size: 0.72rem; padding: 4px;" onclick="window.app.deleteTarget('${contact.mmsi}')">
                Drop Target Track
            </button>
        `;
    }

    renderAutonomousRecommendation() {
        const container = document.getElementById("recommendation-container");
        if (!container) return;

        const solution = ColregsRulesEngine.solveOptimalManeuver(
            this.state.own_ship,
            this.state.contacts,
            this.state.safety_thresholds.cpa_limit_nm
        );

        if (!solution.isManeuverRequired) {
            container.innerHTML = `
                <div class="recommendation-box rec-safe">
                    <div class="rec-title">✓ Safe Passage Confirmed (Stand-On)</div>
                    <div class="rec-desc">${solution.reason}</div>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <div class="recommendation-box rec-danger">
                <div class="rec-title">⚠ Avoidance Maneuver Required</div>
                <div class="rec-desc">${solution.reason}</div>
                <div style="margin-top: 6px; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 0.75rem; font-weight: 700; color: var(--accent-cyan);">
                        ${solution.description} ➔ Course ${solution.recommendedCourse}°T
                    </span>
                    <button class="btn-clean active" style="padding: 3px 8px; font-size: 0.7rem;" onclick="window.app.applyOptimalCourse(${solution.recommendedCourse})">
                        Apply to Trial
                    </button>
                </div>
            </div>
        `;
    }

    renderTrialEvaluation(trialCog) {
        const evalBox = document.getElementById("trial-evaluation-box");
        if (!evalBox || !this.isTrialActive) {
            if (evalBox) evalBox.innerHTML = "";
            return;
        }

        let minTrialCpa = 999.0;
        let isSafeAcrossAll = true;

        this.state.contacts.forEach(c => {
            const trialEnc = ColregsMath.evaluateTrialManeuver(this.state.own_ship, c, trialCog);
            if (!trialEnc.isDiverging && trialEnc.tcpaMin > 0) {
                if (trialEnc.cpaNm < minTrialCpa) minTrialCpa = trialEnc.cpaNm;
                if (trialEnc.cpaNm < this.state.safety_thresholds.cpa_limit_nm) {
                    isSafeAcrossAll = false;
                }
            }
        });

        const badgeColor = isSafeAcrossAll ? "var(--accent-emerald)" : "var(--accent-crimson)";
        evalBox.innerHTML = `
            <div style="background: rgba(0,0,0,0.25); border: 1px solid var(--border-subtle); border-radius: 4px; padding: 6px 10px; font-size: 0.72rem;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span>Trial Course: <strong style="color: var(--accent-purple); font-family: var(--font-mono);">${trialCog.toFixed(1)}°T</strong></span>
                    <span style="color: ${badgeColor}; font-weight: 700;">
                        ${isSafeAcrossAll ? '✓ Safety Threshold Met' : '✗ Unsafe CPA (< 2.0 NM)'}
                    </span>
                </div>
                <div style="color: var(--text-dim); margin-top: 2px; font-size: 0.68rem;">
                    Projected minimum traffic CPA: <strong>${minTrialCpa.toFixed(2)} NM</strong>
                </div>
            </div>
        `;
    }

    applyOptimalCourse(cog) {
        const slider = document.getElementById("trial-course-slider");
        const valText = document.getElementById("trial-course-val");
        const diff = Math.round((cog - this.state.own_ship.cog + 360) % 360);
        const offset = diff > 180 ? diff - 360 : diff;

        if (slider) slider.value = offset;
        if (valText) valText.textContent = `${offset >= 0 ? '+' : ''}${offset}° (HDG ${cog.toFixed(1)}°)`;

        this.trialCourseOffset = offset;
        this.isTrialActive = true;
        this.radar.setTrialManeuver({ cog, sog: this.state.own_ship.sog });
        this.renderTrialEvaluation(cog);
    }

    async autoSolveManeuver() {
        const solution = ColregsRulesEngine.solveOptimalManeuver(
            this.state.own_ship,
            this.state.contacts,
            this.state.safety_thresholds.cpa_limit_nm
        );
        this.applyOptimalCourse(solution.recommendedCourse);
    }

    async executeTrialHelmOrder() {
        if (!this.isTrialActive) {
            alert("No trial maneuver selected. Adjust the trial course slider or click 'Auto-Solve' first.");
            return;
        }

        const newCog = (this.state.own_ship.cog + this.trialCourseOffset + 360) % 360;
        try {
            const res = await fetch("/api/ownship/helm", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ cog: newCog })
            });
            if (res.ok) {
                const slider = document.getElementById("trial-course-slider");
                const valText = document.getElementById("trial-course-val");
                if (slider) slider.value = 0;
                if (valText) valText.textContent = "+0° (HDG " + newCog.toFixed(1) + "°)";
                this.trialCourseOffset = 0;
                this.isTrialActive = false;
                this.radar.setTrialManeuver(null);
                await this.fetchState();
            }
        } catch (err) {
            console.error("Error executing helm order:", err);
        }
    }

    async deleteTarget(mmsi) {
        try {
            await fetch(`/api/contacts/${mmsi}`, { method: "DELETE" });
            this.selectedMmsi = null;
            await this.fetchState();
        } catch (err) {
            console.error("Error deleting target:", err);
        }
    }

    async submitNewTarget() {
        const name = document.getElementById("input-tgt-name").value;
        const type = document.getElementById("input-tgt-type").value;
        const brg = parseFloat(document.getElementById("input-tgt-brg").value);
        const range = parseFloat(document.getElementById("input-tgt-range").value);
        const cog = parseFloat(document.getElementById("input-tgt-cog").value);
        const sog = parseFloat(document.getElementById("input-tgt-sog").value);

        const own = this.state.own_ship;
        const radBrg = brg * DEG_TO_RAD;
        const deltaLat = (range * Math.cos(radBrg)) / 60.0;
        const deltaLon = (range * Math.sin(radBrg)) / (60.0 * Math.cos(own.lat * DEG_TO_RAD));

        const payload = {
            name: name || "M/V SEA TRADER",
            type: type || "General Cargo",
            lat: own.lat + deltaLat,
            lon: own.lon + deltaLon,
            cog,
            sog
        };

        try {
            await fetch("/api/contacts/add", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            await this.fetchState();
        } catch (err) {
            console.error("Error adding target:", err);
        }
    }

    exportVdrLog() {
        if (!this.state) return;
        const vdrPackage = {
            system: "NAVAID-COLREGS VDR Telemetry",
            exportTimeUTC: new Date().toISOString(),
            ownShip: this.state.own_ship,
            activeContacts: this.state.contacts,
            encounterKinematics: this.encounterMap,
            safetyThresholds: this.state.safety_thresholds,
            auditLog: this.state.vdr_log
        };

        const blob = new Blob([JSON.stringify(vdrPackage, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `VDR_COLREGS_AUDIT_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }
}

window.addEventListener("DOMContentLoaded", () => {
    window.app = new ColregsApp();
    window.app.init();
});
