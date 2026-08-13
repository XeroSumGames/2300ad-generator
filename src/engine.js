/* Traveller creation engine -- Mongoose Traveller 2e.
   Pure logic, no DOM. The UI drives it by reading S.pending and calling choose().

   Shape, per DESIGN.md: an outer PHASE spine with a TERM LOOP phase that re-enters
   itself, and a `pending` object describing what the UI must ask right now. Outcomes
   are rolled, so `pending` is often reporting a result rather than asking a question.
*/
(function (root) {
  'use strict';

  // ---------- deterministic RNG (seedable so lifepaths can be replayed) ----------
  function RNG(seed) {
    this.s = (seed >>> 0) || 1;
  }
  RNG.prototype.next = function () {
    // xorshift32
    var x = this.s;
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;  x >>>= 0;
    this.s = x;
    return x / 4294967296;
  };
  RNG.prototype.d6 = function () { return Math.floor(this.next() * 6) + 1; };
  RNG.prototype.d2 = function () { return this.d6() + this.d6(); };
  RNG.prototype.d3 = function () { return Math.floor(this.next() * 3) + 1; };
  RNG.prototype.pick = function (a) { return a[Math.floor(this.next() * a.length)]; };

  // ---------- characteristic helpers ----------
  var CHARS = ['STR', 'DEX', 'END', 'INT', 'EDU', 'SOC'];
  var PHYSICAL = ['STR', 'DEX', 'END'];
  var MENTAL = ['INT', 'EDU', 'SOC'];

  function dm(score) {
    if (score <= 0) return -3;
    if (score <= 2) return -2;
    if (score <= 5) return -1;
    if (score <= 8) return 0;
    if (score <= 11) return 1;
    if (score <= 14) return 2;
    return 3;
  }

  // "INT 6+" / "DEX or INT 5+" / "Automatic" -> {chars:[..], target:n} | {auto:true}
  function parseCheck(str) {
    if (!str || /^automatic$/i.test(str)) return { auto: true };
    var m = String(str).match(/^([A-Z]{3})(?:\s+or\s+([A-Z]{3}))?\s+(\d+)\+$/);
    if (!m) return { auto: true, unparsed: str };
    var cs = [m[1]];
    if (m[2]) cs.push(m[2]);
    return { chars: cs, target: parseInt(m[3], 10) };
  }

  // ---------- skill helpers ----------
  // Skill entries look like "Gun Combat", "Streetwise 1", "Gambler 0", "DEX +1",
  // "Drive or Vacc Suit", "Electronics (comms)".
  function isCharBump(entry) { return /^([A-Z]{3})\s*\+(\d+)$/.test(entry); }

  function applySkillEntry(S, entry, log) {
    if (!entry) return;
    var cb = entry.match(/^([A-Z]{3})\s*\+(\d+)$/);
    if (cb) { bumpChar(S, cb[1], parseInt(cb[2], 10), log); return; }
    if (/\sor\s/.test(entry)) {
      // a choice the UI should make; when auto-resolving, take the first
      entry = entry.split(/\s+or\s+/)[0];
    }
    var lm = entry.match(/^(.*?)\s+(\d+)$/);
    var name, lvl;
    if (lm) { name = lm[1]; lvl = parseInt(lm[2], 10); } else { name = entry; lvl = null; }
    var cur = S.skills[name];
    if (lvl === null) {
      // no level listed: gain at 1 if untrained, else +1
      S.skills[name] = (cur === undefined) ? 1 : Math.min(cur + 1, 4);
    } else {
      // level listed: take it only if higher than current
      if (cur === undefined || lvl > cur) S.skills[name] = Math.min(lvl, 4);
      else return; // no benefit
    }
    if (log) log.push('skill: ' + name + ' -> ' + S.skills[name]);
  }

  function bumpChar(S, k, n, log) {
    if (CHARS.indexOf(k) < 0) return;
    var next = S.chars[k] + n;
    if (next > 15) {
      // increases above 15 are lost -- EXCEPT SOC, where the excess becomes Ship Shares
      if (k === 'SOC') {
        S.shipShares += (next - 15);
        if (log) log.push('SOC over 15: +' + (next - 15) + ' Ship Shares');
      }
      next = 15;
    }
    S.chars[k] = next;
    if (log) log.push('char: ' + k + ' -> ' + next);
  }

  function totalSkillLevels(S) {
    var t = 0;
    for (var k in S.skills) t += S.skills[k];
    return t;
  }
  function skillCap(S) { return 3 * (S.chars.INT + S.chars.EDU); }

  // ---------- state ----------
  function newState(DATA, seed) {
    return {
      DATA: DATA,
      rng: new RNG(seed),
      seed: seed,
      phase: 'characteristics',
      chars: { STR: 0, DEX: 0, END: 0, INT: 0, EDU: 0, SOC: 0 },
      age: 18,
      homeworld: '',
      name: '',
      skills: {},
      shipShares: 0,
      education: null,
      terms: [],          // append-only history
      current: null,      // the term being played
      careerTermCount: {},// terms served per career (for the advancement check)
      draftUsed: false,
      benefitRolls: 0,    // banked, spent at mustering out
      cashRollsUsed: 0,   // max 3 across ALL careers, for life
      cash: 0,
      benefits: [],       // resolved Other Benefits, in order taken
      benefitCounts: {},  // how many times each has been taken (duplicates differ)
      associates: [],
      pension: 0,
      debt: 0,
      log: [],
      pending: null,
      done: false
    };
  }

  // ---------- entry ----------
  function start(DATA, seed) {
    var S = newState(DATA, seed);
    rollCharacteristics(S);
    S.phase = 'background';
    S.pending = {
      kind: 'backgroundSkills',
      count: Math.max(0, dm(S.chars.EDU) + 3),
      options: DATA.core.background_skills.list.slice(),
      note: 'EDU DM + 3 background skills, each at level 0.'
    };
    return S;
  }

  function rollCharacteristics(S) {
    for (var i = 0; i < CHARS.length; i++) S.chars[CHARS[i]] = S.rng.d2();
    S.log.push('characteristics rolled');
  }

  // ---------- the term loop ----------
  function beginTerm(S) {
    S.pending = {
      kind: 'pickCareer',
      options: careerOptions(S),
      canEducate: educationAvailable(S),
      term: S.terms.length + 1,
      age: S.age
    };
  }

  function educationAvailable(S) {
    // terms 1-3 only, and only if not already attempted successfully
    return S.terms.length < 3 && !(S.education && S.education.entered);
  }

  function careerOptions(S) {
    var out = [], D = S.DATA.careers;
    for (var k in D) {
      var prev = lastCareer(S);
      // you cannot return to a career you left in the immediately preceding term
      if (prev && prev.career === k && prev.leftBecause) continue;
      out.push(k);
    }
    return out;
  }
  function lastCareer(S) { return S.terms.length ? S.terms[S.terms.length - 1] : null; }

  function qualify(S, careerKey, assignmentKey) {
    var c = S.DATA.careers[careerKey];
    var q = c.qualification;
    var chk = parseCheck(q.check);
    var auto = chk.auto;
    if (q.auto_if && S.chars[q.auto_if.characteristic] >= q.auto_if.min) auto = true;

    var roll = null, total = null, ok = true;
    if (!auto) {
      var mod = 0;
      // DM-1 per previous career (distinct careers already entered)
      mod -= Object.keys(S.careerTermCount).length;
      for (var i = 0; i < (q.dms || []).length; i++) {
        var d = q.dms[i];
        var am = /aged (\d+)/.exec(d.when);
        if (am && S.age >= parseInt(am[1], 10)) mod += d.dm;
      }
      var best = -99;
      for (var j = 0; j < chk.chars.length; j++) best = Math.max(best, dm(S.chars[chk.chars[j]]));
      roll = S.rng.d2();
      total = roll + best + mod;
      ok = total >= chk.target;
    }
    return { auto: auto, roll: roll, total: total, ok: ok };
  }

  function enterCareer(S, careerKey, assignmentKey) {
    var c = S.DATA.careers[careerKey];
    var firstEver = Object.keys(S.careerTermCount).length === 0;
    S.current = {
      career: careerKey,
      assignment: assignmentKey,
      rank: 0,
      commissioned: false,
      officerRank: 0,
      termNo: S.terms.length + 1,
      age: S.age,
      skillRolls: [],
      events: [],
      leftBecause: null
    };
    // basic training
    var firstInCareer = !S.careerTermCount[careerKey];
    if (firstInCareer) {
      var table = c.basic_training_exception
        ? c.skill_tables.assignment[assignmentKey]
        : c.skill_tables.service_skills;
      if (firstEver) {
        for (var i = 0; i < table.length; i++) {
          var e = table[i];
          if (!isCharBump(e)) grantAtZero(S, e);
        }
        S.log.push('basic training: all service skills at 0');
      } else {
        // subsequent careers: pick ONE at level 0 -- auto-resolve takes the first
        grantAtZero(S, table[0]);
        S.log.push('basic training: one service skill at 0');
      }
    }
    S.careerTermCount[careerKey] = (S.careerTermCount[careerKey] || 0) + 1;
  }

  function grantAtZero(S, entry) {
    if (/\sor\s/.test(entry)) entry = entry.split(/\s+or\s+/)[0];
    var name = entry.replace(/\s+\d+$/, '');
    if (S.skills[name] === undefined) S.skills[name] = 0;
  }

  function availableSkillTables(S) {
    var c = S.DATA.careers[S.current.career], t = c.skill_tables, out = [];
    out.push({ key: 'personal_development', label: 'Personal Development' });
    out.push({ key: 'service_skills', label: 'Service Skills' });
    out.push({ key: 'assignment', label: 'Assignment: ' + S.current.assignment });
    if (t.advanced_education && S.chars.EDU >= t.advanced_education.min_edu) {
      out.push({ key: 'advanced_education', label: 'Advanced Education (EDU ' + t.advanced_education.min_edu + '+)' });
    }
    if (t.officer && S.current.commissioned) out.push({ key: 'officer', label: 'Officer' });
    return out;
  }

  function rollSkillTable(S, tableKey) {
    var c = S.DATA.careers[S.current.career], t = c.skill_tables, list;
    if (tableKey === 'assignment') list = t.assignment[S.current.assignment];
    else if (tableKey === 'advanced_education') list = t.advanced_education.skills;
    else if (tableKey === 'officer') list = t.officer.skills;
    else list = t[tableKey];
    var r = S.rng.d6();
    var entry = list[r - 1];
    applySkillEntry(S, entry, S.log);
    S.current.skillRolls.push({ table: tableKey, roll: r, entry: entry });
    return { roll: r, entry: entry };
  }

  function survival(S) {
    var c = S.DATA.careers[S.current.career];
    var a = findAssignment(c, S.current.assignment);
    var chk = parseCheck(a.survival);
    var roll = S.rng.d2();
    var total = roll + dm(S.chars[chk.chars[0]]);
    var ok = roll !== 2 && total >= chk.target;   // a natural 2 always fails
    return { roll: roll, total: total, ok: ok, check: a.survival };
  }

  function findAssignment(c, key) {
    for (var i = 0; i < c.assignments.length; i++) if (c.assignments[i].key === key) return c.assignments[i];
    return c.assignments[0];
  }

  function advancement(S) {
    var c = S.DATA.careers[S.current.career];
    var a = findAssignment(c, S.current.assignment);
    var chk = parseCheck(a.advancement);
    var roll = S.rng.d2();
    var total = roll + dm(S.chars[chk.chars[0]]);
    var served = S.careerTermCount[S.current.career];
    return {
      roll: roll, total: total, ok: total >= chk.target, check: a.advancement,
      mustLeave: total <= served && roll !== 12,   // rolled at or under terms served
      mustStay: roll === 12
    };
  }

  function commissionRoll(S) {
    var c = S.DATA.careers[S.current.career];
    if (!c.commission) return null;
    var chk = parseCheck(c.commission.check);
    var termsInCareer = S.careerTermCount[S.current.career];
    var mod = termsInCareer > 1 ? -(termsInCareer - 1) : 0;
    var roll = S.rng.d2();
    var total = roll + dm(S.chars[chk.chars[0]]) + mod;
    return { roll: roll, total: total, ok: total >= chk.target, dm: mod };
  }

  function commissionAllowed(S) {
    var c = S.DATA.careers[S.current.career];
    if (!c.commission || S.current.commissioned) return false;
    var termsInCareer = S.careerTermCount[S.current.career];
    return termsInCareer === 1 || S.chars.SOC >= 9;
  }

  function rankBonus(S) {
    var c = S.DATA.careers[S.current.career];
    var track = pickRankTrack(c, S.current);
    if (!track) return;
    var r = S.current.commissioned ? S.current.officerRank : S.current.rank;
    for (var i = 0; i < track.length; i++) {
      if (track[i].rank === r && track[i].bonus) {
        applyRankBonus(S, track[i].bonus);
        return track[i];
      }
    }
    return null;
  }

  function pickRankTrack(c, cur) {
    var R = c.ranks;
    if (!R) return null;
    if (cur.commissioned && R.officer) return R.officer;
    if (R.all) return R.all;
    if (R[cur.assignment]) return R[cur.assignment];
    if (R.enlisted) return R.enlisted;
    // partially shared tracks, e.g. Agent's intelligence_corporate
    for (var k in R) if (k.indexOf(cur.assignment) >= 0) return R[k];
    return null;
  }

  function applyRankBonus(S, bonus) {
    // "SOC 10 or SOC +1, whichever is higher" and friends
    var m = bonus.match(/^([A-Z]{3})\s+(\d+)\s+or\s+\1\s*\+\s*(\d+)/);
    if (m) {
      var k = m[1], floor = parseInt(m[2], 10), plus = parseInt(m[3], 10);
      var target = Math.max(floor, S.chars[k] + plus);
      bumpChar(S, k, target - S.chars[k], S.log);
      return;
    }
    applySkillEntry(S, bonus, S.log);
  }

  function ageingDue(S) { return S.terms.length >= 4; }

  function ageingRoll(S) {
    var roll = S.rng.d2() - S.terms.length;
    var effect;
    if (roll >= 1) effect = null;
    else if (roll === 0) effect = { phys: [1] };
    else if (roll === -1) effect = { phys: [1, 1] };
    else if (roll === -2) effect = { phys: [1, 1, 1] };
    else if (roll === -3) effect = { phys: [2, 1, 1] };
    else if (roll === -4) effect = { phys: [2, 2, 1] };
    else if (roll === -5) effect = { phys: [2, 2, 2] };
    else effect = { phys: [2, 2, 2], ment: [1] };
    return { roll: roll, effect: effect };
  }

  function applyAgeing(S, effect) {
    if (!effect) return { crisis: false };
    var i, k;
    for (i = 0; i < (effect.phys || []).length; i++) {
      k = PHYSICAL[i % PHYSICAL.length];
      S.chars[k] = Math.max(0, S.chars[k] - effect.phys[i]);
    }
    for (i = 0; i < (effect.ment || []).length; i++) {
      k = MENTAL[i % MENTAL.length];
      S.chars[k] = Math.max(0, S.chars[k] - effect.ment[i]);
    }
    var crisis = false;
    for (i = 0; i < CHARS.length; i++) if (S.chars[CHARS[i]] === 0) crisis = true;
    return { crisis: crisis };
  }

  function musterOut(S, careerKey, termsServed, highestRank) {
    var c = S.DATA.careers[careerKey];
    var rolls = termsServed;
    if (highestRank >= 1 && highestRank <= 2) rolls += 1;
    else if (highestRank >= 3 && highestRank <= 4) rolls += 2;
    else if (highestRank >= 5) rolls += 3;
    var rankDM = highestRank >= 5 ? 1 : 0;
    return { rolls: rolls, rankDM: rankDM, table: c.mustering_out };
  }

  function takeBenefit(S, careerKey, wantCash, rankDM) {
    var c = S.DATA.careers[careerKey];
    var r = S.rng.d6() + (rankDM || 0);
    if (wantCash && S.skills['Gambler'] !== undefined) r += 1;
    if (r > 7) r = 7;
    if (r < 1) r = 1;
    var row = c.mustering_out[r - 1];
    if (wantCash) {
      S.cashRollsUsed++;
      S.cash += row.cash;
      return { cash: row.cash, roll: r };
    }
    S.benefits.push(row.benefit);
    S.benefitCounts[row.benefit] = (S.benefitCounts[row.benefit] || 0) + 1;
    var cm = row.benefit.match(/^([A-Z]{3})\s*\+(\d+)$/);
    if (cm) bumpChar(S, cm[1], parseInt(cm[2], 10), S.log);
    if (/Ship Share/.test(row.benefit)) {
      var n = /Two/.test(row.benefit) ? 2 : (/1D/.test(row.benefit) ? S.rng.d6() : (/2D/.test(row.benefit) ? S.rng.d2() : 1));
      S.shipShares += n;
    }
    return { benefit: row.benefit, roll: r };
  }

  function pensionFor(S, careerKey, termsServed) {
    var excluded = ['scout', 'rogue', 'prisoner', 'drifter'];
    if (excluded.indexOf(careerKey) >= 0) return 0;
    if (termsServed < 5) return 0;
    if (termsServed <= 8) return 10000 + (termsServed - 5) * 2000;
    return 16000 + (termsServed - 8) * 2000;
  }

  root.TravellerEngine = {
    RNG: RNG, CHARS: CHARS, PHYSICAL: PHYSICAL, MENTAL: MENTAL,
    dm: dm, parseCheck: parseCheck, applySkillEntry: applySkillEntry, bumpChar: bumpChar,
    totalSkillLevels: totalSkillLevels, skillCap: skillCap,
    start: start, newState: newState, rollCharacteristics: rollCharacteristics,
    beginTerm: beginTerm, educationAvailable: educationAvailable, careerOptions: careerOptions,
    qualify: qualify, enterCareer: enterCareer, availableSkillTables: availableSkillTables,
    rollSkillTable: rollSkillTable, survival: survival, advancement: advancement,
    commissionRoll: commissionRoll, commissionAllowed: commissionAllowed,
    rankBonus: rankBonus, pickRankTrack: pickRankTrack,
    ageingDue: ageingDue, ageingRoll: ageingRoll, applyAgeing: applyAgeing,
    musterOut: musterOut, takeBenefit: takeBenefit, pensionFor: pensionFor,
    findAssignment: findAssignment
  };
})(typeof module !== 'undefined' && module.exports ? module.exports : (typeof window !== 'undefined' ? window : this));
