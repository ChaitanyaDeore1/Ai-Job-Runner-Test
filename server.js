// =============================================================
// AI Job Runner - a tiny demo to learn IDEMPOTENCY
//
// Flow:  Browser -> API -> Job -> Mock AI -> Result
//
// Everything lives in memory. Restart the server = fresh start.
// =============================================================
const express = require('express');
const path = require('path');

const PORT = process.env.PORT || 3000;
// How long the fake "AI" thinks. Tests set this lower so they run fast.
const JOB_DELAY_MS = Number(process.env.JOB_DELAY_MS ?? 3000);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- In-memory "database" ----------
const jobs = [];                       // every job we ever created
const idempotencyStore = new Map();    // Idempotency-Key -> { jobId, text }
let nextId = 1;
let generation = 0; // bumps on reset so old, still-running jobs can't touch the fresh state
const stats = {
  requestsReceived: 0, // every POST /api/analyze that reached the server
  jobsCreated: 0,      // how many jobs were actually created
  replays: 0,          // requests answered with an EXISTING job (idempotency saved us)
  aiRuns: 0,           // how many times the (mock) AI finished work = the "cost"
};

// ---------- Mock AI ----------
// Pretends to be a slow, expensive AI call. No network, no API key.
function mockAI(text) {
  return new Promise((resolve) => {
    setTimeout(() => {
      const words = text.split(/\s+/).filter(Boolean);
      const positive = /(good|great|love|happy|awesome|nice|excellent)/i.test(text);
      const negative = /(bad|hate|sad|terrible|awful|angry|broken)/i.test(text);
      resolve({
        wordCount: words.length,
        sentiment: positive && !negative ? 'positive' : negative && !positive ? 'negative' : 'neutral',
        summary: words.slice(0, 8).join(' ') + (words.length > 8 ? '...' : ''),
      });
    }, JOB_DELAY_MS);
  });
}

// ---------- Job ----------
// A job moves through: queued -> running -> done
function createJob(text, idempotencyKey) {
  const job = {
    id: `job-${nextId++}`,
    text,
    idempotencyKey: idempotencyKey || null,
    status: 'queued',
    result: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
  jobs.push(job);
  stats.jobsCreated++;

  // Run in the background so the API can answer immediately.
  job.status = 'running';
  const myGeneration = generation;
  mockAI(text).then((result) => {
    if (myGeneration !== generation) return; // a reset happened meanwhile - ignore
    job.result = result;
    job.status = 'done';
    job.finishedAt = new Date().toISOString();
    stats.aiRuns++;
  });

  return job;
}

// ---------- API ----------

// POST /api/analyze   body: { "text": "..." }
// Optional header:    Idempotency-Key: <any unique string>
app.post('/api/analyze', (req, res) => {
  stats.requestsReceived++;

  const text = String(req.body?.text ?? '').trim();
  if (!text) return res.status(400).json({ error: 'text is required' });

  const key = req.get('Idempotency-Key');

  // ===========================================================
  // THE IDEMPOTENCY SOLUTION (only runs if the client sent a key)
  //
  // Idea: "same key = same request". If we have already seen this
  // key, DON'T create a new job - just return the one we made before.
  //
  // Why this is safe here: Node runs this handler to completion before
  // starting the next request, so "check key -> create job -> save key"
  // can't be interleaved by another request. (With a real database you'd
  // need a UNIQUE constraint on the key to get the same guarantee.)
  // ===========================================================
  if (key) {
    const seen = idempotencyStore.get(key);
    if (seen) {
      // Same key but different body = client bug. Reject instead of guessing.
      if (seen.text !== text) {
        return res.status(422).json({ error: 'Idempotency-Key was already used with a different request' });
      }
      stats.replays++;
      res.set('Idempotent-Replay', 'true');
      const existingJob = jobs.find((j) => j.id === seen.jobId);
      return res.status(200).json({ job: existingJob, replayed: true });
    }
  }

  // No key (or a brand-new key): create a NEW job.
  const job = createJob(text, key);
  if (key) idempotencyStore.set(key, { jobId: job.id, text });

  res.status(201).json({ job, replayed: false });
});

// GET /api/jobs - the UI polls this to show all jobs + counters
app.get('/api/jobs', (req, res) => {
  res.json({ jobs: [...jobs].reverse(), stats });
});

// POST /api/reset - wipe everything (handy between experiments)
app.post('/api/reset', (req, res) => {
  jobs.length = 0;
  idempotencyStore.clear();
  nextId = 1;
  generation++;
  Object.keys(stats).forEach((k) => (stats[k] = 0));
  res.json({ ok: true });
});

// Export the app so test.js can use it; only listen when run directly.
module.exports = app;
if (require.main === module) {
  app.listen(PORT, () => console.log(`AI Job Runner running at http://localhost:${PORT}`));
}
