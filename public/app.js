// Browser side. Plain fetch + polling, no frameworks.
const $ = (id) => document.getElementById(id);
const textEl = $('text'), idemBtn = $('idem');
const ASSUMED_AI_MS = 3000; // only used to draw the progress bar

// ---------- The idempotency key ----------
// One key = one user intent ("analyze THIS text"). Clicking twice for the same
// intent must send the SAME key, so we keep it until the intent changes
// (text edited, or "Use a new key" pressed).
const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random());
let currentKey = newKey();
const idemOn = () => idemBtn.getAttribute('aria-checked') === 'true';

function refreshMode() {
  const on = idemOn();
  document.body.dataset.idem = on ? 'on' : 'off';
  $('idemState').textContent = on ? 'on' : 'off';
  $('idemDesc').textContent = on
    ? 'Repeat requests with the same key return the job that already exists.'
    : 'Every request creates a new job, even an exact repeat.';
  $('modePillText').textContent = on ? 'Protected by idempotency' : 'Unprotected';
  $('keyBox').textContent = on ? currentKey : 'not sent';
}
idemBtn.addEventListener('click', () => { idemBtn.setAttribute('aria-checked', String(!idemOn())); refreshMode(); });
textEl.addEventListener('input', () => { currentKey = newKey(); refreshMode(); });
$('newKey').addEventListener('click', () => { currentKey = newKey(); refreshMode(); });

// ---------- Sending a request ----------
// The button is NOT disabled while a request is in flight. That is on purpose:
// we want to be able to double-click and see the problem.
async function sendRequest() {
  const headers = { 'Content-Type': 'application/json' };
  if (idemOn()) headers['Idempotency-Key'] = currentKey; // <- the only difference
  const res = await fetch('/api/analyze', { method: 'POST', headers, body: JSON.stringify({ text: textEl.value }) });
  const data = await res.json();
  return res.ok ? data : { error: data.error };
}

// ---------- Pipeline animation ----------
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const stations = [...document.querySelectorAll('.station')];
const light = (i) => { stations[i]?.classList.add('lit'); setTimeout(() => stations[i]?.classList.remove('lit'), 500); };

// Sends a packet to the API, waits for the server's answer, then either
// continues down the pipeline (new job) or turns back (replayed request).
async function sendWithAnimation() {
  const el = document.createElement('div');
  el.className = 'packet';
  $('packets').appendChild(el);
  const d = reduceMotion ? 0 : 1;
  const move = (to, ms) => el.animate([{ left: getComputedStyle(el).left }, { left: to }], { duration: ms * d, fill: 'forwards', easing: 'ease-in-out' }).finished;

  const toApi = move('25%', 450);
  const [reply] = await Promise.all([sendRequest(), toApi]);
  light(1);
  if (reply.error) { el.remove(); return reply; }

  if (reply.replayed) {
    el.classList.add('replay');
    await move('0%', 450);
  } else {
    light(2);
    await move('100%', 1100);
    light(4);
  }
  el.remove();
  return reply;
}

// ---------- Buttons ----------
function say(text, kind = '') { const m = $('msg'); m.textContent = text; m.className = 'status ' + kind; }

$('analyze').addEventListener('click', async () => {
  light(0);
  const r = await sendWithAnimation();
  if (r.error) return say(r.error, 'bad');
  say(r.replayed ? `Same request again: returned ${r.job.id}, no new job.` : `Created ${r.job.id}.`, r.replayed ? 'good' : '');
  load();
});

// Two requests at the same moment = a very fast double-click.
$('twice').addEventListener('click', async () => {
  light(0);
  const [a, b] = await Promise.all([sendWithAnimation(), sendWithAnimation()]);
  if (a.error || b.error) return say(a.error || b.error, 'bad');
  if (a.job.id === b.job.id) say(`Both requests got ${a.job.id}. Only one job exists.`, 'good');
  else say(`Got ${a.job.id} and ${b.job.id}. Same text, two jobs: a duplicate.`, 'bad');
  load();
});

$('reset').addEventListener('click', async () => {
  await fetch('/api/reset', { method: 'POST' });
  currentKey = newKey(); refreshMode(); seen.clear();
  say('Cleared. Start again with a single click.');
  load();
});

// ---------- Showing results ----------
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const seen = new Set(); // job ids already drawn, so only new rows get the highlight

// A job is a "duplicate" if an earlier job has the same text and was created within 5 seconds.
function findDuplicates(jobs) {
  const dupOf = {};
  const oldestFirst = [...jobs].reverse();
  oldestFirst.forEach((j, i) => {
    const original = oldestFirst.slice(0, i).find((o) => o.text === j.text && Math.abs(new Date(j.createdAt) - new Date(o.createdAt)) < 5000);
    if (original) dupOf[j.id] = original.id;
  });
  return dupOf;
}

function renderJob(j, dupOf) {
  const progress = j.status === 'done' ? 100 : Math.min(92, ((Date.now() - new Date(j.createdAt)) / ASSUMED_AI_MS) * 100);
  const fresh = !seen.has(j.id); seen.add(j.id);
  const res = j.result
    ? `<b>${j.result.sentiment}</b>, ${j.result.wordCount} words<small>${esc(j.result.summary)}</small>`
    : `<small>Mock AI is thinking...</small><div class="bar"><i style="width:${progress}%"></i></div>`;
  return `
    <div class="job ${j.status} ${dupOf[j.id] ? 'dup' : ''} ${fresh ? 'fresh' : ''}">
      <div class="stripe"></div>
      <div><div class="job-id">${j.id}</div><div class="job-text" title="${esc(j.text)}">${esc(j.text)}</div></div>
      <div><span class="badge ${j.status}">${j.status === 'done' ? 'Done' : 'Running'}</span>${dupOf[j.id] ? `<span class="badge dupe">Duplicate of ${dupOf[j.id]}</span>` : ''}</div>
      <div class="result">${res}</div>
      <div class="meta">${clock(j.createdAt)}<small>${j.idempotencyKey ? 'key <code>' + esc(j.idempotencyKey.slice(0, 8)) + '</code>' : 'no key'}</small></div>
    </div>`;
}

async function load() {
  const { jobs, stats } = await (await fetch('/api/jobs')).json();
  $('sReq').textContent = stats.requestsReceived;
  $('sJobs').textContent = stats.jobsCreated;
  $('sRep').textContent = stats.replays;
  $('sAi').textContent = stats.aiRuns;
  $('jobCount').textContent = `${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'}`;

  const dupOf = findDuplicates(jobs);
  const dupCount = Object.keys(dupOf).length;
  const v = $('verdictText');
  if (!stats.requestsReceived) { v.textContent = 'Nothing sent yet.'; v.className = 'verdict-text'; }
  else if (dupCount) { v.textContent = `${dupCount} duplicate ${dupCount === 1 ? 'job' : 'jobs'}: you paid for ${dupCount} extra AI ${dupCount === 1 ? 'run' : 'runs'}.`; v.className = 'verdict-text bad'; }
  else if (stats.replays) { v.textContent = `${stats.replays} repeat ${stats.replays === 1 ? 'request was' : 'requests were'} caught. No duplicate work.`; v.className = 'verdict-text good'; }
  else { v.textContent = 'One request, one job. Now try sending it twice.'; v.className = 'verdict-text'; }

  $('jobs').innerHTML = jobs.length
    ? jobs.map((j) => renderJob(j, dupOf)).join('')
    : '<div class="empty">No jobs yet. Press Analyze to create the first one.</div>';
}

refreshMode();
load();
setInterval(load, 800); // poll so "Running" turns into "Done"
