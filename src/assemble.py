# Assemble src/* into a single self-contained index.html.
# ASCII-only output; no external requests; no build step at deploy time.
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
D = os.path.join(HERE, 'data')

def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()

def jload(p):
    with open(p, encoding='utf-8') as f:
        return json.load(f)

# Traveller careers, with the 2300AD Drifter replacing Traveller's
careers = {}
for fn in sorted(os.listdir(os.path.join(D, 'careers-traveller'))):
    if fn.endswith('.json'):
        c = jload(os.path.join(D, 'careers-traveller', fn))
        careers[c['key']] = c
drifter = jload(os.path.join(D, 'careers', 'drifter-2300ad.json'))
careers[drifter['key']] = drifter
assert 'drifter' in careers and any(a['key'] == 'freelancer' for a in careers['drifter']['assignments']), \
    'the 2300AD Drifter (with Freelancer) did not replace the Traveller one'

DATA = {
    'core': jload(os.path.join(D, 'core-rules.json')),
    'loop': jload(os.path.join(D, 'term-loop.json')),
    'muster': jload(os.path.join(D, 'mustering-out.json')),
    'colonies': jload(os.path.join(D, 'colonies.json')),
    'outposts': jload(os.path.join(D, 'outposts.json')),
    'worlds': jload(os.path.join(D, 'worlds.json')),
    'gravity': jload(os.path.join(D, 'gravity-and-background.json')),
    'origin': jload(os.path.join(D, 'origin-rules.json')),
    'packages2300': jload(os.path.join(D, 'skill-packages.json')),
    'names': jload(os.path.join(D, 'names.json'))['names'],
    'careers': careers,
}

css = read(os.path.join(HERE, 'styles.css'))
engine = read(os.path.join(HERE, 'engine.js'))
overlay = read(os.path.join(HERE, 'overlay.js'))
app = read(os.path.join(HERE, 'app.js'))
data_js = json.dumps(DATA, ensure_ascii=True, separators=(',', ':'))

