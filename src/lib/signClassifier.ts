// src/lib/signClassifier.ts
// High-Precision ASL Fingerprint Matrix — v4 with Global Disambiguation Guard

export interface Landmark {
    x: number;
    y: number;
    z: number;
  }
  
  function getDistance(p1: Landmark, p2: Landmark): number {
    return Math.sqrt(
      Math.pow(p1.x - p2.x, 2) +
      Math.pow(p1.y - p2.y, 2) +
      Math.pow(p1.z - p2.z, 2)
    );
  }
  
  function getAngle(p1: Landmark, p2: Landmark, p3: Landmark): number {
    const v1 = { x: p1.x - p2.x, y: p1.y - p2.y, z: p1.z - p2.z };
    const v2 = { x: p3.x - p2.x, y: p3.y - p2.y, z: p3.z - p2.z };
    const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
    const mag1 = Math.sqrt(v1.x ** 2 + v1.y ** 2 + v1.z ** 2);
    const mag2 = Math.sqrt(v2.x ** 2 + v2.y ** 2 + v2.z ** 2);
    if (mag1 === 0 || mag2 === 0) return 0;
    return Math.acos(Math.max(-1, Math.min(1, dot / (mag1 * mag2)))) * (180 / Math.PI);
  }
  
  interface FingerState {
    thumbExtended: boolean;
    indexExtended: boolean;
    middleExtended: boolean;
    ringExtended: boolean;
    pinkyExtended: boolean;
    thumbSpread: number;
    indexExtVal: number;
    middleExtVal: number;
    ringExtVal: number;
    pinkyExtVal: number;
    indexCurl: number;
    middleCurl: number;
    ringCurl: number;
    pinkyCurl: number;
    thumbIndexTip: number;
    indexMiddleTip: number;
    indexBendAngle: number;
    middleBendAngle: number;
    thumbTipY: number;
    indexTipY: number;
    wristY: number;
    handScale: number;
  }
  
  function extractFingerState(lm: Landmark[], isLeftHand: boolean): FingerState {
    const handScale = getDistance(lm[0], lm[9]);
  
    const indexExtVal = getDistance(lm[8], lm[5]) / handScale;
    const middleExtVal = getDistance(lm[12], lm[9]) / handScale;
    const ringExtVal = getDistance(lm[16], lm[13]) / handScale;
    const pinkyExtVal = getDistance(lm[20], lm[17]) / handScale;
  
    const indexCurl = getDistance(lm[8], lm[0]) / handScale;
    const middleCurl = getDistance(lm[12], lm[0]) / handScale;
    const ringCurl = getDistance(lm[16], lm[0]) / handScale;
    const pinkyCurl = getDistance(lm[20], lm[0]) / handScale;
  
    const thumbSpread = (isLeftHand
      ? lm[2].x - lm[4].x
      : lm[4].x - lm[2].x) / handScale;
  
    const thumbExtended = thumbSpread > 0.35 || lm[4].y < lm[2].y - 0.03;
  
    const thumbIndexTip = getDistance(lm[4], lm[8]) / handScale;
    const indexMiddleTip = getDistance(lm[8], lm[12]) / handScale;
    const indexBendAngle = getAngle(lm[5], lm[6], lm[7]);
    const middleBendAngle = getAngle(lm[9], lm[10], lm[11]);
  
    return {
      thumbExtended,
      indexExtended: indexExtVal > 0.68,
      middleExtended: middleExtVal > 0.68,
      ringExtended: ringExtVal > 0.68,
      pinkyExtended: pinkyExtVal > 0.68,
      thumbSpread,
      indexExtVal,
      middleExtVal,
      ringExtVal,
      pinkyExtVal,
      indexCurl,
      middleCurl,
      ringCurl,
      pinkyCurl,
      thumbIndexTip,
      indexMiddleTip,
      indexBendAngle,
      middleBendAngle,
      thumbTipY: lm[4].y,
      indexTipY: lm[8].y,
      wristY: lm[0].y,
      handScale,
    };
  }
  
  // ─── Per-sign scoring functions ───────────────────────────────────────────────
  
  function scoreASL_A(lm: Landmark[], fs: FingerState): { score: number; feedback: string } {
    // Fist. Thumb resting on the SIDE of index (not crossing front like S, not folded under like E).
    const allCurled = !fs.indexExtended && !fs.middleExtended && !fs.ringExtended && !fs.pinkyExtended;
    if (!allCurled) return { score: 20, feedback: "Curl all four fingers into a fist." };
  
    const thumbOnSide = fs.thumbSpread > 0.15 && fs.thumbSpread < 0.55;
    const thumbAboveMidKnuckle = lm[4].y < lm[10].y;
    // A: thumb must NOT cross in front of fingers (that's S)
    const thumbNotCrossingFront = !(lm[4].x > lm[5].x && lm[4].y < lm[11].y);
    // A: thumb should NOT be tucked below index knuckle (that's T)
    const thumbNotTucked = lm[4].y < lm[8].y;
  
    let score = 55;
    if (thumbOnSide) score += 20;
    if (thumbAboveMidKnuckle) score += 10;
    if (thumbNotCrossingFront) score += 10;
    if (thumbNotTucked) score += 5;
  
    return {
      score: Math.round(score),
      feedback: score >= 95
        ? "Perfect! Posture geometry matches target blueprint exactly."
        : !thumbOnSide
          ? "Bring thumb up alongside the index finger (don't cross in front)."
          : "Great fist! Ensure thumb rests beside, not over, your fingers."
    };
  }
  
  function scoreASL_B(lm: Landmark[], fs: FingerState): { score: number; feedback: string } {
    // All four fingers fully extended & close together. Thumb folded across palm.
    const fourExtended = fs.indexExtended && fs.middleExtended && fs.ringExtended && fs.pinkyExtended;
    if (!fourExtended) {
      const count = [fs.indexExtended, fs.middleExtended, fs.ringExtended, fs.pinkyExtended].filter(Boolean).length;
      return { score: count * 12, feedback: `Extend all four fingers straight up together (${count}/4 extended).` };
    }
  
    const allStronglyExtended = fs.indexExtVal > 0.75 && fs.middleExtVal > 0.75
      && fs.ringExtVal > 0.75 && fs.pinkyExtVal > 0.75;
  
    // CRITICAL: Thumb must be clearly folded in — not extended
    const thumbClearlyIn = !fs.thumbExtended && fs.thumbSpread < 0.25;
  
    let score = 45;
    if (allStronglyExtended) score += 30;
    if (thumbClearlyIn) score += 25;
  
    return {
      score: Math.round(score),
      feedback: score >= 95
        ? "Perfect! Posture geometry matches target blueprint exactly."
        : !thumbClearlyIn
          ? "Fold your thumb tightly across your palm — keep it tucked in."
          : "Great! Make sure all fingers are fully straight and together."
    };
  }
  
  function scoreASL_C(lm: Landmark[], fs: FingerState): { score: number; feedback: string } {
    const curved = (v: number) => v > 0.38 && v < 0.72;
    const notExtended = (v: number) => v < 0.72;
    const notCurled = (v: number) => v > 0.38;
  
    const indexCurved = curved(fs.indexExtVal);
    const middleCurved = curved(fs.middleExtVal);
    const ringCurved = curved(fs.ringExtVal);
    const pinkyCurved = curved(fs.pinkyExtVal);
    const fingersCurved = indexCurved && middleCurved && ringCurved && pinkyCurved;
  
    const thumbOut = fs.thumbSpread > 0.25;
    const notO = fs.thumbIndexTip > 0.35;
  
    let score = 0;
    if (fingersCurved) score += 50;
    else if (notExtended(fs.indexExtVal) && notCurled(fs.indexExtVal)) score += 20;
  
    if (thumbOut) score += 30;
    if (notO) score += 20;
  
    return {
      score: Math.round(score),
      feedback: score >= 95
        ? "Perfect! Posture geometry matches target blueprint exactly."
        : fingersCurved
          ? "Good curve! Spread thumb out and keep fingers from touching it."
          : "Curve all fingers into a soft 'C' — not fully open, not a fist."
    };
  }
  
  function scoreASL_D(lm: Landmark[], fs: FingerState): { score: number; feedback: string } {
    if (!fs.indexExtended) return { score: 15, feedback: "Point your index finger straight up." };
  
    const othersIn = !fs.middleExtended && !fs.ringExtended && !fs.pinkyExtended;
    const thumbToMiddle = getDistance(lm[4], lm[12]) / fs.handScale;
    const thumbToIndex = getDistance(lm[4], lm[8]) / fs.handScale;
  
    const thumbMakesCircle = thumbToMiddle < 0.45;
    const indexFree = thumbToIndex > 0.4;
  
    let score = 25;
    if (othersIn) score += 30;
    if (thumbMakesCircle) score += 30;
    if (indexFree) score += 15;
  
    return {
      score: Math.round(score),
      feedback: score >= 95
        ? "Perfect! Posture geometry matches target blueprint exactly."
        : !othersIn
          ? "Curl middle, ring, and pinky fingers down."
          : "Touch your thumb to your middle finger tip, leaving index pointing up."
    };
  }
  
  function scoreASL_E(lm: Landmark[], fs: FingerState): { score: number; feedback: string } {
    const indexHooked = fs.indexBendAngle < 125 && fs.indexExtVal < 0.65;
    const middleHooked = fs.middleBendAngle < 125 && fs.middleExtVal < 0.65;
    const allHooked = indexHooked && middleHooked && !fs.ringExtended && !fs.pinkyExtended;
  
    const thumbTucked = !fs.thumbExtended && fs.thumbSpread < 0.1 && lm[4].y > lm[5].y;
  
    let score = 0;
    if (allHooked) score += 60;
    else if (indexHooked && middleHooked) score += 35;
    if (thumbTucked) score += 40;
  
    return {
      score: Math.round(score),
      feedback: score >= 95
        ? "Perfect! Posture geometry matches target blueprint exactly."
        : !allHooked
          ? "Hook/curl all fingers at the second knuckle — like claw fingers."
          : "Tuck your thumb fully underneath your fingers."
    };
  }
  
  function scoreASL_F(lm: Landmark[], fs: FingerState): { score: number; feedback: string } {
    const thumbIndexTouch = fs.thumbIndexTip < 0.28;
    const othersExtended = fs.middleExtended && fs.ringExtended && fs.pinkyExtended;
  
    let score = 0;
    if (thumbIndexTouch) score += 50;
    if (othersExtended) score += 50;
  
    return {
      score: Math.round(score),
      feedback: score >= 95
        ? "Perfect! Posture geometry matches target blueprint exactly."
        : !thumbIndexTouch
          ? "Touch your index fingertip to your thumb tip to form a circle."
          : "Extend middle, ring, and pinky fingers upward."
    };
  }
  
  function scoreASL_G(lm: Landmark[], fs: FingerState): { score: number; feedback: string } {
    const indexOut = fs.indexExtended;
    const thumbOut = fs.thumbExtended;
    const othersIn = !fs.middleExtended && !fs.ringExtended && !fs.pinkyExtended;
    const indexHorizontal = Math.abs(lm[8].y - lm[5].y) < 0.12;
  
    let score = 0;
    if (indexOut) score += 25;
    if (thumbOut) score += 25;
    if (othersIn) score += 25;
    if (indexHorizontal) score += 25;
  
    return {
      score: Math.round(score),
      feedback: score >= 95
        ? "Perfect! Posture geometry matches target blueprint exactly."
        : "Point index finger sideways (horizontally), thumb parallel to it, curl others."
    };
  }
  
  function scoreASL_H(lm: Landmark[], fs: FingerState): { score: number; feedback: string } {
    const twoExtended = fs.indexExtended && fs.middleExtended;
    const othersIn = !fs.ringExtended && !fs.pinkyExtended && !fs.thumbExtended;
    const tipsClose = fs.indexMiddleTip < 0.28;
    const horizontal = Math.abs(lm[8].y - lm[5].y) < 0.15 || Math.abs(lm[12].y - lm[9].y) < 0.15;
  
    let score = 0;
    if (twoExtended) score += 35;
    if (othersIn) score += 25;
    if (tipsClose) score += 25;
    if (horizontal) score += 15;
  
    return {
      score: Math.round(score),
      feedback: score >= 95
        ? "Perfect! Posture geometry matches target blueprint exactly."
        : "Extend index and middle fingers together sideways (horizontal), curl others and thumb."
    };
  }
  
  function scoreASL_I(lm: Landmark[], fs: FingerState): { score: number; feedback: string } {
    const pinkyUp = fs.pinkyExtended;
    const othersAllIn = !fs.indexExtended && !fs.middleExtended && !fs.ringExtended && !fs.thumbExtended;
  
    let score = 0;
    if (pinkyUp) score += 55;
    if (othersAllIn) score += 45;
  
    return {
      score: Math.round(score),
      feedback: score >= 95
        ? "Perfect! Posture geometry matches target blueprint exactly."
        : !pinkyUp
          ? "Extend only your pinky finger upward."
          : "Curl all other fingers AND your thumb in."
    };
  }
  
  function scoreASL_K(lm: Landmark[], fs: FingerState): { score: number; feedback: string } {
    const indexUp = fs.indexExtended && lm[8].y < lm[5].y;
    const middleOut = fs.middleExtended;
    const thumbBetween = fs.thumbSpread > 0.2 && lm[4].y < lm[8].y;
    const othersIn = !fs.ringExtended && !fs.pinkyExtended;
  
    let score = 0;
    if (indexUp) score += 30;
    if (middleOut) score += 25;
    if (thumbBetween) score += 25;
    if (othersIn) score += 20;
  
    return {
      score: Math.round(score),
      feedback: score >= 95
        ? "Perfect! Posture geometry matches target blueprint exactly."
        : "Index up, middle finger angled out, thumb pointing between them."
    };
  }
  
  function scoreASL_L(lm: Landmark[], fs: FingerState): { score: number; feedback: string } {
    const indexUp = fs.indexExtended && lm[8].y < lm[5].y;
    const thumbOut = fs.thumbExtended && fs.thumbSpread > 0.3;
    const othersIn = !fs.middleExtended && !fs.ringExtended && !fs.pinkyExtended;
  
    let score = 0;
    if (indexUp) score += 35;
    if (thumbOut) score += 35;
    if (othersIn) score += 30;
  
    return {
      score: Math.round(score),
      feedback: score >= 95
        ? "Perfect! Posture geometry matches target blueprint exactly."
        : !indexUp
          ? "Point your index finger straight up."
          : !thumbOut
            ? "Extend thumb out sideways to form the L shape."
            : "Curl middle, ring, and pinky fingers down."
    };
  }
  
  function scoreASL_M(lm: Landmark[], fs: FingerState): { score: number; feedback: string } {
    const thumbUnder = lm[4].y > lm[6].y && lm[4].y > lm[10].y;
    const threeOver = !fs.indexExtended && !fs.middleExtended && !fs.ringExtended;
    const pinkyIn = !fs.pinkyExtended;
  
    let score = 0;
    if (thumbUnder) score += 35;
    if (threeOver) score += 40;
    if (pinkyIn) score += 25;
  
    return {
      score: Math.round(score),
      feedback: score >= 95
        ? "Perfect! Posture geometry matches target blueprint exactly."
        : "Fold index, middle, AND ring fingers over your tucked-in thumb. Pinky stays curled."
    };
  }
  
  function scoreASL_N(lm: Landmark[], fs: FingerState): { score: number; feedback: string } {
    const thumbUnder = lm[4].y > lm[6].y;
    const twoOver = !fs.indexExtended && !fs.middleExtended;
    const othersIn = !fs.ringExtended && !fs.pinkyExtended;
  
    let score = 0;
    if (thumbUnder) score += 35;
    if (twoOver) score += 40;
    if (othersIn) score += 25;
  
    return {
      score: Math.round(score),
      feedback: score >= 95
        ? "Perfect! Posture geometry matches target blueprint exactly."
        : "Fold index and middle fingers over your tucked thumb. Curl ring and pinky separately."
    };
  }
  
  function scoreASL_O(lm: Landmark[], fs: FingerState): { score: number; feedback: string } {
    const thumbToIndex = getDistance(lm[4], lm[8]) / fs.handScale;
    const thumbToMiddle = getDistance(lm[4], lm[12]) / fs.handScale;
    const allCurved = !fs.indexExtended && !fs.middleExtended && !fs.ringExtended && !fs.pinkyExtended;
    const tightO = thumbToIndex < 0.42 && thumbToMiddle < 0.5;
  
    let score = 0;
    if (allCurved) score += 45;
    if (tightO) score += 55;
  
    return {
      score: Math.round(score),
      feedback: score >= 95
        ? "Perfect! Posture geometry matches target blueprint exactly."
        : !allCurved
          ? "Curve all fingers inward toward your palm."
          : "Bring all fingertips to meet your thumb — form a tight O circle."
    };
  }
  
  function scoreASL_R(lm: Landmark[], fs: FingerState): { score: number; feedback: string } {
    const twoExtended = fs.indexExtended && fs.middleExtended;
    const crossedClose = fs.indexMiddleTip < 0.22;
    const othersIn = !fs.ringExtended && !fs.pinkyExtended;
    const thumbIn = !fs.thumbExtended;
  
    let score = 0;
    if (twoExtended) score += 35;
    if (crossedClose) score += 35;
    if (othersIn) score += 20;
    if (thumbIn) score += 10;
  
    return {
      score: Math.round(score),
      feedback: score >= 95
        ? "Perfect! Posture geometry matches target blueprint exactly."
        : !twoExtended
          ? "Extend index and middle fingers."
          : !crossedClose
            ? "Cross your index and middle fingers tightly over each other."
            : "Curl ring, pinky, and thumb in."
    };
  }
  
  function scoreASL_S(lm: Landmark[], fs: FingerState): { score: number; feedback: string } {
    // Closed fist. Thumb crosses OVER the front of fingers (not on the side like A).
    const allCurled = !fs.indexExtended && !fs.middleExtended && !fs.ringExtended && !fs.pinkyExtended;
    if (!allCurled) return { score: 20, feedback: "Curl all fingers into a tight fist." };
  
    const thumbCrossesFront = lm[4].x > lm[5].x && lm[4].y < lm[11].y;
    const thumbOverFingers = getDistance(lm[4], lm[7]) / fs.handScale < 0.35;
  
    let score = 55;
    if (thumbCrossesFront) score += 25;
    if (thumbOverFingers) score += 15;
    // Penalty if thumb is clearly on the SIDE (that's A, not S)
    if (fs.thumbSpread > 0.4) score -= 20;
  
    return {
      score: Math.round(Math.max(0, score)),
      feedback: score >= 95
        ? "Perfect! Posture geometry matches target blueprint exactly."
        : "Wrap your thumb across the FRONT of your curled fingers (not the side)."
    };
  }
  
  function scoreASL_T(lm: Landmark[], fs: FingerState): { score: number; feedback: string } {
    const allCurled = !fs.indexExtended && !fs.middleExtended && !fs.ringExtended && !fs.pinkyExtended;
    const thumbBetweenFingers = lm[4].y < lm[8].y && lm[4].y > lm[5].y;
    const thumbNotOnSide = fs.thumbSpread < 0.3;
  
    let score = 0;
    if (allCurled) score += 45;
    if (thumbBetweenFingers) score += 35;
    if (thumbNotOnSide) score += 20;
  
    return {
      score: Math.round(score),
      feedback: score >= 95
        ? "Perfect! Posture geometry matches target blueprint exactly."
        : !allCurled
          ? "Close all fingers into a fist."
          : "Tuck your thumb UP between your index and middle fingers."
    };
  }
  
  function scoreASL_U(lm: Landmark[], fs: FingerState): { score: number; feedback: string } {
    const twoUp = fs.indexExtended && fs.middleExtended;
    const othersIn = !fs.ringExtended && !fs.pinkyExtended && !fs.thumbExtended;
    const together = fs.indexMiddleTip < 0.28;
  
    let score = 0;
    if (twoUp) score += 40;
    if (othersIn) score += 30;
    if (together) score += 30;
  
    return {
      score: Math.round(score),
      feedback: score >= 95
        ? "Perfect! Posture geometry matches target blueprint exactly."
        : !twoUp
          ? "Extend index and middle fingers straight up together."
          : !together
            ? "Keep index and middle fingers close together (not spread apart)."
            : "Curl ring, pinky, and thumb in."
    };
  }
  
  function scoreASL_V(lm: Landmark[], fs: FingerState): { score: number; feedback: string } {
    const twoExtended = fs.indexExtended && fs.middleExtended;
    const spread = fs.indexMiddleTip > 0.28;
    const othersIn = !fs.ringExtended && !fs.pinkyExtended;
  
    let score = 0;
    if (twoExtended) score += 40;
    if (spread) score += 35;
    if (othersIn) score += 25;
  
    return {
      score: Math.round(score),
      feedback: score >= 95
        ? "Perfect! Posture geometry matches target blueprint exactly."
        : !twoExtended
          ? "Extend index and middle fingers upward."
          : !spread
            ? "Spread your index and middle fingers apart into a V shape."
            : "Curl ring, pinky, and thumb in."
    };
  }
  
  function scoreASL_W(lm: Landmark[], fs: FingerState): { score: number; feedback: string } {
    const threeUp = fs.indexExtended && fs.middleExtended && fs.ringExtended;
    const pinkyIn = !fs.pinkyExtended;
    const thumbIn = !fs.thumbExtended;
  
    let score = 0;
    if (threeUp) score += 55;
    if (pinkyIn) score += 25;
    if (thumbIn) score += 20;
  
    return {
      score: Math.round(score),
      feedback: score >= 95
        ? "Perfect! Posture geometry matches target blueprint exactly."
        : !threeUp
          ? "Extend index, middle, and ring fingers spread out like a W."
          : "Curl your pinky and thumb in."
    };
  }
  
  function scoreASL_X(lm: Landmark[], fs: FingerState): { score: number; feedback: string } {
    const indexHooked = fs.indexBendAngle < 145 && fs.indexExtVal < 0.65 && fs.indexExtVal > 0.3;
    const othersIn = !fs.middleExtended && !fs.ringExtended && !fs.pinkyExtended;
    const thumbIn = !fs.thumbExtended;
  
    let score = 0;
    if (indexHooked) score += 60;
    if (othersIn) score += 25;
    if (thumbIn) score += 15;
  
    return {
      score: Math.round(score),
      feedback: score >= 95
        ? "Perfect! Posture geometry matches target blueprint exactly."
        : !indexHooked
          ? "Hook/bend only your index finger like a claw or hook shape."
          : "Curl all other fingers and thumb in."
    };
  }
  
  function scoreASL_Y(lm: Landmark[], fs: FingerState): { score: number; feedback: string } {
    const thumbOut = fs.thumbExtended;
    const pinkyOut = fs.pinkyExtended;
    const middleThreeIn = !fs.indexExtended && !fs.middleExtended && !fs.ringExtended;
  
    let score = 0;
    if (thumbOut) score += 30;
    if (pinkyOut) score += 35;
    if (middleThreeIn) score += 35;
  
    return {
      score: Math.round(score),
      feedback: score >= 95
        ? "Perfect! Posture geometry matches target blueprint exactly."
        : !thumbOut
          ? "Extend your thumb out to the side."
          : !pinkyOut
            ? "Extend your pinky finger out."
            : "Curl index, middle, and ring fingers down."
    };
  }
  
  function scoreASL_Z(lm: Landmark[], fs: FingerState): { score: number; feedback: string } {
    const indexUp = fs.indexExtended;
    const othersIn = !fs.middleExtended && !fs.ringExtended && !fs.pinkyExtended;
    const thumbIn = !fs.thumbExtended;
  
    let score = 0;
    if (indexUp) score += 50;
    if (othersIn) score += 30;
    if (thumbIn) score += 20;
  
    return {
      score: Math.round(score),
      feedback: score >= 95
        ? "Perfect! Posture geometry matches target blueprint exactly."
        : "Point index finger out, curl others and thumb — then trace a Z in the air."
    };
  }
  
  function scorePEACE(lm: Landmark[], fs: FingerState): { score: number; feedback: string } {
    return scoreASL_V(lm, fs);
  }
  
  // ─── Master Dispatcher ────────────────────────────────────────────────────────
  
  const SCORE_FUNCTIONS: Record<string, (lm: Landmark[], fs: FingerState) => { score: number; feedback: string }> = {
    "ASL_A": scoreASL_A,
    "ASL_B": scoreASL_B,
    "ASL_C": scoreASL_C,
    "ASL_D": scoreASL_D,
    "ASL_E": scoreASL_E,
    "ASL_F": scoreASL_F,
    "ASL_G": scoreASL_G,
    "ASL_H": scoreASL_H,
    "ASL_I": scoreASL_I,
    "ASL_K": scoreASL_K,
    "ASL_L": scoreASL_L,
    "ASL_M": scoreASL_M,
    "ASL_N": scoreASL_N,
    "ASL_O": scoreASL_O,
    "ASL_R": scoreASL_R,
    "ASL_S": scoreASL_S,
    "ASL_T": scoreASL_T,
    "ASL_U": scoreASL_U,
    "ASL_V": scoreASL_V,
    "ASL_W": scoreASL_W,
    "ASL_X": scoreASL_X,
    "ASL_Y": scoreASL_Y,
    "ASL_Z": scoreASL_Z,
    "PEACE_SIGN": scorePEACE,
  };
  
  /**
   * Signs that are geometrically similar — used to identify nearby competitors.
   */
  const SIMILAR_SIGNS: Record<string, string[]> = {
    "ASL_A": ["ASL_S", "ASL_E", "ASL_M", "ASL_N", "ASL_T"],
    "ASL_S": ["ASL_A", "ASL_E", "ASL_M", "ASL_N", "ASL_T"],
    "ASL_E": ["ASL_A", "ASL_S", "ASL_O"],
    "ASL_B": ["ASL_V", "PEACE_SIGN", "ASL_U", "ASL_W"],
    "ASL_U": ["ASL_V", "PEACE_SIGN", "ASL_H", "ASL_R"],
    "ASL_V": ["ASL_U", "PEACE_SIGN", "ASL_K"],
    "PEACE_SIGN": ["ASL_V", "ASL_U"],
    "ASL_D": ["ASL_G", "ASL_Z", "ASL_F", "ASL_X"],
    "ASL_F": ["ASL_D", "ASL_O"],
    "ASL_O": ["ASL_C", "ASL_E"],
    "ASL_C": ["ASL_O"],
    "ASL_M": ["ASL_N", "ASL_A", "ASL_S"],
    "ASL_N": ["ASL_M", "ASL_T"],
    "ASL_T": ["ASL_A", "ASL_N"],
    "ASL_R": ["ASL_U", "ASL_V"],
    "ASL_G": ["ASL_D", "ASL_H"],
    "ASL_H": ["ASL_U", "ASL_G"],
    "ASL_I": ["ASL_Y"],
    "ASL_Y": ["ASL_I"],
    "ASL_Z": ["ASL_D", "ASL_G"],
    "ASL_K": ["ASL_V", "ASL_U"],
    "ASL_L": ["ASL_D", "ASL_G"],
    "ASL_W": ["ASL_B"],
    "ASL_X": ["ASL_D"],
  };
  
  /**
   * evaluateTargetSignScore — v4
   *
   * New: to reach 100%, the target sign must ALSO be the global winner across
   * ALL signs (not just SIMILAR_SIGNS), with at least a MIN_WIN_MARGIN gap.
   * This prevents random gestures from scoring 100% when no competitor is in the
   * SIMILAR_SIGNS list.
   */
  const AMBIGUITY_THRESHOLD = 18;
  const MIN_WIN_MARGIN = 22; // target must beat ALL others by this much to reach 100%
  
  export function evaluateTargetSignScore(
    landmarks: Landmark[],
    targetSign: string,
    isLeftHand: boolean
  ): { score: number; feedback: string } {
    if (!landmarks || landmarks.length < 21) {
      return { score: 0, feedback: "No hand visible in camera frame viewport." };
    }
  
    const fs = extractFingerState(landmarks, isLeftHand);
    const fn = SCORE_FUNCTIONS[targetSign];
  
    if (!fn) {
      return { score: 20, feedback: "Target sign initialization placeholder state active." };
    }
  
    const { score: rawScore, feedback } = fn(landmarks, fs);
  
    // ── Disambiguation Guard (SIMILAR_SIGNS) ─────────────────────────────────
    if (rawScore >= 55) {
      const competitors = SIMILAR_SIGNS[targetSign] ?? [];
      let highestCompetitorScore = 0;
  
      for (const compSign of competitors) {
        const compFn = SCORE_FUNCTIONS[compSign];
        if (compFn) {
          const { score: compScore } = compFn(landmarks, fs);
          if (compScore > highestCompetitorScore) highestCompetitorScore = compScore;
        }
      }
  
      const margin = rawScore - highestCompetitorScore;
      if (margin < AMBIGUITY_THRESHOLD && highestCompetitorScore >= 55) {
        return {
          score: Math.min(rawScore, 65),
          feedback: `Almost! Your shape is close but could be confused with a similar sign. ${feedback}`
        };
      }
    }
  
    // ── Global Win Guard (prevents false 100%) ───────────────────────────────
    // To score 100%, the target sign must be the clear global winner.
    if (rawScore >= 85) {
      let globalBestCompetitor = 0;
  
      for (const [sign, fn2] of Object.entries(SCORE_FUNCTIONS)) {
        if (sign === targetSign) continue;
        const { score: compScore } = fn2(landmarks, fs);
        if (compScore > globalBestCompetitor) globalBestCompetitor = compScore;
      }
  
      if (rawScore - globalBestCompetitor < MIN_WIN_MARGIN) {
        // Gesture is ambiguous globally — cap at 80% and give feedback
        return {
          score: Math.min(rawScore, 80),
          feedback: `Good shape, but not distinct enough yet. ${feedback}`
        };
      }
    }
  
    return { score: rawScore, feedback };
  }
  
  // ─── classifyStaticSign ───────────────────────────────────────────────────────
  
  export function classifyStaticSign(landmarks: Landmark[], isLeftHand = false): string | null {
    if (!landmarks || landmarks.length < 21) return null;
  
    const fs = extractFingerState(landmarks, isLeftHand);
  
    const candidates = Object.entries(SCORE_FUNCTIONS).map(([sign, fn]) => ({
      sign,
      score: fn(landmarks, fs).score,
    }));
  
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    const second = candidates[1];
  
    // Require clear winner: 85%+ AND at least 20 points ahead of second
    if (best.score >= 85 && best.score - second.score >= 20) {
      return best.sign.replace("ASL_", "").replace("_SIGN", "");
    }
  
    return "Scanning...";
  }