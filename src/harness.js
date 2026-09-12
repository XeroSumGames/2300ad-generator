/* VERIFY 1 -- fuzz the 2300AD overlay over whole lifepaths.
   The Traveller engine is already proven by its own harness; this exercises what
   2300AD ADDS: origin, gravity adjustment, the homeworld survival DM and its expiry,
   the Leaving Home check, career restrictions in term one, and ageing pushed to term 8.
   Run: node src/harness.js [runs]
*/
var fs = require('fs'), path = require('path');
var E = require('./engine.js').TravellerEngine;
var A = require('./overlay.js').AD2300;

var D = path.join(__dirname, 'data');
function J(p) { return JSON.parse(fs.readFileSync(path.join(D, p), 'utf8')); }

var careers = {};
fs.readdirSync(path.join(D, 'careers-traveller')).forEach(function (f) {
  var c = J(path.join('careers-traveller', f)); careers[c.key] = c;
});
var drifter = J(path.join('careers', 'drifter-2300ad.json'));
careers[drifter.key] = drifter;              // 2300AD replaces the Traveller Drifter

var DATA = {
  core: J('core-rules.json'), loop: J('term-loop.json'), muster: J('mustering-out.json'),
  colonies: J('colonies.json'), outposts: J('outposts.json'),
  gravity: J('gravity-and-background.json'), origin: J('origin-rules.json'),
  packages: J('skill-packages.json'), careers: careers
};

var checks = 0, fails = [];
function ok(c, l) { checks++; if (!c) fails.push(l); }

var NATS = A.nationalities(DATA);
var MAX_TERMS = 12;

function play(seed) {
  var S = E.start(DATA, seed);
  S.phase = 'origin';
  var rng = S.rng;

  // ---- origin ----
  var nat = NATS[Math.floor(rng.next() * NATS.length)];
  var homes = A.homeworldsFor(DATA, nat, 'any');
  ok(homes.length > 0, 'seed ' + seed + ': ' + nat + ' has at least one homeworld');
  if (!homes.length) return S;
  var hw = homes[Math.floor(rng.next() * homes.length)];
  A.setOrigin(S, hw);

  ok(!!S.gravityBand, 'seed ' + seed + ': a gravity band was assigned for ' + hw.name);
  ok(S.isSpacer === (hw.kind === 'outpost'), 'seed ' + seed + ': spacer flag matches homeworld kind');
  if (S.isSpacer) ok(S.path === null, 'seed ' + seed + ': outposts carry no Path');
  else ok(S.path === 'Hard' || S.path === 'Soft', 'seed ' + seed + ': colony Path is Hard or Soft (got ' + S.path + ')');

  // background skills, from the 2300AD list
  var n = Math.max(0, E.dm(S.chars.EDU) + 3);
  var pool = DATA.gravity.background_skills.list.slice();
  var restricted = DATA.gravity.background_skills.restriction;
  for (var i = 0; i < n && pool.length; i++) {
    var pick = pool.splice(Math.floor(rng.next() * pool.length), 1)[0];
    if (pick === 'Gun Combat' && restricted.nationalities.indexOf(nat) >= 0 && S.chars.SOC < 9) continue;
    if (S.skills[pick] === undefined) S.skills[pick] = 0;
  }

  S.phase = 'terms';
  var guard = 0;
  while (S.terms.length < MAX_TERMS) {
    if (++guard > 200) { fails.push('seed ' + seed + ': LOOP DID NOT TERMINATE'); return S; }

    // pick a career, honouring the first-term restrictions
    var opts = E.careerOptions(S).filter(function (k) { return !A.careerBlockedFirstTerm(S, k); });
    ok(opts.length > 0, 'seed ' + seed + ': some career is always open');
    if (S.terms.length === 0) {
      if (S.isSpacer) ok(opts.indexOf('army') < 0, 'seed ' + seed + ': Spacer barred from Army in term one');
      var tier = S.origin.tier;
      if (!S.isSpacer && (tier === 5 || tier === 6)) {
        ok(A.SPACE_CAREERS.every(function (c) { return opts.indexOf(c) < 0; }),
          'seed ' + seed + ': Tier ' + tier + ' barred from space careers in term one');
      }
    }
    var ck = opts[Math.floor(rng.next() * opts.length)];
    var c = DATA.careers[ck];
    var asg = c.assignments[Math.floor(rng.next() * c.assignments.length)].key;

    var q = E.qualify(S, ck, asg);
    if (!q.ok) { ck = 'drifter'; c = DATA.careers[ck]; asg = c.assignments[Math.floor(rng.next() * 3)].key; }
    E.enterCareer(S, ck, asg);

    var tables = E.availableSkillTables(S);
    E.rollSkillTable(S, tables[Math.floor(rng.next() * tables.length)].key);

    // survival, with the 2300AD homeworld modifier folded in
    var sv = E.survival(S);
    var dm = A.survivalDM(S);
    var adjusted = sv.total + dm;
    if (S.leftHome) ok(dm === 0, 'seed ' + seed + ': no homeworld survival DM once Leave Home has passed');
    var survived = sv.roll !== 2 && adjusted >= E.parseCheck(E.findAssignment(c, asg).survival).target;
    if (!survived) S.current.leftBecause = 'mishap';

    S.age += 4;
    S.terms.push(S.current);
    var closed = S.current; S.current = null;
    ok(S.age === 18 + 4 * S.terms.length, 'seed ' + seed + ': age tracks terms');

    // Leaving Home, at the end of every term until it passes
    if (!S.leftHome) {
      var lh = A.leavingHome(S, closed.career, S.careerTermCount[closed.career]);
      ok(lh.total === lh.roll + lh.dm, 'seed ' + seed + ': leaving-home total is roll + dm');
      if (S.isSpacer) ok(lh.dm >= 2, 'seed ' + seed + ': Spacers carry at least DM+2 to leave home');
      if (lh.ok) { S.leftHome = true; S.leftHomeAt = S.terms.length; }
    }

    // ageing -- 2300AD starts at term 8, not term 4
    var due = A.ageingDue(S);
    ok(due === (S.terms.length >= 8), 'seed ' + seed + ': ageing due only from term 8');
    if (S.terms.length >= 4 && S.terms.length < 8) {
      ok(!due, 'seed ' + seed + ': no ageing at term ' + S.terms.length + ' (Traveller would have aged here)');
    }
    if (due) E.applyAgeing(S, E.ageingRoll(S).effect);

    if (!survived || rng.next() < 0.45) {
      var served = S.careerTermCount[closed.career];
      var mo = E.musterOut(S, closed.career, served, Math.max(closed.rank, closed.officerRank));
      var bdm = A.benefitDM(S);
      ok(bdm >= -2 && bdm <= 1, 'seed ' + seed + ': benefit DM in range (got ' + bdm + ')');
      for (var b = 0; b < mo.rolls; b++) E.takeBenefit(S, closed.career, S.cashRollsUsed < 3 && rng.next() < 0.4, mo.rankDM);
      if (rng.next() < 0.5) break;
    }
  }
  S.done = true;
  return S;
}

