/* 2300AD generator -- UI driver.
   engine.js owns the Traveller rules, overlay.js owns everything 2300AD changes,
   this owns what the screen asks next. Dispatches on phase + sub-step, not a step
   index, because most of the term loop reports a roll rather than asking a question. */
(function () {
  'use strict';
  var E = window.TravellerEngine, X = window.AD2300;
  var main, track, sidebar, S = null;

  // The record is filled in BY the Life Foundation, so the sections are its sections.
  // Esperanto subtitles because that is the Foundation's official language (Core Book 1
  // p101); the diacritics are HTML entities to keep the source ASCII for assemble.py.
  var PHASES = [
    ['origin', 'I. Registration', 'Registrado'],
    ['chars', 'II. Biological Assessment', 'Biologia Takso'],
    ['background', 'III. Formative Skills', 'Fruaj Kapabloj'],
    ['education', 'IV. Certification', 'Atestado'],
    ['terms', 'V. Record of Service', 'Servo-Registro'],
    ['muster', 'VI. Disposition', 'Dispono'],
    ['package', 'VII. Declaration', 'Deklaracio'],
    ['done', 'Record', 'Dosiero']
  ];

  // Parts the service record is built on. Readable always; amending one discards
  // everything the Foundation recorded after it.
  var GATED = ['origin', 'chars', 'background', 'education'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function sign(n) { return (n >= 0 ? '+' : '') + n; }
  function lv(n) { return 'Lv' + Number(n).toLocaleString('en-GB'); }
  function seed() { return (Math.floor(Math.random() * 4294967295) >>> 0) || 1; }

  function fresh() {
    S = E.start(DATA, seed());
    S.phase = 'origin'; S.sub = null;
    S.name = ''; S.nat = null; S.kind = null; S.origin = null;
    S.isSpacer = false; S.path = null; S.leftHome = false; S.leftHomeAt = null;
    S.offworldEducated = false; S.gravityBand = null;
    S.bgPicked = []; S.pkg = null; S.pkgTaken = []; S.musterQueue = [];
    S.pendingCareer = null; S.termLog = []; S.crisis = false;
    S.snaps = {}; S.readOnly = false; S.confirmUnlock = null;
    S.skillSources = {}; S.charSources = {};
  }

  function reached(phase) {
    var order = PHASES.map(function (p) { return p[0]; });
    if (S.phase === 'done') return true;
    return order.indexOf(phase) <= order.indexOf(S.phase);
  }
  function isGated(phase) { return GATED.indexOf(phase) >= 0 && S.terms.length > 0; }

  // Records WHERE a gain came from, by diffing the sheet either side of the grant. The
  // engine has no notion of provenance and should not -- it owns the rules, and this is
  // presentation. Same approach as traveller-generator, which shares that engine.
  function tracked(label, fn) {
    var sb = {}, cb = {}, k;
    for (k in S.skills) sb[k] = S.skills[k];
    for (k in S.chars) cb[k] = S.chars[k];
    var out = fn();
    S.skillSources = S.skillSources || {};
    S.charSources = S.charSources || {};
    for (k in S.skills) {
      if (sb[k] === undefined || sb[k] !== S.skills[k]) (S.skillSources[k] = S.skillSources[k] || []).push(label);
    }
    for (k in S.chars) {
      if (cb[k] !== S.chars[k]) {
        var d = S.chars[k] - cb[k];
        (S.charSources[k] = S.charSources[k] || []).push(label + ' ' + (d >= 0 ? '+' : '') + d);
      }
    }
    return out;
  }
  function termLabel() { return 'term ' + (S.terms.length + 1); }

  // ---------------- render ----------------
  function renderTrack() {
    var idx = 0;
    for (var i = 0; i < PHASES.length; i++) if (PHASES[i][0] === S.phase) idx = i;
    track.innerHTML = PHASES.map(function (p, i) {
      var can = reached(p[0]);
      var cls = 'track-item' + (i === idx ? ' active' : (i < idx ? ' done' : '')) + (can ? ' nav' : '');
      return '<div class="' + cls + '"' + (can ? ' onclick="A.nav(\'' + p[0] + '\')"' : '') + '>' +
        esc(p[1]) + '</div>';
    }).join('');
  }

  // Only jump to the top when the screen actually CHANGES -- ticking a skill or picking
  // a career re-renders the same view, and yanking the page back loses the reader's place.
  var lastView = null;

  function render() {
    renderTrack();
    var h = '';
    if (S.phase === 'origin') h = viewOrigin();
    else if (S.phase === 'chars') h = viewChars();
    else if (S.phase === 'background') h = viewBackground();
    else if (S.phase === 'education') h = viewEducation();
    else if (S.phase === 'terms') h = viewTerms();
    else if (S.phase === 'muster') h = viewMuster();
    else if (S.phase === 'package') h = viewPackage();
    else h = viewDossier();
    if (S.readOnly) h = lockedBanner(S.phase) + '<div class="ro">' + h + '</div>';
    main.innerHTML = h + (S.phase === 'done' ? printSheet() : '');
    if (sidebar) sidebar.innerHTML = viewSidebar();
    var rno = document.getElementById('recordno');
    if (rno) rno.textContent = 'LF-' + String(S.seed % 100000).padStart(5, '0');
    var view = S.phase + '/' + (S.sub || '');
    if (view !== lastView) { lastView = view; window.scrollTo(0, 0); }
  }

  // ---- the running summary: where every point went, and what it cost ----
  function sbRow(k, v, src, hot) {
    return '<div class="sb-row"><span class="k">' + k + '</span><span class="v' +
      (hot ? ' hot' : '') + '">' + v + '</span></div>' +
      (src ? '<div class="sb-src">' + esc(src) + '</div>' : '');
  }
  function sbT(en, eo) { return '<div class="sb-t">' + en + '<span class="eo">' + eo + '</span></div>'; }

  function viewSidebar() {
    var n = Math.max(0, E.dm(S.chars.EDU) + 3);
    var h = '<button class="sb-toggle" onclick="A.toggleSb()">Summary &mdash; where my points went</button><div class="sb-body">';

    h += '<div class="sb">' + sbT('Colonist', 'Koloniano') +
      sbRow('Name', esc(S.name || '&mdash;')) +
      (S.nat ? sbRow('Nationality', esc(S.nat)) : '') +
      (S.origin ? sbRow('Homeworld', esc(S.origin.name)) : '') +
      (S.path ? sbRow('Path', esc(S.path)) : (S.isSpacer ? sbRow('Path', 'Spacer') : '')) +
      sbRow('Age', S.age) + sbRow('Terms', S.terms.length) +
      '</div>';

    // The gravity adjustment is the Foundation's whole point -- it shaped the body it is
    // now assessing -- so it is called out rather than buried in the characteristics.
    if (S.gravityBand) {
      h += '<div class="sb">' + sbT('Environment', 'Medio') +
        sbRow('Gravity', esc(S.gravityBand), S.origin ? 'homeworld ' + S.origin.name : '') +
        sbRow('Survival DM', S.leftHome ? 'expired' : sign(X.survivalDM(S)),
          S.leftHome ? 'lapsed on leaving home' + (S.leftHomeAt ? ' after term ' + S.leftHomeAt : '')
                     : 'applies until you leave home', !S.leftHome && X.survivalDM(S) < 0) +
        '</div>';
    }

    h += '<div class="sb">' + sbT('Characteristics', 'Trajtoj') +
      E.CHARS.map(function (k) {
        var src = (S.charSources && S.charSources[k]) ? S.charSources[k].join(', ') : 'rolled 2D at 18';
        return sbRow(k, S.chars[k] + ' <span style="color:var(--dust);font-weight:400">DM ' +
          sign(E.dm(S.chars[k])) + '</span>', src);
      }).join('') + '</div>';

    var used = E.totalSkillLevels(S), cap = E.skillCap(S);
    var pct = cap ? Math.min(100, Math.round(used / cap * 100)) : 0;
    var keys = Object.keys(S.skills).sort();
    h += '<div class="sb">' + sbT('Skills', 'Kapabloj') +
      '<div class="sb-row"><span class="k">Levels used</span><span class="v">' + used + ' / ' + cap + '</span></div>' +
      '<div class="sb-bar"><span style="width:' + pct + '%"></span></div>' +
      '<div class="sb-src">cap is 3 x (INT ' + S.chars.INT + ' + EDU ' + S.chars.EDU + ')</div>';
    h += keys.length ? keys.map(function (k) {
      return sbRow(esc(k), S.skills[k], skillSource(k));
    }).join('') : '<div class="sb-empty">Nothing recorded yet.</div>';
    h += '</div>';

    if (S.phase === 'background' && S.bgPicked.length < n) {
      h = h.replace('<div class="sb-body">', '<div class="sb-body"><div class="sb-budget">' +
        (n - S.bgPicked.length) + ' formative skill' + ((n - S.bgPicked.length) === 1 ? '' : 's') + ' left to record</div>');
    }

    if (S.terms.length || S.phase === 'terms') h += ageClockHTML();

    h += '<div class="sb">' + sbT('Disposition', 'Dispono') +
      sbRow('Cash', lv(S.cash), S.cashRollsUsed + ' of 3 lifetime cash rolls used', S.cashRollsUsed >= 3) +
      sbRow('Pension', S.pension ? lv(S.pension) + '/yr' : '&mdash;') +
      sbRow('Ship shares', S.shipShares) +
      (S.benefits.length ? '<div class="sb-src" style="margin-top:6px">' + esc(S.benefits.join(', ')) + '</div>' : '') +
      '</div>';
    return h + '</div>';
  }

  function skillSource(name) {
    var bits = [];
    if (S.bgPicked.indexOf(name) >= 0) bits.push('formative');
    if (S.skillSources && S.skillSources[name]) bits.push(S.skillSources[name].join('; '));
    return bits.join('; ');
  }

  // 2300AD pushes ageing out to term 8, where Traveller starts at 4 -- colonists are
  // valuable and the Foundation says so. The warning belongs before the decision.
  function ageClockHTML() {
    var served = S.terms.length, next = served + 1;
    var h = '<div class="sb">' + sbT('Longevity', 'Longviveco');
    if (served >= 8) {
      h += '<div class="clock-note" style="color:var(--rust)"><b>Ageing is in effect.</b> ' +
        'Each term now ends on 2D minus ' + served + ' terms; at or under zero the Foundation records a decline.</div>';
    } else if (next >= 8) {
      h += '<div class="clock-note" style="color:var(--rust)"><b>An eighth term begins the ageing checks.</b> ' +
        'From here every term risks a characteristic, and the odds worsen each time.</div>';
    } else {
      h += '<div class="clock-note">No ageing until the end of your eighth term &mdash; ' +
        (8 - next) + ' more term' + ((8 - next) === 1 ? '' : 's') + ' of grace. ' +
        'The Foundation notes this is four terms longer than Imperial service allows.</div>';
    }
    return h + '</div>';
  }

  // ---- free to review, gated to mutate ----
  function discardCost(p) {
    var snap = S.snaps[p];
    if (!snap) return 'nothing';
    var bits = [];
    var lost = S.terms.length - (snap.terms ? snap.terms.length : 0);
    if (lost > 0) bits.push(lost + ' term' + (lost === 1 ? '' : 's') + ' of service');
    if (S.education && !snap.education) bits.push('your certification');
    if (S.cash > (snap.cash || 0)) bits.push('your disposition settlement');
    if (S.leftHome && !snap.leftHome) bits.push('your passage authorisation');
    return bits.length ? bits.join(', ') : 'nothing';
  }
  function lockedBanner(p) {
    if (S.confirmUnlock === p) {
      return '<div class="locked-note"><b>Amending this discards ' + esc(discardCost(p)) + '.</b> ' +
        'The Foundation built your service record on these entries and cannot carry them across.' +
        '<div class="btn-row tight" style="margin-top:10px">' +
        '<button class="btn ghost" onclick="A.cancelUnlock()">Leave the record as filed</button>' +
        '<button class="btn" onclick="A.unlock(\'' + p + '\')">Discard and amend</button></div></div>';
    }
    return '<div class="locked-note">Filed. Your service record was built on this section, so it reads only.' +
      '<div class="btn-row tight" style="margin-top:8px">' +
      '<button class="btn ghost" onclick="A.askUnlock(\'' + p + '\')">Amend this section&hellip;</button></div></div>';
  }

  // ---- origin ----
  function viewOrigin() {
    var h = '<div class="step-h">Registration and Origin</div>' +
      '<div class="step-eo">Registrado kaj Deveno</div>' +
      '<div class="step-p">Where you are from decides more in 2300AD than in Traveller. Your homeworld fixes your gravity, your Survival modifier, and whether you walk the Hard or Soft Path &mdash; that last one is not a choice, it belongs to the colony.</div>';

    var nats = X.nationalities(DATA);
    h += '<div class="panel"><div class="panel-t">Nationality</div><div class="skills-list">' +
      nats.map(function (n) {
        var tier = DATA.colonies.nation_tier[n];
        return '<div class="opt' + (S.nat === n ? ' on' : '') + '" onclick="A.pickNat(\'' + esc(n).replace(/'/g, "\\'") + '\')">' +
          '<div class="opt-box">' + (S.nat === n ? '&#10003;' : '') + '</div><div class="opt-n">' + esc(n) +
          (tier ? ' <span class="hist-r">tier ' + tier + '</span>' : '') + '</div></div>';
      }).join('') + '</div></div>';

    if (S.nat) {
      var homes = X.homeworldsFor(DATA, S.nat, 'any');
      var frontier = homes.filter(function (x) { return x.kind === 'colony'; });
      var spacer = homes.filter(function (x) { return x.kind === 'outpost'; });
      h += '<div class="panel"><div class="panel-t">Homeworld</div>';
      if (!homes.length) h += '<div class="note">No homeworld listed for this nationality.</div>';
      if (frontier.length) {
        h += '<div class="panel-t" style="margin-top:4px">Frontier colonies</div>' + frontier.map(hwOpt).join('');
      }
      if (spacer.length) {
        h += '<div class="panel-t" style="margin-top:12px">Spacer outposts</div>' + spacer.map(hwOpt).join('');
      }
      h += '</div>';
    }

    if (S.origin) {
      h += '<div class="panel"><div class="panel-t">' + esc(S.origin.name) + '</div>' +
        rollLine(S.gravityBand.replace(' Gravity', ''), 'Gravity band &mdash; ' + gravText()) +
        rollLine(sign(S.origin.survival_dm || 0), 'Survival DM, while you remain on your homeworld') +
        rollLine(S.isSpacer ? 'Spacer' : S.path, S.isSpacer
          ? 'Outposts carry no Path. DM-1 to Survival until you leave, DM+2 to leave.'
          : (S.path === 'Soft' ? 'DM+1 Survival at home, DM-1 on Benefit rolls.' : 'DM+1 on Benefit rolls.')) +
        (reqLine() ? '<div class="note"><b>Environmental requirements:</b> ' + esc(reqLine()) + '</div>' : '') +
        '</div>';
    }

    h += '<div class="btn-row"><span></span><button class="btn"' + (S.origin ? '' : ' disabled') +
      ' onclick="A.go(\'chars\')">Continue &rarr;</button></div>';
    return h;
  }
  function hwOpt(hw) {
    var g = hw.kind === 'outpost' ? (hw.gravity_g + ' G') : hw.gravity;
    return '<div class="opt' + (S.origin && S.origin.name === hw.name ? ' on' : '') +
      '" onclick="A.pickHome(\'' + esc(hw.name).replace(/'/g, "\\'") + '\')">' +
      '<div class="opt-box">' + (S.origin && S.origin.name === hw.name ? '&#10003;' : '') + '</div><div>' +
      '<div class="opt-n">' + esc(hw.name) + ' <span class="hist-r">' + esc(hw.system) + '</span></div>' +
      '<div class="opt-d">' + esc(g) + (hw.path ? ' &middot; ' + hw.path + ' Path' : ' &middot; outpost') +
      ' &middot; survival ' + sign(hw.survival_dm || 0) +
      (hw.tech_level ? ' &middot; TL ' + hw.tech_level : '') + '</div></div></div>';
  }
  function gravText() {
    for (var i = 0; i < X.GRAV.length; i++) if (X.GRAV[i].type === S.gravityBand) {
      var b = X.GRAV[i];
      return 'STR ' + sign(b.STR) + ', DEX ' + sign(b.DEX) + ', END ' + sign(b.END);
    }
    return '';
  }
  function reqLine() {
    if (!S.origin || !DATA.worlds) return null;
    for (var i = 0; i < DATA.worlds.worlds.length; i++) {
      var w = DATA.worlds.worlds[i];
      if (w.requirements && w.colonies && w.colonies.some(function (c) {
        return c.colony.toLowerCase() === S.origin.name.toLowerCase();
      })) return w.requirements;
    }
    return null;
  }

  // ---- characteristics ----
  function charsPanel() {
    return '<div class="panel"><div class="panel-t">Characteristics</div><div class="chars">' +
      E.CHARS.map(function (k) {
        return '<div class="ch"><div class="ch-k">' + k + '</div><div class="ch-v">' + S.chars[k] +
          '</div><div class="ch-dm">DM ' + sign(E.dm(S.chars[k])) + '</div></div>';
      }).join('') + '</div></div>';
  }
  function viewChars() {
    return '<div class="step-h">Biological Assessment</div>' +
      '<div class="step-eo">Biologia Takso</div>' +
      '<div class="step-p">Rolled 2D each, then adjusted for your homeworld gravity. You are 18.</div>' +
      charsPanel() +
      '<div class="note">' + esc(S.origin.name) + ' is ' + esc(S.gravityBand) + ' &mdash; ' + gravText() + ' already applied.</div>' +
      '<div class="btn-row"><button class="btn ghost" onclick="A.reroll()">&#9860; Roll again</button>' +
      '<button class="btn" onclick="A.go(\'background\')">Continue &rarr;</button></div>';
  }

  // ---- background ----
  function viewBackground() {
    var n = Math.max(0, E.dm(S.chars.EDU) + 3);
    var B = DATA.gravity.background_skills;
    var barred = B.restriction.nationalities.indexOf(S.nat) >= 0 && S.chars.SOC < 9;
    return '<div class="step-h">Formative Skills</div>' +
      '<div class="step-eo">Fruaj Kapabloj</div>' +
      '<div class="step-p">Choose <b>' + n + '</b> background skills &mdash; EDU DM + 3 &mdash; each at level 0. 2300AD uses its own shorter list.</div>' +
      '<div class="panel"><div class="grid2">' +
      '<div><label class="lbl">Name</label><input class="txt name-inp" value="' + esc(S.name) + '" oninput="A.set(\'name\',this.value)" placeholder="Your Traveller">' +
      '<button class="btn ghost btn-rand" type="button" onclick="A.randName()">&#9860; Random name</button></div>' +
      '<div><label class="lbl">Homeworld</label><input class="txt" value="' + esc(S.origin.name) + '" readonly></div>' +
      '</div></div>' +
      (barred ? '<div class="note">' + esc(S.nat) + ' colonists need SOC 9+ to take Gun Combat. Yours is ' + S.chars.SOC + '.</div>' : '') +
      '<div class="panel"><div class="panel-t">Background skills &mdash; ' + S.bgPicked.length + ' / ' + n + '</div>' +
      '<div class="skills-list">' + B.list.map(function (sk) {
        var on = S.bgPicked.indexOf(sk) >= 0;
        var block = (sk === 'Gun Combat' && barred);
        var dis = block || (!on && S.bgPicked.length >= n);
        return '<div class="opt' + (on ? ' on' : '') + (dis ? ' disabled' : '') + '"' +
          (dis ? '' : ' onclick="A.bg(\'' + esc(sk).replace(/'/g, "\\'") + '\')"') + '>' +
          '<div class="opt-box">' + (on ? '&#10003;' : '') + '</div><div class="opt-n">' + esc(sk) + '</div></div>';
      }).join('') + '</div></div>' +
      '<div class="btn-row"><button class="btn ghost" onclick="A.go(\'chars\')">&larr; Back</button>' +
      '<button class="btn"' + (S.bgPicked.length === n ? '' : ' disabled') + ' onclick="A.go(\'education\')">Continue &rarr;</button></div>';
  }

  // ---- education ----
  function viewEducation() {
    var h = '<div class="step-h">Certification</div>' +
      '<div class="step-eo">Atestado</div>' +
      '<div class="step-p">Optional, and takes your first term. Where you study matters: your homeworld\'s tech level or your nation\'s tier sets the entry modifier.</div>';
    if (S.education) {
      h += '<div class="panel"><div class="panel-t">' + esc(S.education.type) + '</div>' +
        S.education.log.map(function (l) { return rollLine(l.v, l.t, l.cls); }).join('') + '</div>' +
        '<div class="btn-row"><span></span><button class="btn" onclick="A.go(\'terms\')">Begin careers &rarr;</button></div>';
      return h;
    }
    var home = X.educationDM(S, 'homeworld'), off = X.educationDM(S, 'offworld');
    h += '<div class="panel"><div class="panel-t">Where</div>' +
      '<div class="opt" onclick="A.educate(\'homeworld\')"><div class="opt-box"></div><div>' +
      '<div class="opt-n">Study on ' + esc(S.origin.name) + ' <span class="hist-r">DM ' + sign(home) + '</span></div>' +
      '<div class="opt-d">' + (S.isSpacer ? 'Higher education is rare among Spacers.' : 'Set by your homeworld tech level' + (S.origin.tech_level ? ' (TL ' + S.origin.tech_level + ')' : '') + '.') + '</div></div></div>' +
      '<div class="opt" onclick="A.educate(\'offworld\')"><div class="opt-box"></div><div>' +
      '<div class="opt-n">Study off-world <span class="hist-r">DM ' + sign(off) + '</span></div>' +
      '<div class="opt-d">Set by your nation\'s tier' + (S.origin.tier ? ' (tier ' + S.origin.tier + ')' : '') + '. Costs you DM-1 on every Benefit roll later, and a roll of 1 then yields nothing.</div></div></div>' +
      '<div class="opt" onclick="A.go(\'terms\')"><div class="opt-box"></div><div><div class="opt-n">Skip</div>' +
      '<div class="opt-d">Straight into a career.</div></div></div></div>';
    return h;
  }

  // ---- terms ----
  function rollLine(v, t, cls) {
    return '<div class="roll ' + (cls || '') + '"><span class="roll-v">' + v + '</span><span class="roll-t">' + t + '</span></div>';
  }
  function historyHTML() {
    if (!S.terms.length) return '';
    return '<div class="panel"><div class="panel-t">Career history</div><div class="hist">' +
      S.terms.map(function (t, i) {
        var c = DATA.careers[t.career], a = E.findAssignment(c, t.assignment);
        return '<div class="hist-row"><div class="hist-t">Term ' + (i + 1) + '</div>' +
          '<div class="hist-c"><b>' + esc(c.name) + '</b> &middot; ' + esc(a.name) +
          (t.leftBecause ? ' <span class="hist-r">(' + esc(t.leftBecause) + ')</span>' : '') + '</div>' +
          '<div class="hist-r">age ' + t.age + '</div></div>';
      }).join('') + '</div>' +
      (S.leftHome ? '<div class="note">Left ' + esc(S.origin.name) + ' in term ' + S.leftHomeAt +
        '. The homeworld Survival modifier no longer applies.</div>'
        : '<div class="note">Still on ' + esc(S.origin.name) + '. Survival ' + sign(X.survivalDM(S)) +
        ' until you leave.</div>') + '</div>';
  }
  function skillsPanel() {
    var keys = Object.keys(S.skills).sort();
    if (!keys.length) return '';
    return '<div class="panel"><div class="panel-t">Skills</div><div class="skills-list">' +
      keys.map(function (k) { return '<div class="sk"><span>' + esc(X.swapSkill(k)) + '</span><span class="sk-v">' + S.skills[k] + '</span></div>'; }).join('') +
      '</div></div>';
  }

  function viewTerms() {
    var h = '<div class="step-h">Service Period ' + (S.terms.length + 1) + '</div>' +
      '<div class="step-eo">Servo-Periodo</div>' +
      '<div class="step-p">Age ' + S.age + '. Four years a term.</div>' + historyHTML();
    if (!S.sub || S.sub === 'pick') {
      h += '<div class="panel"><div class="panel-t">Choose a career</div>';
      h += E.careerOptions(S).map(function (k) {
        var c = DATA.careers[k], blocked = X.careerBlockedFirstTerm(S, k);
        return '<div class="opt' + (S.pendingCareer === k ? ' on' : '') + (blocked ? ' disabled' : '') + '"' +
          (blocked ? '' : ' onclick="A.pickCareer(\'' + k + '\')"') + '>' +
          '<div class="opt-box">' + (S.pendingCareer === k ? '&#10003;' : '') + '</div><div>' +
          '<div class="opt-n">' + esc(c.name) + ' <span class="hist-r">qualify ' + esc(c.qualification.check) + '</span></div>' +
          '<div class="opt-d">' + esc(blocked || c.blurb) + '</div></div></div>';
      }).join('') + '</div>';
      if (S.pendingCareer) {
        var c2 = DATA.careers[S.pendingCareer];
        h += '<div class="panel"><div class="panel-t">Assignment</div>' + c2.assignments.map(function (a) {
          return '<div class="opt" onclick="A.pickAssignment(\'' + a.key + '\')"><div class="opt-box"></div><div>' +
            '<div class="opt-n">' + esc(a.name) + ' <span class="hist-r">survival ' + esc(a.survival) + ' &middot; advancement ' + esc(a.advancement) + '</span></div>' +
            '<div class="opt-d">' + esc(a.desc) + '</div></div></div>';
        }).join('') + '</div>';
      }
      return h + skillsPanel();
    }
    h += '<div class="panel"><div class="term-hd"><div class="term-n">' +
      esc(DATA.careers[S.current.career].name) + ' &middot; ' +
      esc(E.findAssignment(DATA.careers[S.current.career], S.current.assignment).name) +
      '</div><div class="term-age">age ' + S.current.age + '</div></div>' +
      S.termLog.map(function (l) { return rollLine(l.v, l.t, l.cls); }).join('') + '</div>';
    if (S.sub === 'train') {
      h += '<div class="panel"><div class="panel-t">Choose a skill table &mdash; roll 1D</div>' +
        E.availableSkillTables(S).map(function (t) {
          return '<div class="opt" onclick="A.train(\'' + t.key + '\')"><div class="opt-box"></div><div class="opt-n">' + esc(t.label) + '</div></div>';
        }).join('') + '</div>';
    } else if (S.sub === 'continue') {
      h += '<div class="panel"><div class="panel-t">Another term?</div>' +
        (S.mustLeave ? '<div class="note">Your advancement roll came in at or under your terms served. You cannot continue here.</div>' : '') +
        (!S.mustLeave ? '<div class="opt" onclick="A.another(true)"><div class="opt-box"></div><div class="opt-n">Serve another term</div></div>' : '') +
        '<div class="opt" onclick="A.another(false)"><div class="opt-box"></div><div class="opt-n">Leave and muster out</div></div></div>';
    } else if (S.sub === 'ejected') {
      h += '<div class="panel"><div class="panel-t">Out of a job</div>' +
        '<div class="opt" onclick="A.another(false)"><div class="opt-box"></div><div class="opt-n">Muster out</div></div></div>';
    }
    return h + skillsPanel();
  }

  // ---- mustering out ----
  function viewMuster() {
    var q = S.musterQueue[0];
    var h = '<div class="step-h">Disposition</div>' +
      '<div class="step-eo">Dispono</div>';
    if (!q) return h + '<div class="btn-row"><span></span><button class="btn" onclick="A.go(\'package\')">Continue &rarr;</button></div>';
    var dm = X.benefitDM(S);
    h += '<div class="step-p">Leaving <b>' + esc(DATA.careers[q.career].name) + '</b> after ' + q.terms +
      ' term' + (q.terms === 1 ? '' : 's') + '. <b>' + q.rolls + '</b> roll' + (q.rolls === 1 ? '' : 's') + ' left.</div>';
    h += '<div class="panel"><div class="panel-t">Cash ' + lv(S.cash) + ' &middot; cash rolls ' + S.cashRollsUsed + ' / 3' +
      (dm ? ' &middot; benefit DM ' + sign(dm) : '') + '</div>' +
      '<div class="opt' + (S.cashRollsUsed >= 3 ? ' disabled' : '') + '" onclick="A.benefit(true)"><div class="opt-box"></div><div>' +
      '<div class="opt-n">Roll on the Cash column</div><div class="opt-d">Three per lifetime, across every career. Values are Livres.</div></div></div>' +
      '<div class="opt" onclick="A.benefit(false)"><div class="opt-box"></div><div>' +
      '<div class="opt-n">Roll on the Benefits column</div><div class="opt-d">' +
      (S.path === 'Soft' ? 'Soft Path: equipment may be swapped for a Neo companion.' : 'Equipment, ship shares and characteristic increases.') +
      '</div></div></div></div>';
    if (S.benefits.length) {
      h += '<div class="panel"><div class="panel-t">Taken</div><div class="skills-list">' +
        S.benefits.map(function (b) { return '<div class="sk"><span>' + esc(b) + '</span></div>'; }).join('') + '</div></div>';
    }
    return h;
  }

  // ---- skill package ----
  function viewPackage() {
    var P = DATA.packages2300.packages;
    var h = '<div class="step-h">Declaration</div>' +
      '<div class="step-eo">Deklaracio</div>' +
      '<div class="step-p">A group picks <b>one</b> package between them after everyone is created, then takes turns claiming skills from it.</div>' +
      '<div class="note">Written as a group rule with no solo split, so nothing is granted automatically. Pick the package your table agreed on and tick what you claimed.</div>' +
      '<div class="panel"><div class="panel-t">Package</div>';
    Object.keys(P).forEach(function (k) {
      h += '<div class="opt' + (S.pkg === k ? ' on' : '') + '" onclick="A.pkg(\'' + esc(k).replace(/'/g, "\\'") + '\')">' +
        '<div class="opt-box">' + (S.pkg === k ? '&#10003;' : '') + '</div><div>' +
        '<div class="opt-n">' + esc(k) + '</div><div class="opt-d">' + esc(P[k].desc) + '</div></div></div>';
    });
    h += '</div>';
    if (S.pkg) {
      h += '<div class="panel"><div class="panel-t">Claim your share</div><div class="skills-list">' +
        P[S.pkg].skills.map(function (sk, i) {
          var on = S.pkgTaken.indexOf(i) >= 0;
          return '<div class="opt' + (on ? ' on' : '') + '" onclick="A.pkgTake(' + i + ')">' +
            '<div class="opt-box">' + (on ? '&#10003;' : '') + '</div><div class="opt-n">' + esc(sk) + '</div></div>';
        }).join('') + '</div></div>';
    }
    return h + '<div class="btn-row"><span></span><button class="btn" onclick="A.finish()">Finish &rarr;</button></div>';
  }

  // ---- dossier ----
  function viewDossier() {
    var h = '<div class="step-h">' + esc(S.name || 'Unnamed Traveller') + '</div>' +
      '<div class="step-p">Age ' + S.age + ' &middot; ' + S.terms.length + ' term' + (S.terms.length === 1 ? '' : 's') +
      ' &middot; ' + esc(S.nat) + ' &middot; ' + esc(S.origin.name) + '</div>';
    if (S.crisis) h += '<div class="note"><b>Ageing crisis.</b> A characteristic reached zero.</div>';
    h += '<div class="panel"><div class="panel-t">Origin</div><div class="grid2"><div>' +
      '<div class="sk"><span>Homeworld</span><span class="sk-v">' + esc(S.origin.name) + '</span></div>' +
      '<div class="sk"><span>Gravity</span><span class="sk-v">' + esc(S.gravityBand) + '</span></div></div><div>' +
      '<div class="sk"><span>Path</span><span class="sk-v">' + esc(S.isSpacer ? 'Spacer' : S.path) + '</span></div>' +
      '<div class="sk"><span>Left home</span><span class="sk-v">' + (S.leftHome ? 'term ' + S.leftHomeAt : 'never') + '</span></div>' +
      '</div></div></div>';
    h += charsPanel() + historyHTML() + skillsPanel();
    h += '<div class="panel"><div class="panel-t">Finances</div><div class="grid2"><div>' +
      '<div class="sk"><span>Cash</span><span class="sk-v">' + lv(S.cash) + '</span></div>' +
      '<div class="sk"><span>Ship shares</span><span class="sk-v">' + S.shipShares + '</span></div></div><div>' +
      '<div class="sk"><span>Pension</span><span class="sk-v">' + lv(S.pension) + '/yr</span></div></div></div>' +
      (S.benefits.length ? '<div class="skills-list" style="margin-top:10px">' +
        S.benefits.map(function (b) { return '<div class="sk"><span>' + esc(b) + '</span></div>'; }).join('') + '</div>' : '') + '</div>';
    return h + '<div class="btn-row"><button class="btn ghost" onclick="A.restart()">Start over</button>' +
      '<button class="btn ghost" onclick="A.exportJson()">Download character JSON</button>' +
      '<button class="btn" onclick="window.print()">Print sheet</button></div>';
  }

  function f(label, val) {
    return '<div class="ps-f"><div class="ps-fl">' + esc(label) + '</div><div class="ps-fv">' + esc(val) + '</div></div>';
  }
  function printSheet() {
    var skills = Object.keys(S.skills).sort();
    var h = '<div id="printsheet"><div class="ps">';
    h += '<div class="ps-top"><div class="ps-title">2300AD</div><div class="ps-sub">CHARACTER RECORD</div></div>';
    h += '<div class="ps-box"><div class="ps-2"><div>' +
      f('Name', S.name) + f('Nationality', S.nat) + f('Homeworld', S.origin ? S.origin.name : '') + '</div><div>' +
      f('Age', S.age) + f('Path', S.isSpacer ? 'Spacer' : S.path) + f('Gravity', S.gravityBand) + '</div></div></div>';
    h += '<div class="ps-band">Characteristics</div><div class="ps-box"><div class="ps-ch">' +
      E.CHARS.map(function (k) {
        return '<div><div class="k">' + k + '</div><div class="v">' + S.chars[k] + '</div><div class="d">DM ' + sign(E.dm(S.chars[k])) + '</div></div>';
      }).join('') + '</div></div>';
    h += '<div class="ps-band">Skills</div><div class="ps-box"><div class="ps-sk">' +
      (skills.length ? skills.map(function (k) {
        return '<div><span>' + esc(X.swapSkill(k)) + '</span><span>' + S.skills[k] + '</span></div>';
      }).join('') : '<div>&mdash;</div>') + '</div></div>';
    h += '<div class="ps-band">Career history</div><div class="ps-box"><table class="ps-hist">' +
      '<tr><th>Term</th><th>Career</th><th>Assignment</th><th>Rank</th><th>Left</th></tr>' +
      S.terms.map(function (t, i) {
        var c = DATA.careers[t.career];
        return '<tr><td>' + (i + 1) + '</td><td>' + esc(c.name) + '</td><td>' +
          esc(E.findAssignment(c, t.assignment).name) + '</td><td>' +
          (t.commissioned ? 'Officer ' + t.officerRank : t.rank) + '</td><td>' + esc(t.leftBecause || '') + '</td></tr>';
      }).join('') + '</table></div>';
    h += '<div class="ps-band">Finances</div><div class="ps-box"><div class="ps-2"><div>' +
      f('Cash', lv(S.cash)) + f('Ship shares', S.shipShares) + '</div><div>' +
      f('Pension', lv(S.pension) + '/yr') + f('Benefits', S.benefits.join(', ')) + '</div></div></div>';
    h += '<div class="ps-foot">2300AD and Traveller are trade marks of Mongoose Publishing Ltd. ' +
      'This is an unofficial, fan-made character generator, not affiliated with or endorsed by the rights holders. ' +
      'All game rules and content remain the property of their respective owners.</div>';
    return h + '</div></div>';
  }

  // ---------------- actions ----------------
  var A = {};
  A.set = function (k, v) { S[k] = v; };
  // Photograph a gated section the first time it is finished with, whatever route got
  // there. This must NOT live only in A.go: the randomiser builds a whole character
  // without ever calling it, and a record built that way would offer "amend this
  // section" with nothing behind it -- the button would restore nothing and the warning
  // would claim it discards nothing.
  function snapGate(phase) {
    if (GATED.indexOf(phase) >= 0 && !S.snaps[phase]) S.snaps[phase] = E.snapshot(S);
  }

  A.go = function (p) {
    // The engine's snapshot carries the RNG position too, so a restored record replays
    // identically rather than quietly re-rolling what came after.
    snapGate(S.phase);
    if (p === 'terms' && !S.sub) S.sub = 'pick';
    S.phase = p; S.readOnly = false; S.confirmUnlock = null;
    render();
  };
  A.nav = function (p) {
    if (!reached(p)) return;
    S.phase = p;
    S.confirmUnlock = null;
    S.readOnly = isGated(p);
    if (p === 'terms' && !S.sub) S.sub = 'pick';
    render();
  };
  A.askUnlock = function (p) { S.confirmUnlock = p; render(); };
  A.cancelUnlock = function () { S.confirmUnlock = null; render(); };
  A.unlock = function (p) {
    var snap = S.snaps[p];
    if (!snap) return;
    E.restore(S, snap);
    S.phase = p; S.readOnly = false; S.confirmUnlock = null; S.sub = null;
    lastView = null;
    render();
  };
  A.toggleSb = function () {
    var el = document.getElementById('sidebar');
    if (el) el.classList.toggle('open');
  };
  A.__peek = function () { return S; };
  A.restart = function () { fresh(); lastView = null; render(); };

  A.exportJson = function () {
    var doc = E.exportCharacter(S);
    var blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    var safe = (S.name || '2300ad-character').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (safe || '2300ad-character') + '.2300ad.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  };
  function rollName() {
    var N = DATA.names, a = N[Math.floor(S.rng.next() * N.length)], b = a;
    for (var i = 0; i < 8 && b === a; i++) b = N[Math.floor(S.rng.next() * N.length)];
    return a + ' ' + b;
  }
  A.randName = function () {
    S.name = rollName();
    var el = document.querySelector('.name-inp'); if (el) el.value = S.name;
  };
  A.pickNat = function (n) { S.nat = n; S.origin = null; render(); };
  A.pickHome = function (name) {
    var homes = X.homeworldsFor(DATA, S.nat, 'any');
    for (var i = 0; i < homes.length; i++) if (homes[i].name === name) {
      E.rollCharacteristics(S);          // reroll so the gravity adjustment lands on fresh dice
      S.charSources = {};                // the reroll invalidates any provenance recorded so far
      tracked('homeworld gravity', function () { return X.setOrigin(S, homes[i]); });
      break;
    }
    render();
  };
  A.reroll = function () {
    E.rollCharacteristics(S);
    S.charSources = {}; S.skillSources = {};   // fresh dice, so the old audit trail is void
    tracked('homeworld gravity', function () {
      return X.applyGravity(S, X.GRAV.filter(function (b) { return b.type === S.gravityBand; })[0]);
    });
    S.bgPicked = []; S.skills = {};
    render();
  };
  A.bg = function (sk) {
    var n = Math.max(0, E.dm(S.chars.EDU) + 3), i = S.bgPicked.indexOf(sk);
    if (i >= 0) { S.bgPicked.splice(i, 1); delete S.skills[sk]; }
    else if (S.bgPicked.length < n) { S.bgPicked.push(sk); S.skills[sk] = 0; }
    render();
  };
  A.educate = function (where) {
    var log = [], mod = X.educationDM(S, where);
    var r = S.rng.d2(), tot = r + E.dm(S.chars.EDU) + mod;
    var ok = tot >= 6;
    log.push({ v: tot, t: (where === 'offworld' ? 'Off-world' : 'Homeworld') + ' entry, EDU 6+ with DM ' + sign(mod) + ': ' + (ok ? 'accepted' : 'rejected'), cls: ok ? 'good' : 'bad' });
    if (ok) {
      tracked('certification', function () { return E.bumpChar(S, 'EDU', 1, S.log); });
      if (where === 'offworld') { S.offworldEducated = true; log.push({ v: '!', t: 'Off-world study costs DM-1 on every Benefit roll later.', cls: 'bad' }); }
      var g = S.rng.d2() + E.dm(S.chars.INT), grad = g >= 6;
      log.push({ v: g, t: 'Graduation, INT 6+: ' + (grad ? 'graduated' : 'failed'), cls: grad ? 'good' : 'bad' });
      if (grad) tracked('graduation', function () { return E.bumpChar(S, 'EDU', 1, S.log); });
    }
    S.education = { type: where === 'offworld' ? 'Off-world education' : 'Homeworld education', entered: ok, log: log };
    S.age += 4;
    render();
  };
  A.pickCareer = function (k) { S.pendingCareer = k; render(); };
  A.pickAssignment = function (a) {
    var k = S.pendingCareer;
    S.termLog = [];
    var q = E.qualify(S, k, a);
    var entryDM = X.careerEntryDM(S, k);
    if (q.auto) S.termLog.push({ v: '--', t: 'Qualification: automatic', cls: 'good' });
    else S.termLog.push({ v: q.total + entryDM, t: 'Qualification ' + DATA.careers[k].qualification.check +
      (entryDM ? ' (DM' + sign(entryDM) + ')' : '') + ': ' + (q.ok ? 'accepted' : 'rejected'), cls: q.ok ? 'good' : 'bad' });
    if (!q.ok) { k = 'drifter'; a = DATA.careers[k].assignments[0].key; S.termLog.push({ v: '--', t: 'You drift.', cls: 'bad' }); }
    tracked(termLabel() + ' basic training', function () { return E.enterCareer(S, k, a); });
    S.pendingCareer = null; S.sub = 'train';
    render();
  };
  A.train = function (tableKey) {
    var r = tracked(termLabel() + ' training', function () { return E.rollSkillTable(S, tableKey); });
    S.termLog.push({ v: r.roll, t: 'Training: ' + X.swapSkill(r.entry) });
    var sv = E.survival(S), dm = X.survivalDM(S);
    var target = E.parseCheck(E.findAssignment(DATA.careers[S.current.career], S.current.assignment).survival).target;
    var total = sv.total + dm, okay = sv.roll !== 2 && total >= target;
    S.termLog.push({ v: total, t: 'Survival ' + sv.check + (dm ? ' (homeworld DM ' + sign(dm) + ')' : '') + ': ' +
      (okay ? 'survived' : (sv.roll === 2 ? 'natural 2 -- automatic failure' : 'failed')), cls: okay ? 'good' : 'bad' });
    if (!okay) {
      var c = DATA.careers[S.current.career], mr = S.rng.d6();
      S.termLog.push({ v: mr, t: 'Mishap: ' + c.mishaps[mr - 1].text, cls: 'bad' });
      S.current.lostBenefit = true; S.current.leftBecause = 'mishap';
      S.sub = 'ejected'; render(); return;
    }
    var ev = S.rng.d2();
    S.termLog.push({ v: ev, t: 'Event: ' + DATA.careers[S.current.career].events[ev - 2].text });
    var ad = E.advancement(S);
    S.termLog.push({ v: ad.total, t: 'Advancement ' + ad.check + ': ' + (ad.ok ? 'promoted' : 'passed over'), cls: ad.ok ? 'good' : '' });
    if (ad.ok) {
      S.current.rank = Math.min(6, S.current.rank + 1);
      tracked(termLabel() + ' promotion', function () { return E.rankBonus(S); });
    }
    S.mustLeave = ad.mustLeave;
    S.sub = 'continue';
    render();
  };
  A.another = function (yes) {
    S.age += 4;
    S.terms.push(S.current);
    var closed = S.current; S.current = null;
    if (!S.leftHome) {
      var lh = X.leavingHome(S, closed.career, S.careerTermCount[closed.career]);
      S.termLog.push({ v: lh.total, t: 'Leaving home, 2D 8+ with DM ' + sign(lh.dm) + ': ' +
        (lh.ok ? 'you leave ' + S.origin.name : 'still home'), cls: lh.ok ? 'good' : '' });
      if (lh.ok) { S.leftHome = true; S.leftHomeAt = S.terms.length; }
    }
    if (X.ageingDue(S)) {
      var ag = E.ageingRoll(S);
      if (E.applyAgeing(S, ag.effect).crisis) S.crisis = true;
    }
    if (yes && !closed.leftBecause) {
      S.current = { career: closed.career, assignment: closed.assignment, rank: closed.rank,
        commissioned: closed.commissioned, officerRank: closed.officerRank,
        termNo: S.terms.length + 1, age: S.age, skillRolls: [], events: [], leftBecause: null };
      S.careerTermCount[closed.career]++;
      S.termLog = []; S.sub = 'train';
    } else {
      closed.leftBecause = closed.leftBecause || 'left';
      var served = S.careerTermCount[closed.career];
      var mo = E.musterOut(S, closed.career, served, Math.max(closed.rank, closed.officerRank));
      var rolls = mo.rolls - (closed.lostBenefit ? 1 : 0);
      S.pension += E.pensionFor(S, closed.career, served);
      if (rolls > 0) S.musterQueue.push({ career: closed.career, terms: served, rolls: rolls, rankDM: mo.rankDM });
      S.phase = 'muster'; S.sub = 'pick';
    }
    render();
  };
  A.benefit = function (wantCash) {
    var q = S.musterQueue[0]; if (!q) return;
    if (wantCash && S.cashRollsUsed >= 3) return;
    E.takeBenefit(S, q.career, wantCash, (q.rankDM || 0) + X.benefitDM(S));
    if (--q.rolls <= 0) S.musterQueue.shift();
    if (!S.musterQueue.length) { S.phase = 'terms'; S.sub = 'pick'; }
    render();
  };
  A.pkg = function (k) { S.pkg = k; S.pkgTaken = []; render(); };
  A.pkgTake = function (i) {
    var idx = S.pkgTaken.indexOf(i), sk = DATA.packages2300.packages[S.pkg].skills[i];
    if (idx >= 0) S.pkgTaken.splice(idx, 1);
    else { S.pkgTaken.push(i); E.applySkillEntry(S, sk, S.log); }
    render();
  };
  A.finish = function () { S.phase = 'done'; render(); };

  A.randomise = function () {
    fresh();
    var nats = X.nationalities(DATA);
    S.nat = nats[Math.floor(S.rng.next() * nats.length)];
    var homes = X.homeworldsFor(DATA, S.nat, 'any');
    A.pickHome(homes[Math.floor(S.rng.next() * homes.length)].name);
    S.name = rollName();
    snapGate('origin');
    snapGate('chars');
    var n = Math.max(0, E.dm(S.chars.EDU) + 3), pool = DATA.gravity.background_skills.list.slice();
    for (var i = 0; i < n && pool.length; i++) {
      var p = pool.splice(Math.floor(S.rng.next() * pool.length), 1)[0];
      S.bgPicked.push(p); S.skills[p] = 0;
    }
    // Snapshot the built sections in the same order a player would leave them, so a
    // randomised record can be amended exactly like a hand-filled one.
    snapGate('background');
    snapGate('education');
    var want = 2 + Math.floor(S.rng.next() * 3), guard = 0;
    S.phase = 'terms'; S.sub = 'pick';
    while (S.terms.length < want && guard++ < 40) {
      var opts = E.careerOptions(S).filter(function (k) { return !X.careerBlockedFirstTerm(S, k); });
      var k = opts[Math.floor(S.rng.next() * opts.length)];
      S.pendingCareer = k;
      A.pickAssignment(DATA.careers[k].assignments[Math.floor(S.rng.next() * 3)].key);
      if (S.sub === 'ejected') { A.another(false); flush(); continue; }
      var tabs = E.availableSkillTables(S);
      A.train(tabs[Math.floor(S.rng.next() * tabs.length)].key);
      if (S.sub === 'ejected') { A.another(false); flush(); continue; }
      A.another(false);
      flush();
    }
    flush();
    S.phase = 'done';
    render();
  };
  function flush() { var g = 0; while (S.musterQueue.length && g++ < 60) A.benefit(S.cashRollsUsed < 3 && S.rng.next() < 0.4); }

  window.A = A;
  window.setTheme = function (t) {
    if (t === 'light') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('ad2300_theme', t); } catch (e) {}
    syncTheme();
  };
  function syncTheme() {
    var t = document.documentElement.getAttribute('data-theme') || 'light';
    var b = document.querySelectorAll('.tt-btn');
    for (var i = 0; i < b.length; i++) b[i].classList.toggle('active', b[i].getAttribute('data-tv') === t);
  }
  window.addEventListener('DOMContentLoaded', function () {
    main = document.getElementById('main'); track = document.getElementById('track');
    sidebar = document.getElementById('sidebar');
    fresh(); render(); syncTheme();
  });
})();
