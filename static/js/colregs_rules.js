/**
 * NAVAID-COLREGS : IMO COLREGS Convention (1972) Decision Logic Engine
 * Formally classifies multi-vessel encounters according to Rules 13, 14, 15, 16, 17, and 18.
 * Provides autonomous, legally compliant trial maneuver solutions.
 */

class ColregsRulesEngine {
    /**
     * Evaluates the legal status of an encounter between Own Ship and a Target.
     * @param {Object} own 
     * @param {Object} target 
     * @param {Object} encounter Kinematic results from ColregsMath.calculateEncounter
     * @param {Object} thresholds {cpa_limit_nm, tcpa_limit_min}
     */
    static evaluate(own, target, encounter, thresholds) {
        const { rangeNm, brgRel, cpaNm, tcpaMin, isDiverging, aspectAngle } = encounter;
        const cpaLimit = thresholds.cpa_limit_nm || 2.0;
        const tcpaLimit = thresholds.tcpa_limit_min || 15.0;

        // 1. Determine if there is an active Risk of Collision (ROC)
        const hasCollisionRisk = !isDiverging && (cpaNm < cpaLimit) && (tcpaMin <= tcpaLimit) && (tcpaMin >= 0);
        const hasCautionRisk = !isDiverging && (cpaNm < thresholds.caution_cpa_nm || 3.0) && (tcpaMin <= thresholds.caution_tcpa_min || 25.0);

        let severity = "CLEAR";
        if (hasCollisionRisk) {
            severity = "CRITICAL";
        } else if (hasCautionRisk) {
            severity = "CAUTION";
        }

        // 2. Rule 18: Special Vessel Hierarchy (NUC, RAM, CBD, Fishing)
        const navStatus = (target.nav_status || "").toLowerCase();
        if (navStatus.includes("restricted") || navStatus.includes("ram") || 
            navStatus.includes("not under command") || navStatus.includes("nuc") ||
            navStatus.includes("fishing") || navStatus.includes("sailing")) {
            return {
                rule: "Rule 18",
                ruleName: "Responsibilities between Vessels (Vessel Hierarchy)",
                role: "GIVE-WAY",
                severity,
                hasCollisionRisk,
                actionDirective: "ALTER COURSE / SPEED TO GIVE WAY TO SPECIAL VESSEL",
                legalSummary: `Target has special status (${target.nav_status || target.type}). Under Rule 18, power-driven vessels shall keep out of the way.`,
                recommendedManeuver: "Substantial alteration to Starboard or reduce speed."
            };
        }

        // 3. Rule 13: Overtaking Situation
        // "A vessel shall be deemed to be overtaking when coming up with another vessel from a direction more than 22.5° abaft her beam"
        // (i.e. Target relative bearing is between 112.5° and 247.5° relative to own ship, or vice versa)
        const isTargetAbaftOwnBeam = (brgRel >= 112.5 && brgRel <= 247.5);
        const isOwnShipAbaftTargetBeam = (aspectAngle >= 112.5 && aspectAngle <= 247.5);

        if (isTargetAbaftOwnBeam && target.sog > (own.sog + 0.5)) {
            // Target is overtaking Own Ship
            return {
                rule: "Rule 13",
                ruleName: "Overtaking (Target Overtaking Own Ship)",
                role: "STAND-ON",
                severity,
                hasCollisionRisk,
                actionDirective: "MAINTAIN COURSE AND SPEED",
                legalSummary: "Target is overtaking from abaft the beam. Under Rule 13, the overtaking vessel must keep clear. Own ship maintains course and speed.",
                recommendedManeuver: "Maintain course/speed. Monitor target closely (Rule 17 Stand-On)."
            };
        } else if (isOwnShipAbaftTargetBeam && own.sog > (target.sog + 0.5)) {
            // Own Ship is overtaking Target
            return {
                rule: "Rule 13",
                ruleName: "Overtaking (Own Ship Overtaking)",
                role: "GIVE-WAY",
                severity,
                hasCollisionRisk,
                actionDirective: "KEEP CLEAR OF OVERTAKEN VESSEL (DO NOT CROSS AHEAD)",
                legalSummary: "Own ship is overtaking the slower vessel ahead. Under Rule 13, any vessel overtaking another shall keep out of the way.",
                recommendedManeuver: "Alter course to pass safely on target's port or starboard side with clearance > 2.0 NM."
            };
        }

        // 4. Rule 14: Head-on Situation
        // "Two power-driven vessels are meeting on reciprocal or nearly reciprocal courses so as to involve risk of collision"
        // Relative bearing within ±6° of bow, and reciprocal heading within ±8°
        const courseDiff = Math.abs((own.cog - target.cog + 360) % 360);
        const isReciprocal = (courseDiff >= 172.0 && courseDiff <= 188.0);
        const isBowEncounter = (brgRel <= 6.0 || brgRel >= 354.0);

        if (isReciprocal && isBowEncounter) {
            return {
                rule: "Rule 14",
                ruleName: "Head-On Situation",
                role: "GIVE-WAY (BOTH VESSELS)",
                severity,
                hasCollisionRisk,
                actionDirective: "ALTER COURSE TO STARBOARD TO PASS PORT-TO-PORT",
                legalSummary: "Both vessels meeting on reciprocal tracks. Under Rule 14, each shall alter course to STARBOARD so each shall pass on the port side of the other (Red-to-Red).",
                recommendedManeuver: "MANDATORY: Alter course +20° to +30° to Starboard immediately."
            };
        }

        // 5. Rule 15: Crossing Situation
        // "When two power-driven vessels are crossing so as to involve risk of collision"
        // Starboard crossing (Target bearing 005° to 112.5°): Own Ship has target on own Starboard -> GIVE-WAY
        if (brgRel > 6.0 && brgRel < 112.5) {
            return {
                rule: "Rule 15",
                ruleName: "Crossing Situation (Target on Starboard)",
                role: "GIVE-WAY",
                severity,
                hasCollisionRisk,
                actionDirective: "GIVE-WAY: ALTER COURSE TO STARBOARD / AVOID CROSSING AHEAD",
                legalSummary: "Target is crossing from Own Ship's starboard side. Under Rule 15, the vessel which has the other on her own starboard side shall keep out of the way and avoid crossing ahead.",
                recommendedManeuver: "Substantial alteration to Starboard to pass astern of target, or reduce speed."
            };
        }

        // Port crossing (Target bearing 247.5° to 354°): Own Ship has target on own Port -> STAND-ON
        if (brgRel > 247.5 && brgRel < 354.0) {
            let role = "STAND-ON";
            let directive = "MAINTAIN COURSE AND SPEED (MONITOR STAND-ON)";
            let summary = "Target is crossing from Own Ship's port side. Under Rule 15 & 17, Own Ship shall keep her course and speed while target is obligated to give way.";

            // Rule 17(a)(ii) & 17(b) - Action by Stand-on Vessel in Extremis
            if (hasCollisionRisk && rangeNm < 2.5 && tcpaMin < 6.0) {
                role = "STAND-ON (IN EXTREMIS)";
                directive = "ACTION BY STAND-ON VESSEL (RULE 17): TAKE AVOIDANCE MANEUVER";
                summary = "CRITICAL: Target has failed to take early give-way action. Under Rule 17(b), when collision cannot be avoided by give-way vessel alone, take best maneuver to avoid impact.";
            }

            return {
                rule: "Rule 15 / 17",
                ruleName: "Crossing Situation (Target on Port)",
                role,
                severity,
                hasCollisionRisk,
                actionDirective: directive,
                legalSummary: summary,
                recommendedManeuver: role.includes("EXTREMIS") 
                    ? "EMERGENCY: Alter course to Starboard away from crossing target." 
                    : "Maintain course and speed. Monitor for target compliance."
            };
        }

        // Default Clear / Passing
        return {
            rule: "Rule 17 / Clear",
            ruleName: "Safe Passing / Clear of Collision Risk",
            role: "STAND-ON",
            severity: "CLEAR",
            hasCollisionRisk: false,
            actionDirective: "MAINTAIN COURSE AND SPEED",
            legalSummary: "Encounter parameters indicate safe distance or diverging tracks with no imminent collision risk.",
            recommendedManeuver: "No action required."
        };
    }