HTML = """<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>2300AD -- Character Generator</title>
<meta name="description" content="An unofficial character generator for 2300AD, the Mongoose Traveller science fiction setting.">
<style>
%CSS%
</style>
<script>/* apply saved theme before paint to avoid a flash */(function(){try{if(localStorage.getItem('ad2300_theme')==='dark')document.documentElement.setAttribute('data-theme','dark');}catch(e){}})();</script>
</head><body>
<a class="backbar no-print" href="https://thetable.xerosumgames.com/">&larr; The Table</a>
<div class="hdr">
  <div class="theme-toggle" role="group" aria-label="Colour theme">
    <button class="tt-btn" data-tv="light" onclick="setTheme('light')">Light</button>
    <button class="tt-btn" data-tv="dark" onclick="setTheme('dark')">Dark</button>
  </div>
  <div class="hdr-title">2300AD</div>
  <div class="hdr-sub">Character Generator &middot; Mongoose Traveller</div>
  <button class="hdr-rand no-print" type="button" onclick="A.randomise()">&#9860; Randomise</button>
</div>
<div class="main">
  <div class="track" id="track"></div>
  <div id="main"></div>
</div>
<div class="footer no-print" style="text-align:center;padding:26px 16px;font-size:12px;color:#8d897c;line-height:1.6">
  <b>2300AD -- Character Generator.</b> An unofficial fan tool.<br>
  2300AD and Traveller are trade marks of Mongoose Publishing Ltd. Traveller (c)2024 Mongoose Publishing Ltd.
  This is an unofficial, fan-made character generator, not affiliated with or endorsed by the rights holders.
  All game rules and content remain the property of their respective owners.
</div>
<script>var DATA=%DATA%;</script>
<script>
%ENGINE%
</script>
<script>
%OVERLAY%
</script>
<script>
%APP%
</script>
<script>
/* Visit beacon -> log-visit edge function. Static page, so the site-wide VisitLogger
   never fires here; this sends page='/2300ad-generator'. Respects the owner opt-out
   (localStorage tapestry_no_log = '1'). */
(function () {
  try {
    if (localStorage.getItem('tapestry_no_log') === '1') return;
    var ck = function (n) { var m = document.cookie.match('(^|; )' + n + '=([^;]*)'); return m ? decodeURIComponent(m[2]) : null; };
    var sid = localStorage.getItem('tapestry_session_id');
    if (!sid) { sid = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()); localStorage.setItem('tapestry_session_id', sid); }
    var lat = ck('geo_lat'), lng = ck('geo_lng');
    var send = function (ipHash) {
      fetch('https://jbudzglgtxeoaufpejrv.supabase.co/functions/v1/log-visit', {
        method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: String(sid).slice(0, 64),
          page: '/2300ad-generator',
          referrer: document.referrer || null,
          country_code: ck('geo_country'), region: ck('geo_region'), city: ck('geo_city'),
          latitude: lat ? parseFloat(lat) : null, longitude: lng ? parseFloat(lng) : null,
          ip_hash: ipHash
        })
      }).catch(function () {});
    };
    var rawIP = ck('geo_ip');
    if (rawIP && crypto.subtle) {
      crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawIP)).then(function (buf) {
        send(Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join(''));
      }).catch(function () { send(null); });
    } else { send(null); }
  } catch (e) {}
})();
</script>
<!-- Report an issue (Xero Sum Games) -->
<div class="no-print" style="text-align:center;padding:28px 16px 40px;">
  <button type="button" id="xsg-ri-open" style="background:#16161a;border:1px solid #3a3a42;color:#e8e5dd;font:600 14px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;padding:10px 20px;border-radius:9px;cursor:pointer;letter-spacing:.02em;">Report an issue</button>
</div>
<div id="xsg-ri-modal" style="display:none;position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.66);align-items:center;justify-content:center;padding:16px;">
  <div role="dialog" aria-modal="true" aria-label="Report an issue" style="background:#16161a;color:#f2efe6;max-width:440px;width:100%;border:1px solid #33333a;border-radius:14px;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.5);font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">
    <h3 style="margin:0 0 6px;font-size:19px;">Report an issue</h3>
    <p style="margin:0 0 14px;color:#a8a49a;font-size:14px;">Spotted a bug or something off? Tell us what happened.</p>
    <form id="xsg-ri-form">
      <textarea id="xsg-ri-msg" required rows="4" placeholder="What went wrong?" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #3a3a42;border-radius:9px;background:#0e0e10;color:#f2efe6;font:inherit;font-size:15px;resize:vertical;"></textarea>
      <input id="xsg-ri-email" type="email" placeholder="Your email (optional - so we can reply with a fix)" style="width:100%;box-sizing:border-box;margin-top:10px;padding:10px;border:1px solid #3a3a42;border-radius:9px;background:#0e0e10;color:#f2efe6;font:inherit;font-size:15px;" />
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
        <button type="button" id="xsg-ri-cancel" style="padding:9px 16px;border:1px solid #3a3a42;border-radius:9px;background:transparent;color:#f2efe6;font:inherit;font-size:14px;cursor:pointer;">Cancel</button>
        <button type="submit" id="xsg-ri-send" style="padding:9px 18px;border:none;border-radius:9px;background:#c8a06a;color:#14130f;font:inherit;font-size:14px;font-weight:700;cursor:pointer;">Send report</button>
      </div>
      <p id="xsg-ri-status" style="margin:12px 0 0;font-size:14px;min-height:1em;"></p>
    </form>
  </div>
</div>
<script>
(function(){
  var SOURCE='2300ad-generator';
  var EP='https://jbudzglgtxeoaufpejrv.supabase.co/functions/v1/report-issue';
  var $=function(id){return document.getElementById(id);};
  var modal=$('xsg-ri-modal'),form=$('xsg-ri-form'),msg=$('xsg-ri-msg'),email=$('xsg-ri-email'),status=$('xsg-ri-status'),send=$('xsg-ri-send');
  function show(){modal.style.display='flex';setTimeout(function(){msg.focus();},40);}
  function hide(){modal.style.display='none';}
  $('xsg-ri-open').addEventListener('click',show);
  $('xsg-ri-cancel').addEventListener('click',hide);
  modal.addEventListener('click',function(e){if(e.target===modal)hide();});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&modal.style.display!=='none')hide();});
  form.addEventListener('submit',function(e){
    e.preventDefault();
    var m=msg.value.trim();if(!m)return;
    send.disabled=true;status.style.color='#a8a49a';status.textContent='Sending...';
    fetch(EP,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:SOURCE,message:m,email:(email.value.trim()||null),page_url:location.href})})
      .then(function(r){return r.json().catch(function(){return null;});})
      .then(function(d){
        if(d&&d.ok){status.style.color='#7fc458';status.textContent='Thanks - report sent!';form.reset();setTimeout(hide,1400);}
        else if(d&&d.error==='invalid_email'){status.style.color='#e07a5f';status.textContent='That email looks off - fix it or leave it blank.';}
        else{status.style.color='#e07a5f';status.textContent='Something went wrong. Please try again.';}
      })
      .catch(function(){status.style.color='#e07a5f';status.textContent='Something went wrong. Please try again.';})
      .finally(function(){send.disabled=false;});
  });
})();
</script>
</body></html>
"""

out = (HTML.replace('%CSS%', css)
           .replace('%DATA%', data_js)
           .replace('%ENGINE%', engine)
           .replace('%OVERLAY%', overlay)
           .replace('%APP%', app))

bad = [(i + 1, l) for i, l in enumerate(out.split('\n')) if any(ord(ch) > 127 for ch in l)]
if bad:
    print('NON-ASCII on %d line(s):' % len(bad))
    for n, l in bad[:10]:
        print('  %d: %s' % (n, l[:110]))
    sys.exit(1)

dest = os.path.join(ROOT, 'index.html')
with open(dest, 'w', encoding='ascii', newline='\n') as f:
    f.write(out)
print('wrote %s  (%d bytes)' % (dest, len(out)))
