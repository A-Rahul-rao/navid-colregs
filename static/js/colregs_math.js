/**
 * NAVAID-COLREGS : Geodetic & ARPA Vector Collision Mathematics
 * High-precision nautical kinematics, CPA/TCPA, BCR/BCT, and NMEA 0183 stream generation.
 */

const NM_PER_LAT_DEG = 60.0;
const DEG_TO_RAD = Math.PI / 180.0;
const RAD_TO_DEG = 180.0 / Math.PI;

class ColregsMath {
    static toLocalCartesian(ownLat, ownLon, targetLat, targetLon) {
        const meanLatRad = ((ownLat + targetLat) / 2.0) * DEG_TO_RAD;
        const dy = (targetLat - ownLat) * NM_PER_LAT_DEG;
        const dx = (targetLon - ownLon) * NM_PER_LAT_DEG * Math.cos(meanLatRad);
        return { dx, dy };
    }

    static trueBearing(dx, dy) {
        let angle = Math.atan2(dx, dy) * RAD_TO_DEG;
        if (angle < 0) angle += 360.0;
        return angle;
    }

    static relativeBearing(trueBrg, ownHeading) {
        let rel = (trueBrg - ownHeading) % 360.0;
        if (rel < 0) rel += 360.0;
        return rel;
    }

    static calculateEncounter(own, target) {
        const { dx, dy } = this.toLocalCartesian(own.lat, own.lon, target.lat, target.lon);
        const rangeNm = Math.hypot(dx, dy);
        const brgTrue = this.trueBearing(dx, dy);
        const brgRel = this.relativeBearing(brgTrue, own.heading || own.cog);

        // Velocity decomposition
        const vOwnX = own.sog * Math.sin(own.cog * DEG_TO_RAD);
        const vOwnY = own.sog * Math.cos(own.cog * DEG_TO_RAD);
        const vTgtX = target.sog * Math.sin(target.cog * DEG_TO_RAD);
        const vTgtY = target.sog * Math.cos(target.cog * DEG_TO_RAD);

        // Relative velocity vector
        const vRelX = vTgtX - vOwnX;
        const vRelY = vTgtY - vOwnY;
        const speedRel = Math.hypot(vRelX, vRelY);

        let cpaNm = rangeNm;
        let tcpaMin = 0.0;
        let cpaDx = dx;
        let cpaDy = dy;
        let isDiverging = false;

        if (speedRel > 0.05) {
            const dotProduct = (dx * vRelX) + (dy * vRelY);
            const tcpaHours = -dotProduct / (speedRel * speedRel);
            tcpaMin = tcpaHours * 60.0;

            if (tcpaHours > 0) {
                cpaDx = dx + (tcpaHours * vRelX);
                cpaDy = dy + (tcpaHours * vRelY);
                cpaNm = Math.hypot(cpaDx, cpaDy);
            } else {
                isDiverging = true;
                cpaNm = rangeNm;
            }
        }

        // Bow Crossing Range (BCR) & Bow Crossing Distance (BCD)
        let bcrNm = null;
        let bctMin = null;
        const ownHdgRad = (own.heading || own.cog) * DEG_TO_RAD;
        const hx = Math.sin(ownHdgRad);
        const hy = Math.cos(ownHdgRad);
        const denom = (vTgtX * hy) - (vTgtY * hx);
        if (Math.abs(denom) > 0.01) {
            const tBowHours = ((dy * hx) - (dx * hy)) / denom;
            if (tBowHours > 0 && tBowHours < 2.0) {
                bctMin = parseFloat((tBowHours * 60.0).toFixed(1));
                const intersectX = dx + (tBowHours * vTgtX);
                const intersectY = dy + (tBowHours * vTgtY);
                const ownDist = (own.sog * tBowHours);
                const crossDist = Math.hypot(intersectX, intersectY);
                bcrNm = parseFloat((crossDist - ownDist).toFixed(2));
            }
        }

        // Target Aspect Angle (0° to 360°)
        const brgFromTarget = (brgTrue + 180.0) % 360.0;
        let aspectAngle = (brgFromTarget - target.cog) % 360.0;
        if (aspectAngle < 0) aspectAngle += 360.0;

        let visibleSidelight = "STERN (WHITE 135°)";
        let sidelightColor = "#e2e8f0";
        if (aspectAngle > 0 && aspectAngle <= 112.5) {
            visibleSidelight = "STARBOARD (GREEN 112.5°)";
            sidelightColor = "#00ff88";
        } else if (aspectAngle >= 247.5 && aspectAngle < 360.0) {
            visibleSidelight = "PORT (RED 112.5°)";
            sidelightColor = "#ff2a4b";
        }

        return {
            dx,
            dy,
            rangeNm: parseFloat(rangeNm.toFixed(2)),
            brgTrue: parseFloat(brgTrue.toFixed(1)),
            brgRel: parseFloat(brgRel.toFixed(1)),
            vRelX,
            vRelY,
            speedRel: parseFloat(speedRel.toFixed(1)),
            cpaNm: parseFloat(cpaNm.toFixed(2)),
            tcpaMin: parseFloat(tcpaMin.toFixed(1)),
            cpaDx,
            cpaDy,
            bcrNm: bcrNm !== null ? (bcrNm > 0 ? `+${bcrNm} NM (Ahead)` : `${bcrNm} NM (Astern)`) : "N/A (Parallel)",
            bctMin: bctMin !== null ? `${bctMin} min` : "N/A",
            isDiverging,
            aspectAngle: parseFloat(aspectAngle.toFixed(1)),
            visibleSidelight,
            sidelightColor
        };
    }

