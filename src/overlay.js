/* 2300AD overlay on the Traveller engine.
   The term loop, ageing table, mustering out and benefits are Traveller's and are
   reused unchanged (engine.js). Everything 2300AD ADDS or CHANGES lives here, so the
   two generators cannot drift apart silently. */
(function (root) {
  'use strict';
  // In the browser both files attach to window, so root.TravellerEngine is there. Under
  // node each file has its own module scope, so fall back to requiring it directly.
  var E = root.TravellerEngine ||
    (typeof require !== 'undefined' ? require('./engine.js').TravellerEngine : null);
  if (!E) throw new Error('2300AD overlay: TravellerEngine not found');

  // ---- gravity ----
  // The published bands do not tile: Low ends 0.75, Standard starts 0.80. Two outposts
  // (Shungen, Ville de Glace) sit at 0.76 and would otherwise fall through. RULING
  // APPLIED: Low is widened to below 0.80. Flagged in gravity-and-background.json.
  var GRAV = [
    { type: 'Zero Gravity',     max: 0.10, STR: -2, DEX: 2,  END: -2 },
    { type: 'Low Gravity',      max: 0.80, STR: -1, DEX: 1,  END: -1 },
    { type: 'Standard Gravity', max: 1.21, STR: 0,  DEX: 0,  END: 0 },
    { type: 'High Gravity',     max: 2.11, STR: 1,  DEX: -1, END: 1 },
    { type: 'Extreme Gravity',  max: Infinity, STR: 2, DEX: -2, END: 2 }
  ];
  var BAND_BY_NAME = {
    'Zero': 'Zero Gravity', 'Light': 'Low Gravity', 'Low': 'Low Gravity',
    'Normal': 'Standard Gravity', 'Standard': 'Standard Gravity',
    'High': 'High Gravity', 'Extreme': 'Extreme Gravity'
  };
  function bandForNumber(g) {
    for (var i = 0; i < GRAV.length; i++) if (g < GRAV[i].max) return GRAV[i];
    return GRAV[GRAV.length - 1];
  }
  function bandForName(n) {
    var want = BAND_BY_NAME[n] || 'Standard Gravity';
    for (var i = 0; i < GRAV.length; i++) if (GRAV[i].type === want) return GRAV[i];
    return GRAV[2];
  }
  function applyGravity(S, band) {
    ['STR', 'DEX', 'END'].forEach(function (k) {
      if (band[k]) E.bumpChar(S, k, band[k], S.log);
    });
    S.gravityBand = band.type;
  }

  // ---- origin ----
  function homeworldsFor(DATA, nationality, kind) {
    var out = [];
    if (kind !== 'spacer') {
      DATA.colonies.colonies.concat(DATA.colonies.independent_colonies || []).forEach(function (c) {
        if (c.nationality === nationality) out.push({
          kind: 'colony', name: c.colony, system: c.system, gravity: c.gravity,
          path: c.path, survival_dm: c.survival_dm, tech_level: c.tech_level,
          tier: DATA.colonies.nation_tier[c.nationality]
        });
      });
    }
    if (kind !== 'frontier') {
      DATA.outposts.outposts.forEach(function (o) {
        if (o.nationality === nationality) out.push({
          kind: 'outpost', name: o.outpost, system: o.system, gravity_g: o.gravity,
          path: null, survival_dm: o.survival_dm, tech_level: null,
          tier: DATA.colonies.nation_tier[o.nationality] || null
        });
      });
    }
    return out;
  }

  function nationalities(DATA) {
    var set = {};
    DATA.colonies.colonies.forEach(function (c) { set[c.nationality] = 1; });
    (DATA.colonies.independent_colonies || []).forEach(function (c) { set[c.nationality] = 1; });
    DATA.outposts.outposts.forEach(function (o) { set[o.nationality] = 1; });
    return Object.keys(set).sort();
  }

  function setOrigin(S, hw) {
    S.origin = hw;
    S.isSpacer = hw.kind === 'outpost';
    S.path = hw.path;                       // null for Spacers -- outposts carry no Path
    S.leftHome = false;
    var band = hw.kind === 'outpost' ? bandForNumber(hw.gravity_g) : bandForName(hw.gravity);
    applyGravity(S, band);
    S.log.push('origin: ' + hw.name + ' (' + band.type + ')');
  }

  // ---- survival, while still at home ----
  function survivalDM(S) {
    if (S.leftHome) return 0;
    var dm = S.origin ? (S.origin.survival_dm || 0) : 0;
    if (S.path === 'Soft') dm += 1;         // Soft Path: DM+1 until Leave Home
    if (S.isSpacer) dm -= 1;                // Spacers: DM-1 until they leave home
    return dm;
  }

  // ---- Leaving Home: 2D 8+ at the end of every term until it passes ----
  function leavingHome(S, careerKey, termsInCareer) {
    var dm = 0;
    if (['navy', 'marine', 'merchant'].indexOf(careerKey) >= 0) dm += termsInCareer;
    else if (careerKey === 'scout') dm += termsInCareer * 2;
    if (S.isSpacer) dm += 2;
    var roll = S.rng.d2();
    return { roll: roll, dm: dm, total: roll + dm, ok: (roll + dm) >= 8 };
  }

  // ---- benefits ----
  function benefitDM(S) {
    var dm = 0;
    if (S.path === 'Hard') dm += 1;
    if (S.path === 'Soft') dm -= 1;
    if (S.offworldEducated) dm -= 1;        // the cost of going off-world to study
    return dm;
  }

  // ---- pre-career education ----
  function educationDM(S, where) {
    if (S.isSpacer) return -2;              // higher education is rare among Spacers
    if (where === 'offworld') {
      var byTier = { 1: 2, 2: 0, 3: -2, 4: -4, 5: -6, 6: -8 };
      return byTier[S.origin && S.origin.tier] || 0;
    }
    var tl = S.origin && S.origin.tech_level;
    if (tl == null) return 0;
    if (tl <= 7) return -6;
    if (tl <= 9) return -4;
    if (tl <= 11) return -2;
    return 0;
  }

  // ---- career availability in the FIRST term ----
  var SPACE_CAREERS = ['scout', 'merchant', 'navy'];
  function careerBlockedFirstTerm(S, careerKey) {
    if (S.terms.length > 0) return null;
    if (S.isSpacer && careerKey === 'army') {
      return 'Spacers cannot enter the Army in their first term.';
    }
    var tier = S.origin && S.origin.tier;
    if (!S.isSpacer && (tier === 5 || tier === 6) && SPACE_CAREERS.indexOf(careerKey) >= 0) {
      return 'Travellers from a Tier ' + tier + ' colony cannot take a space career in their first term.';
    }
    return null;
  }
  function careerEntryDM(S, careerKey) {
    // Spacers may enter the Army from term two onwards, at DM-1
    if (S.isSpacer && careerKey === 'army' && S.terms.length > 0) return -1;
    return 0;
  }

  // ---- ageing: 2300AD pushes the first roll from age 34 to age 50 ----
  function ageingDue(S) { return S.terms.length >= 8; }

  // ---- languages ----
  var ARM_LANGUAGE = { 'French Arm': 'French', 'American Arm': 'English', 'Manchurian Arm': 'Mandarin Chinese' };
  function startingLanguages(S) {
    var out = [];
    if (S.isSpacer) out.push({ name: 'Zhargon', level: 1 });
    return out;
  }

  // ---- skill-name substitutions ----
  var SKILL_SWAP = {
    'Engineer (j-drive)': 'Engineer (stutterwarp)',
    'Flyer (grav)': 'Flyer (vectored thrust)'
  };
  function swapSkill(name) { return SKILL_SWAP[name] || name; }

  root.AD2300 = {
    GRAV: GRAV, bandForNumber: bandForNumber, bandForName: bandForName, applyGravity: applyGravity,
    nationalities: nationalities, homeworldsFor: homeworldsFor, setOrigin: setOrigin,
    survivalDM: survivalDM, leavingHome: leavingHome, benefitDM: benefitDM,
    educationDM: educationDM, careerBlockedFirstTerm: careerBlockedFirstTerm,
    careerEntryDM: careerEntryDM, ageingDue: ageingDue,
    startingLanguages: startingLanguages, ARM_LANGUAGE: ARM_LANGUAGE,
    swapSkill: swapSkill, SKILL_SWAP: SKILL_SWAP,
    SPACE_CAREERS: SPACE_CAREERS
  };
})(typeof module !== 'undefined' && module.exports ? module.exports : (typeof window !== 'undefined' ? window : this));
