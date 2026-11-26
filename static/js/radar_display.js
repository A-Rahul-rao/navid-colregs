/**
 * NAVAID-COLREGS : Ultra-Realistic Marine PPI Radar & Tactical ECDIS Display
 * Features: 360° rotating sweep beam, phosphor persistence decay, IEC 62288 symbology,
 * collision cones, and sub-pixel high-DPI canvas rendering.
 */

class RadarDisplay {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext("2d");
        this.rangeScaleNm = 8.0;
        this.orientationMode = "HEAD_UP";
        this.vectorMode = "TRUE";
        this.vectorTimeMin = 12.0;
        this.selectedMmsi = null;
        this.trialManeuver = null;

        // Radar beam sweep animation state
        this.sweepAngle = 0.0;
        this.lastFrameTime = performance.now();
        this.sweepRpm = 24.0; // Standard marine radar rotation rate (24 RPM)

        // Target phosphor decay tracking
        this.targetHits = {};

        this.initEventListeners();
        this.startRenderLoop();
    }

    initEventListeners() {
        window.addEventListener("resize", () => this.resize());
        this.resize();

        this.canvas.addEventListener("click", (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const clickY = e.clientY - rect.top;
            this.handleCanvasClick(clickX, clickY);
        });
    }

    resize() {
        const parent = this.canvas.parentElement;
        if (!parent) return;
        const dpr = window.devicePixelRatio || 1;
        const displaySize = Math.min(parent.clientWidth - 12, parent.clientHeight - 12, 780);

        this.canvas.style.width = `${displaySize}px`;
        this.canvas.style.height = `${displaySize}px`;
        this.canvas.width = Math.floor(displaySize * dpr);
        this.canvas.height = Math.floor(displaySize * dpr);
        this.ctx.scale(dpr, dpr);
    }

    setRangeScale(nm) {
        this.rangeScaleNm = parseFloat(nm);
    }

    setOrientation(mode) {
        this.orientationMode = mode;
    }

    setVectorMode(mode) {
        this.vectorMode = mode;
    }

    setTrialManeuver(trial) {
        this.trialManeuver = trial;
    }

    toScreenCoords(dx, dy, ownHeading) {
        const dpr = window.devicePixelRatio || 1;
        const w = this.canvas.width / dpr;
        const h = this.canvas.height / dpr;
        const cx = w / 2.0;
        const cy = h / 2.0;
        const maxRadius = cx - 32;
        const pixelsPerNm = maxRadius / this.rangeScaleNm;

        let screenDx = dx;
        let screenDy = dy;

        if (this.orientationMode === "HEAD_UP") {
            const angleRad = -ownHeading * DEG_TO_RAD;
            const cosA = Math.cos(angleRad);
            const sinA = Math.sin(angleRad);
            screenDx = dx * cosA - dy * sinA;
            screenDy = dx * sinA + dy * cosA;
        }

        const px = cx + (screenDx * pixelsPerNm);
        const py = cy - (screenDy * pixelsPerNm);

        return { px, py, pixelsPerNm, cx, cy, maxRadius };
    }

    startRenderLoop() {
        const loop = (timestamp) => {
            const dt = (timestamp - this.lastFrameTime) / 1000.0;
            this.lastFrameTime = timestamp;

            // Rotate sweep beam (360 degrees per revolution)
            const degreesPerSec = (this.sweepRpm * 360.0) / 60.0;
            this.sweepAngle = (this.sweepAngle + (degreesPerSec * dt)) % 360.0;

            if (window.app && window.app.state) {
                this.render(window.app.state.own_ship, window.app.state.contacts, window.app.encounterMap);
            }

            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    render(ownShip, contacts = [], encounterMap = {}) {
        if (!this.ctx || !ownShip) return;

        const dpr = window.devicePixelRatio || 1;
        const w = this.canvas.width / dpr;
        const h = this.canvas.height / dpr;
        const cx = w / 2.0;
        const cy = h / 2.0;
        const maxRadius = cx - 32;
        const pixelsPerNm = maxRadius / this.rangeScaleNm;

        this.ctx.clearRect(0, 0, w, h);

        // 1. Radar PPI Scope Dark Void Background
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, maxRadius, 0, Math.PI * 2);
        this.ctx.fillStyle = "#040810";
        this.ctx.fill();

        // Subtle radar noise / phosphor texture
        this.ctx.lineWidth = 1;
        this.ctx.strokeStyle = "rgba(0, 240, 255, 0.15)";
        this.ctx.stroke();

        // 2. Azimuth Compass Rose (Fine graduation marks)
        this.renderCompassRose(cx, cy, maxRadius, ownShip.heading || ownShip.cog);

        // 3. Range Rings & Milliradian Coordinate Crosshairs
        this.renderRangeRings(cx, cy, maxRadius);

        // 4. Rotating Radar Sweep Beam with Phosphor Trail
        this.renderRadarSweep(cx, cy, maxRadius);

        // 5. Safety Clearance Domain (Goodwin/BAM Ellipse)
        const domainRadiusNm = ownShip.domain_radius_nm || 1.5;
        const domainRadiusPx = domainRadiusNm * pixelsPerNm;
        this.ctx.beginPath();
        this.ctx.ellipse(cx, cy, domainRadiusPx * 0.75, domainRadiusPx * 1.35, 0, 0, Math.PI * 2);
        this.ctx.strokeStyle = "rgba(0, 240, 255, 0.22)";
        this.ctx.setLineDash([4, 4]);
        this.ctx.stroke();
        this.ctx.setLineDash([]);

        // 6. AIS & Radar Targets
        contacts.forEach(c => {
            const enc = encounterMap[c.mmsi];
            if (!enc) return;

            const { px, py } = this.toScreenCoords(enc.dx, enc.dy, ownShip.heading || ownShip.cog);
            const distFromCenter = Math.hypot(px - cx, py - cy);
            if (distFromCenter > maxRadius + 18) return;

            // Update phosphor hit state
            const targetAngle = (Math.atan2(px - cx, -(py - cy)) * RAD_TO_DEG + 360) % 360;
            const angleDiff = Math.abs((this.sweepAngle - targetAngle + 360) % 360);
            if (angleDiff < 8) {
                this.targetHits[c.mmsi] = performance.now();
            }

            this.renderContactSymbol(c, enc, px, py, pixelsPerNm, ownShip, cx, cy);
        });

        // 7. Trial Maneuver Preview Vector
        if (this.trialManeuver) {
            this.renderTrialVector(ownShip, cx, cy, pixelsPerNm);
        }

        // 8. Own Ship Symbol at Exact Center
        this.renderOwnShipSymbol(ownShip, cx, cy, pixelsPerNm);

        // 9. Technical Scale Bar & HUD Watermark
        this.renderHudWatermark(cx, cy, maxRadius, ownShip);

        this.ctx.restore();
    }

    renderRadarSweep(cx, cy, r) {
        this.ctx.save();
        const sweepRad = (this.sweepAngle - 90) * DEG_TO_RAD;

        // Phosphor Afterglow Wedge (trailing 40 degrees)
        const trailAngle = 38 * DEG_TO_RAD;
        const grad = this.ctx.createConicalGradient
            ? null
            : null;

        // Draw multiple faint lines to simulate smooth phosphor trailing wedge
        const steps = 18;
        for (let i = 0; i < steps; i++) {
            const alpha = (1 - (i / steps)) * 0.12;
            const currentAngle = sweepRad - (i * (trailAngle / steps));
            this.ctx.beginPath();
            this.ctx.moveTo(cx, cy);
            this.ctx.arc(cx, cy, r - 2, currentAngle - (trailAngle / steps), currentAngle);
            this.ctx.closePath();
            this.ctx.fillStyle = `rgba(0, 255, 136, ${alpha})`;
            this.ctx.fill();
        }

        // Sharp leading edge beam
        this.ctx.beginPath();
        this.ctx.moveTo(cx, cy);
        this.ctx.lineTo(cx + (r * Math.cos(sweepRad)), cy + (r * Math.sin(sweepRad)));
        this.ctx.strokeStyle = "rgba(0, 255, 180, 0.75)";
        this.ctx.lineWidth = 1.5;
        this.ctx.shadowColor = "#00ff88";
        this.ctx.shadowBlur = 8;
        this.ctx.stroke();

        this.ctx.restore();
    }

    renderCompassRose(cx, cy, r, ownHeading) {
        this.ctx.save();
        this.ctx.font = "9px 'Consolas', monospace";
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";

        for (let deg = 0; deg < 360; deg += 5) {
            let drawAngle = deg;
            if (this.orientationMode === "HEAD_UP") {
                drawAngle = (deg - ownHeading + 360) % 360;
            }

            const rad = (drawAngle - 90) * DEG_TO_RAD;
            const isMajor = (deg % 30 === 0);
            const isMedium = (deg % 10 === 0);
            const tickLen = isMajor ? 10 : (isMedium ? 6 : 3);

            const x1 = cx + (r * Math.cos(rad));
            const y1 = cy + (r * Math.sin(rad));
            const x2 = cx + ((r - tickLen) * Math.cos(rad));
            const y2 = cy + ((r - tickLen) * Math.sin(rad));

            this.ctx.beginPath();
            this.ctx.moveTo(x1, y1);
            this.ctx.lineTo(x2, y2);
            this.ctx.strokeStyle = isMajor ? "#00f0ff" : (isMedium ? "rgba(0, 240, 255, 0.45)" : "rgba(30, 58, 95, 0.5)");
            this.ctx.lineWidth = isMajor ? 1.5 : 1;
            this.ctx.stroke();

            if (isMajor) {
                const textX = cx + ((r + 14) * Math.cos(rad));
                const textY = cy + ((r + 14) * Math.sin(rad));
                this.ctx.fillStyle = "#94a3b8";
                this.ctx.fillText(`${deg.toString().padStart(3, '0')}°`, textX, textY);
            }
        }
        this.ctx.restore();
    }

    renderRangeRings(cx, cy, maxRadius) {
        this.ctx.save();
        const numRings = 4;
        const ringStepNm = this.rangeScaleNm / numRings;

        this.ctx.font = "9px 'Consolas', monospace";
        this.ctx.fillStyle = "rgba(0, 240, 255, 0.45)";

        for (let i = 1; i <= numRings; i++) {
            const r = (maxRadius / numRings) * i;
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, r, 0, Math.PI * 2);
            this.ctx.strokeStyle = "rgba(0, 240, 255, 0.12)";
            this.ctx.lineWidth = 1;
            this.ctx.stroke();

            // Nautical distance notation
            const label = `${(ringStepNm * i).toFixed(1)} NM`;
            this.ctx.fillText(label, cx + 6, cy - r + 11);
        }

        // Crosshairs with fine milliradian index ticks
        this.ctx.beginPath();
        this.ctx.moveTo(cx, cy - maxRadius);
        this.ctx.lineTo(cx, cy + maxRadius);
        this.ctx.moveTo(cx - maxRadius, cy);
        this.ctx.lineTo(cx + maxRadius, cy);
        this.ctx.strokeStyle = "rgba(0, 240, 255, 0.15)";
        this.ctx.stroke();

        this.ctx.restore();
    }

    renderOwnShipSymbol(own, cx, cy, pixelsPerNm) {
        this.ctx.save();
        this.ctx.translate(cx, cy);

        if (this.orientationMode === "NORTH_UP") {
            this.ctx.rotate(own.heading * DEG_TO_RAD);
        }

        // High-precision vessel outline
        this.ctx.beginPath();
        this.ctx.moveTo(0, -16);  // Stem / Bow
        this.ctx.lineTo(7, 6);    // Stbd quarter
        this.ctx.lineTo(4, 11);   // Stbd transom
        this.ctx.lineTo(-4, 11);  // Port transom
        this.ctx.lineTo(-7, 6);   // Port quarter
        this.ctx.closePath();
        this.ctx.fillStyle = "#00f0ff";
        this.ctx.shadowColor = "#00f0ff";
        this.ctx.shadowBlur = 10;
        this.ctx.fill();
        this.ctx.strokeStyle = "#ffffff";
        this.ctx.lineWidth = 1.5;
        this.ctx.stroke();
        this.ctx.shadowBlur = 0;

        // Own ship speed vector
        const vectorLenNm = own.sog * (this.vectorTimeMin / 60.0);
        const vectorLenPx = vectorLenNm * pixelsPerNm;
        this.ctx.beginPath();
        this.ctx.moveTo(0, -16);
        this.ctx.lineTo(0, -16 - vectorLenPx);
        this.ctx.strokeStyle = "#00f0ff";
        this.ctx.lineWidth = 2;
        this.ctx.stroke();

        // Heading marker line extending to perimeter
        this.ctx.beginPath();
        this.ctx.moveTo(0, -16);
        this.ctx.lineTo(0, -cx + 32);
        this.ctx.strokeStyle = "rgba(0, 240, 255, 0.35)";
        this.ctx.setLineDash([3, 3]);
        this.ctx.stroke();

        this.ctx.restore();
    }

    renderContactSymbol(c, enc, px, py, pixelsPerNm, ownShip, cx, cy) {
        this.ctx.save();
        const isSelected = (this.selectedMmsi === c.mmsi);
        const isCritical = (enc.cpaNm < 2.0 && enc.tcpaMin > 0 && enc.tcpaMin < 15.0 && !enc.isDiverging);
        const isCaution = (enc.cpaNm < 3.0 && enc.tcpaMin > 0 && enc.tcpaMin < 25.0 && !enc.isDiverging);

        let color = "#00ff88"; // Phosphor emerald
        if (isCritical) {
            color = "#ff2a4b"; // Crimson hazard
        } else if (isCaution) {
            color = "#ffb800"; // Caution amber
        }

        // Phosphor decay flash effect
        const lastHit = this.targetHits[c.mmsi] || 0;
        const timeSinceHit = (performance.now() - lastHit) / 1000.0;
        const flashIntensity = Math.max(0, 1.0 - (timeSinceHit / 2.0));

        // 1. Render Collision Cone & CPA point for critical threats
        if (isCritical && enc.tcpaMin > 0) {
            const { px: cpaPx, py: cpaPy } = this.toScreenCoords(enc.cpaDx, enc.cpaDy, ownShip.heading || ownShip.cog);
            this.ctx.beginPath();
            this.ctx.arc(cpaPx, cpaPy, 6, 0, Math.PI * 2);
            this.ctx.strokeStyle = "rgba(255, 42, 75, 0.75)";
            this.ctx.lineWidth = 1.5;
            this.ctx.stroke();

            // Vector line connecting target to future CPA
            this.ctx.beginPath();
            this.ctx.moveTo(px, py);
            this.ctx.lineTo(cpaPx, cpaPy);
            this.ctx.strokeStyle = "rgba(255, 42, 75, 0.4)";
            this.ctx.setLineDash([2, 4]);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
        }

        this.ctx.translate(px, py);

        // 2. Target Symbol (IEC 62288)
        if (isCritical) {
            // Dangerous Target Triangle
            this.ctx.beginPath();
            this.ctx.moveTo(0, -11);
            this.ctx.lineTo(10, 8);
            this.ctx.lineTo(-10, 8);
            this.ctx.closePath();
            this.ctx.fillStyle = `rgba(255, 42, 75, ${0.25 + (flashIntensity * 0.4)})`;
            this.ctx.shadowColor = "#ff2a4b";
            this.ctx.shadowBlur = 10;
            this.ctx.fill();
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = 2;
            this.ctx.stroke();
            this.ctx.shadowBlur = 0;
        } else {
            // Standard AIS Target Diamond
            this.ctx.beginPath();
            this.ctx.moveTo(0, -9);
            this.ctx.lineTo(9, 0);
            this.ctx.lineTo(0, 9);
            this.ctx.lineTo(-9, 0);
            this.ctx.closePath();
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = 1.5;
            this.ctx.stroke();
        }

        if (isSelected) {
            this.ctx.beginPath();
            this.ctx.arc(0, 0, 18, 0, Math.PI * 2);
            this.ctx.strokeStyle = "#00f0ff";
            this.ctx.lineWidth = 1.5;
            this.ctx.setLineDash([4, 3]);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
        }

        // 3. Motion Vector (True or Relative)
        let vectorAngleRad = 0;
        let vectorLenPx = 0;

        if (this.vectorMode === "TRUE") {
            let headingDeg = c.cog;
            if (this.orientationMode === "HEAD_UP") {
                headingDeg = (c.cog - ownShip.heading + 360) % 360;
            }
            vectorAngleRad = (headingDeg - 90) * DEG_TO_RAD;
            const vectorLenNm = c.sog * (this.vectorTimeMin / 60.0);
            vectorLenPx = vectorLenNm * pixelsPerNm;
        } else {
            const relSpeed = Math.hypot(enc.vRelX, enc.vRelY);
            const vectorLenNm = relSpeed * (this.vectorTimeMin / 60.0);
            vectorLenPx = vectorLenNm * pixelsPerNm;
            let relDirDeg = Math.atan2(enc.vRelX, enc.vRelY) * RAD_TO_DEG;
            if (this.orientationMode === "HEAD_UP") {
                relDirDeg = (relDirDeg - ownShip.heading + 360) % 360;
            }
            vectorAngleRad = (relDirDeg - 90) * DEG_TO_RAD;
        }

        this.ctx.beginPath();
        this.ctx.moveTo(0, 0);
        this.ctx.lineTo(vectorLenPx * Math.cos(vectorAngleRad), vectorLenPx * Math.sin(vectorAngleRad));
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 1.5;
        this.ctx.stroke();

        // 4. Tactical Data Tag
        this.ctx.font = "10px 'Consolas', monospace";
        this.ctx.fillStyle = color;
        this.ctx.fillText(`${c.name || c.mmsi}`, 14, -4);
        this.ctx.font = "9px 'Consolas', monospace";
        this.ctx.fillStyle = "#94a3b8";
        this.ctx.fillText(`CPA ${enc.cpaNm}NM | ${enc.tcpaMin}m`, 14, 8);

        this.ctx.restore();
    }

    renderTrialVector(ownShip, cx, cy, pixelsPerNm) {
        this.ctx.save();
        this.ctx.translate(cx, cy);

        let headingDeg = this.trialManeuver.cog;
        if (this.orientationMode === "HEAD_UP") {
            headingDeg = (this.trialManeuver.cog - ownShip.heading + 360) % 360;
        }

        const rad = (headingDeg - 90) * DEG_TO_RAD;
        const vectorLenNm = this.trialManeuver.sog * (this.vectorTimeMin / 60.0);
        const vectorLenPx = vectorLenNm * pixelsPerNm;

        this.ctx.beginPath();
        this.ctx.moveTo(0, 0);
        this.ctx.lineTo(vectorLenPx * Math.cos(rad), vectorLenPx * Math.sin(rad));
        this.ctx.strokeStyle = "#c084fc"; // Cyber purple trial vector
        this.ctx.shadowColor = "#a855f7";
        this.ctx.shadowBlur = 8;
        this.ctx.lineWidth = 2.5;
        this.ctx.setLineDash([5, 3]);
        this.ctx.stroke();

        this.ctx.restore();
    }

    renderHudWatermark(cx, cy, maxRadius, ownShip) {
        this.ctx.save();
        this.ctx.font = "9px 'Consolas', monospace";
        this.ctx.fillStyle = "rgba(0, 240, 255, 0.4)";
        this.ctx.textAlign = "left";

        // Bottom left scale block
        this.ctx.fillText(`SCALE: ${this.rangeScaleNm} NM`, 16, this.canvas.height / (window.devicePixelRatio || 1) - 24);
        this.ctx.fillText(`MOTION: ${this.vectorMode} (${this.vectorTimeMin}m)`, 16, this.canvas.height / (window.devicePixelRatio || 1) - 12);

        // Bottom right technical integrity
        this.ctx.textAlign = "right";
        const rightX = (this.canvas.width / (window.devicePixelRatio || 1)) - 16;
        this.ctx.fillText(`PULSE: 0.08 µs / 3000 Hz`, rightX, this.canvas.height / (window.devicePixelRatio || 1) - 24);
        this.ctx.fillText(`ANTENNA: 24 RPM / S-BAND`, rightX, this.canvas.height / (window.devicePixelRatio || 1) - 12);

        this.ctx.restore();
    }

    handleCanvasClick(clickX, clickY) {
        if (!window.app || !window.app.state) return;
        const own = window.app.state.own_ship;
        const contacts = window.app.state.contacts;

        for (const c of contacts) {
            const enc = ColregsMath.calculateEncounter(own, c);
            const { px, py } = this.toScreenCoords(enc.dx, enc.dy, own.heading || own.cog);
            const dist = Math.hypot(clickX - px, clickY - py);
            if (dist < 22) {
                this.selectedMmsi = c.mmsi;
                if (window.app.onContactSelected) {
                    window.app.onContactSelected(c.mmsi);
                }
                return;
            }
        }
        this.selectedMmsi = null;
        if (window.app.onContactSelected) {
            window.app.onContactSelected(null);
        }
    }
}

window.RadarDisplay = RadarDisplay;