var runs = parseInt(process.argv[2] || '3000', 10);
console.log('fuzzing ' + runs + ' 2300AD lifepaths...');
var left = 0, spacers = 0, aged = 0, bands = {}, natHit = {}, exportCount = 0;

for (var seed = 1; seed <= runs; seed++) {
  var S = play(seed);
  if (S.leftHome) left++;
  if (S.isSpacer) spacers++;
  if (S.terms.length >= 8) aged++;
  bands[S.gravityBand] = (bands[S.gravityBand] || 0) + 1;
  if (S.origin) natHit[S.origin.name] = 1;

  ok(S.done, 'seed ' + seed + ': terminated');
  E.CHARS.forEach(function (k) {
    ok(S.chars[k] >= 0 && S.chars[k] <= 15, 'seed ' + seed + ': ' + k + ' in 0..15 (got ' + S.chars[k] + ')');
  });
  for (var sk in S.skills) {
    ok(S.skills[sk] >= 0 && S.skills[sk] <= 4, 'seed ' + seed + ': skill ' + sk + ' in 0..4');
    ok(!/^[A-Z]{3}\s*\+/.test(sk), 'seed ' + seed + ': characteristic bump stored as a skill: ' + sk);
  }
  ok(S.cashRollsUsed <= 3, 'seed ' + seed + ': lifetime cash-roll cap');

  // ---- the VTT envelope ----
  // The engine file is byte-identical to Traveller's, so the ids MUST come from DATA:
  // this asserting '2300ad' is what proves one engine is serving two games.
  var x = E.exportCharacter(S);
  ok(x.schemaVersion === 1, 'seed ' + seed + ': schemaVersion ' + x.schemaVersion);
  ok(x.system === '2300ad', 'seed ' + seed + ': system ' + x.system + ' -- the shared engine must read its id from DATA');
  ok(x.generator === '2300ad-generator', 'seed ' + seed + ': generator ' + x.generator);
  ok(!!x.generatedAt && !!x.character, 'seed ' + seed + ': envelope missing generatedAt/character');
  E.CHARS.forEach(function (c) {
    ok(x.character.characteristics[c] === S.chars[c], 'seed ' + seed + ': exported ' + c + ' disagrees');
  });
  ok(x.character.skills.length === Object.keys(S.skills).length, 'seed ' + seed + ': export dropped skills');
  ok(x.character.careerHistory.length === S.terms.length, 'seed ' + seed + ': export dropped career history');
  // the overlay's own state has to survive, or the VTT cannot tell a Spacer from a colonist
  ok(!!x.character.origin && x.character.origin.name === S.origin.name, 'seed ' + seed + ': export lost the homeworld');
  ok(x.character.isSpacer === S.isSpacer, 'seed ' + seed + ': export lost the Spacer flag');
  ok(x.character.gravityBand === S.gravityBand, 'seed ' + seed + ': export lost the gravity band');
  ok(x.character.leftHome === S.leftHome, 'seed ' + seed + ': export lost the leaving-home state');
  var round = JSON.parse(JSON.stringify(x));
  ok(round.character.seed === S.seed && round.character.origin.name === S.origin.name,
    'seed ' + seed + ': export does not survive a JSON round trip');
  exportCount++;
}

console.log('\nleft home        : ' + left + '/' + runs);
console.log('spacers          : ' + spacers + '/' + runs);
console.log('reached term 8+  : ' + aged);
console.log('gravity bands    : ' + JSON.stringify(bands));
console.log('distinct origins : ' + Object.keys(natHit).length);
console.log('VTT envelopes    : ' + exportCount + ' validated');
console.log('\n' + checks + ' checks, ' + fails.length + ' failed');
if (fails.length) {
  var seen = {}, shown = 0;
  fails.forEach(function (f) {
    var k = f.replace(/seed \d+/, 'seed N');
    if (!seen[k] && shown < 20) { seen[k] = 1; shown++; console.log('  FAIL  ' + f); }
  });
  console.log('  (' + fails.length + ' total, ' + Object.keys(seen).length + ' distinct)');
  process.exit(1);
}
console.log('ALL PASS');
