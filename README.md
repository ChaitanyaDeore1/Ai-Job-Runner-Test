# AI Job Runner

A tiny demo to learn **idempotency**.

```
Browser -> API -> Job -> Mock AI -> Result
```

Only Node.js + Express + plain HTML/CSS/JS. Data is stored in memory (restart = clean slate). The "AI" is a fake 3-second delay - no API keys, no database.

## Run it

Needs Node.js 18 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000

## Try it in the browser (5 minutes)

**1. One click = one job**
Press **Analyze** once. One job appears, goes `running` then `done` (about 3 seconds).

**2. The problem: duplicate jobs**
Click **Clear all**. Keep **Idempotency OFF**. Press **Send twice, instantly**
(or double-click **Analyze** yourself).
You get **2 jobs** for the same text. The second job gets a red "Duplicate of job-1" badge, and the page border and toggle stay red. You paid for the AI twice.

**3. The fix: idempotency ON**
Click **Clear all**. Tick **Idempotency**. Press **Send twice, instantly** again.
You get **only 1 job**. The page turns green, and the panel says one repeat request was caught.

**4. New intent = new key**
Edit the text (or press **Use a new key**) and analyze again. That is a different request, so it creates a new job.

## Run the automated test

```bash
npm test
```

It starts the server on a free port, fires double requests, and checks:

| Test | Expected |
|---|---|
| 1 click, no key | 1 job |
| 2 fast clicks, no key | 2 jobs (the problem) |
| 2 fast clicks, same key | 1 job, same id (the fix) |
| retry after the job finished, same key | same job returned |
| 2 requests, different keys | 2 jobs |
| same key, different text | `422` error |

## Try it with curl

```bash
# No key: 2 jobs
curl -s -X POST localhost:3000/api/analyze -H 'Content-Type: application/json' -d '{"text":"hello"}'
curl -s -X POST localhost:3000/api/analyze -H 'Content-Type: application/json' -d '{"text":"hello"}'

# Same key: 1 job (second reply has "replayed": true)
curl -s -X POST localhost:3000/api/analyze -H 'Content-Type: application/json' -H 'Idempotency-Key: abc-123' -d '{"text":"hello"}'
curl -s -X POST localhost:3000/api/analyze -H 'Content-Type: application/json' -H 'Idempotency-Key: abc-123' -d '{"text":"hello"}'

curl -s localhost:3000/api/jobs
```

## How idempotency works here

- The browser makes one random **key** per intent ("analyze this text") and sends it in the `Idempotency-Key` header.
- The server keeps a `Map`: `key -> job id`.
- Request arrives: key already in the Map? Return the old job (HTTP 200, `replayed: true`). Otherwise create a job, save the key, return it (HTTP 201).
- Same key but different text? Rejected with 422, because that is a client bug.

The important code is in `server.js` (look for `THE IDEMPOTENCY SOLUTION`) and `public/app.js` (look for `The idempotency key`).

## Files

```
server.js         API, jobs, mock AI, idempotency logic
test.js           automated duplicate / idempotency test
public/index.html the page
public/app.js     browser logic
public/style.css  styling
```

## Honest limits (it's a learning demo)

- In-memory only: keys and jobs vanish on restart.
- A real system would store keys in a database with a UNIQUE constraint and expire old keys.