    static evaluateTrialManeuver(own, target, trialCog, trialSog = null) {
        const testOwn = {
            ...own,
            cog: trialCog,
            sog: trialSog !== null ? trialSog : own.sog,
            heading: trialCog
        };
        return this.calculateEncounter(testOwn, target);
    }

    static generateNmeaSentences(own, contacts) {
        const sentences = [];
        const now = new Date();
        const hh = String(now.getUTCHours()).padStart(2, '0');
        const mm = String(now.getUTCMinutes()).padStart(2, '0');
        const ss = String(now.getUTCSeconds()).padStart(2, '0');
        const timeStr = `${hh}${mm}${ss}.00`;

        const latDeg = Math.floor(own.lat);
        const latMin = ((own.lat - latDeg) * 60.0).toFixed(4).padStart(7, '0');
        const lonDeg = Math.floor(own.lon);
        const lonMin = ((own.lon - lonDeg) * 60.0).toFixed(4).padStart(7, '0');
        const ddmmyy = "251126";
        const rmcBody = `GPRMC,${timeStr},A,${latDeg}${latMin},N,${lonDeg}${lonMin},E,${own.sog.toFixed(1)},${own.cog.toFixed(1)},${ddmmyy},,,A`;
        sentences.push(`$${rmcBody}*${this.nmeaChecksum(rmcBody)}`);

        const hdtBody = `HEHDT,${own.heading.toFixed(1)},T`;
        sentences.push(`$${hdtBody}*${this.nmeaChecksum(hdtBody)}`);

        if (contacts && contacts.length > 0) {
            const c = contacts[Math.floor(Math.random() * contacts.length)];
            const aivdmPayload = `15N8i4001jP<8>0H780Q0?v00800`;
            const aivdmBody = `AIVDM,1,1,,B,${aivdmPayload},0`;
            sentences.push(`!${aivdmBody}*${this.nmeaChecksum(aivdmBody)}`);
        }

        const dptBody = `SDDPT,34.2,0.0,100.0`;
        sentences.push(`$${dptBody}*${this.nmeaChecksum(dptBody)}`);

        return sentences;
    }

    static nmeaChecksum(str) {
        let chk = 0;
        for (let i = 0; i < str.length; i++) {
            chk ^= str.charCodeAt(i);
        }
        let hex = chk.toString(16).toUpperCase();
        return hex.length === 1 ? '0' + hex : hex;
    }
}

window.ColregsMath = ColregsMath;