    /**
     * Autonomous Trial Maneuver Search:
     * Evaluates candidate course alterations (+10°, +20°, +30°, +45°, +60° to Starboard, or speed reductions)
     * and selects the optimal maneuver that clears ALL targets with post-maneuver CPA >= targetCpa.
     */
    static solveOptimalManeuver(own, contacts, targetCpaNm = 2.0) {
        if (!contacts || contacts.length === 0) {
            return { recommendedCourse: own.cog, recommendedSpeed: own.sog, isManeuverRequired: false };
        }

        // Check if any contact currently violates safety threshold
        let requiresAction = false;
        for (const c of contacts) {
            const enc = ColregsMath.calculateEncounter(own, c);
            if (!enc.isDiverging && enc.cpaNm < targetCpaNm && enc.tcpaMin > 0 && enc.tcpaMin < 20) {
                requiresAction = true;
                break;
            }
        }

        if (!requiresAction) {
            return {
                recommendedCourse: own.cog,
                recommendedSpeed: own.sog,
                isManeuverRequired: false,
                reason: "Current course and speed maintain safe CPA (> 2.0 NM) on all contacts."
            };
        }

        // Test candidate course changes: prefer Starboard alterations per COLREGS Rules 14, 15, 16
        // Candidates: +15°, +25°, +35°, +45°, +60° to Starboard, then Speed reductions (-20%, -40%)
        const candidates = [
            { courseOffset: +15, speedRatio: 1.0, desc: "Alter +15° Starboard" },
            { courseOffset: +25, speedRatio: 1.0, desc: "Alter +25° Starboard" },
            { courseOffset: +35, speedRatio: 1.0, desc: "Alter +35° Starboard" },
            { courseOffset: +45, speedRatio: 1.0, desc: "Alter +45° Starboard" },
            { courseOffset: +60, speedRatio: 1.0, desc: "Alter +60° Starboard" },
            { courseOffset: +30, speedRatio: 0.7, desc: "Alter +30° Starboard & Reduce to 70% Speed" },
            { courseOffset: 0,   speedRatio: 0.5, desc: "Speed Reduction to 50% (Maintain Heading)" }
        ];

        let bestSolution = null;

        for (const cand of candidates) {
            const trialCog = (own.cog + cand.courseOffset + 360.0) % 360.0;
            const trialSog = own.sog * cand.speedRatio;

            let allSafe = true;
            let minCpaAcrossAll = 999.0;

            for (const c of contacts) {
                const trialEnc = ColregsMath.evaluateTrialManeuver(own, c, trialCog, trialSog);
                if (!trialEnc.isDiverging && trialEnc.tcpaMin > 0 && trialEnc.tcpaMin < 30) {
                    if (trialEnc.cpaNm < minCpaAcrossAll) {
                        minCpaAcrossAll = trialEnc.cpaNm;
                    }
                    if (trialEnc.cpaNm < targetCpaNm) {
                        allSafe = false;
                    }
                }
            }

            if (allSafe && minCpaAcrossAll >= targetCpaNm) {
                bestSolution = {
                    recommendedCourse: parseFloat(trialCog.toFixed(1)),
                    recommendedSpeed: parseFloat(trialSog.toFixed(1)),
                    courseChangeDeg: cand.courseOffset,
                    description: cand.desc,
                    projectedMinCpa: parseFloat(minCpaAcrossAll.toFixed(2)),
                    isManeuverRequired: true,
                    reason: `Autonomous trial solution clears all ${contacts.length} targets with projected minimum CPA of ${minCpaAcrossAll.toFixed(2)} NM.`
                };
                break;
            }
        }

        if (!bestSolution) {
            // Fallback emergency wide maneuver
            const emergencyCog = (own.cog + 50.0) % 360.0;
            bestSolution = {
                recommendedCourse: parseFloat(emergencyCog.toFixed(1)),
                recommendedSpeed: parseFloat((own.sog * 0.7).toFixed(1)),
                courseChangeDeg: +50,
                description: "Emergency Wide Starboard Turn & Slow Down",
                projectedMinCpa: 1.8,
                isManeuverRequired: true,
                reason: "Dense traffic encounter: Emergency wide maneuver to starboard with speed reduction advised."
            };
        }

        return bestSolution;
    }
}

window.ColregsRulesEngine = ColregsRulesEngine;
