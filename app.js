import { KnownAgents } from "@knownagents/sdk"
import express from "express"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { readFileSync, readdirSync } from "fs"
import { marked } from "marked"
import matter from "gray-matter"
import { createClient } from "@libsql/client"
import { Resend } from "resend"
import crypto from "crypto"

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const knownAgents = new KnownAgents("522be957-6072-4069-b43c-fd6236e6ed10")
const resend = new Resend(process.env.RESEND_API_KEY)
const BASE_URL = process.env.BASE_URL || "https://polymorphtech.xyz"

// Database
const db = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
})
await db.execute(`CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  token TEXT UNIQUE NOT NULL,
  confirmed INTEGER DEFAULT 0,
  subscribed_at TEXT
)`)

app.use(express.json())
app.use(express.urlencoded({ extended: false }))

app.use((req, res, next) => {
  const start = Date.now()
  res.on("finish", () => {
    console.log(`[visit] ${req.method} ${req.url} ${res.statusCode}`)
    knownAgents.trackVisit(req, res, Date.now() - start)
  })
  next()
})

// Subscribe endpoint
app.post("/api/subscribe", async (req, res) => {
  const email = req.body.email?.trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Invalid email address" })
  }
  try {
    // Check if already subscribed
    const existing = await db.execute({ sql: "SELECT * FROM subscribers WHERE email = ?", args: [email] })
    if (existing.rows.length > 0) {
      if (existing.rows[0].confirmed) {
        return res.json({ ok: true, message: "already_subscribed" })
      }
      // Resend confirmation email
      await sendConfirmationEmail(email, existing.rows[0].token)
      return res.json({ ok: true, message: "confirmation_resent" })
    }

    const token = crypto.randomUUID()
    await db.execute({
      sql: "INSERT INTO subscribers (email, token, confirmed, subscribed_at) VALUES (?, ?, 0, datetime('now'))",
      args: [email, token]
    })
    await sendConfirmationEmail(email, token)
    res.json({ ok: true, message: "confirmation_sent" })
  } catch (err) {
    console.error("[subscribe error]", err.message)
    res.status(500).json({ error: "Something went wrong" })
  }
})

async function sendConfirmationEmail(email, token) {
  const confirmUrl = `${BASE_URL}/api/confirm?token=${token}`
  await resend.emails.send({
    from: "AI Radar <support@polymorphtech.xyz>",
    to: email,
    subject: "Confirm your subscription to AI Radar",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem;">
        <h2 style="margin-bottom: 1rem;">Confirm your subscription</h2>
        <p style="color: #555; line-height: 1.6;">Thanks for subscribing to the AI Radar blog. Click the button below to confirm your email address.</p>
        <a href="${confirmUrl}" style="display: inline-block; margin-top: 1rem; padding: 0.75rem 1.5rem; background: #111; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600;">Confirm subscription</a>
        <p style="margin-top: 2rem; font-size: 0.85rem; color: #999;">If you didn't subscribe, you can ignore this email.</p>
      </div>
    `
  })
}

// Confirm subscription
app.get("/api/confirm", async (req, res) => {
  const { token } = req.query
  if (!token) return res.status(400).send("Invalid link")

  try {
    const result = await db.execute({ sql: "UPDATE subscribers SET confirmed = 1 WHERE token = ? AND confirmed = 0", args: [token] })
    if (result.rowsAffected > 0) {
      res.send(simplePage("Subscription Confirmed", "<h1>You're subscribed!</h1><p>You'll receive new blog posts from AI Radar.</p>"))
    } else {
      res.send(simplePage("Already Confirmed", "<h1>Already confirmed</h1><p>Your subscription was already confirmed.</p>"))
    }
  } catch {
    res.status(500).send(simplePage("Error", "<h1>Something went wrong</h1><p>Please try again later.</p>"))
  }
})

// Unsubscribe
app.get("/api/unsubscribe", async (req, res) => {
  const { token } = req.query
  if (!token) return res.status(400).send("Invalid link")

  try {
    await db.execute({ sql: "DELETE FROM subscribers WHERE token = ?", args: [token] })
    res.send(simplePage("Unsubscribed", "<h1>You've been unsubscribed</h1><p>You won't receive any more emails from us. Sorry to see you go!</p>"))
  } catch {
    res.status(500).send(simplePage("Error", "<h1>Something went wrong</h1><p>Please try again later.</p>"))
  }
})

function simplePage(title, content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — AI Radar</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="stylesheet" href="/shared.css">
  <link rel="stylesheet" href="/airadar/airadar.css">
</head>
<body>
  <main>${content}</main>
  <script src="/nav.js"></script>
</body>
</html>`
}

// Blog helpers
const postsDir = join(__dirname, "blog", "posts")

function getAllPosts() {
  return readdirSync(postsDir)
    .filter(f => f.endsWith(".md"))
    .map(f => {
      const { data } = matter(readFileSync(join(postsDir, f), "utf-8"))
      return { slug: f.replace(".md", ""), ...data }
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))
}

const subscribeForm = `
  <div class="subscribe-box">
    <h3>Subscribe to the blog</h3>
    <p>Get new posts delivered to your inbox.</p>
    <form id="subscribeForm" class="subscribe-form">
      <input type="email" name="email" placeholder="you@example.com" required>
      <button type="submit">Subscribe</button>
    </form>
    <p id="subscribeMsg" class="subscribe-msg"></p>
  </div>
  <script>
    document.getElementById('subscribeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('subscribeMsg');
      const email = e.target.email.value;
      try {
        const res = await fetch('/api/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (data.ok) {
          if (data.message === 'already_subscribed') {
            msg.textContent = 'You are already subscribed!';
            msg.style.color = '#4a4';
          } else {
            msg.textContent = 'Check your email to confirm your subscription.';
            msg.style.color = '#4a4';
          }
          e.target.reset();
        } else {
          msg.textContent = data.error || 'Something went wrong';
          msg.style.color = '#a44';
        }
      } catch {
        msg.textContent = 'Something went wrong';
        msg.style.color = '#a44';
      }
    });
  </script>`

function blogLayout(title, content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — AI Radar</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="stylesheet" href="/shared.css">
  <link rel="stylesheet" href="/airadar/airadar.css">
  <style>
    .subscribe-box {
      margin-top: 3rem;
      padding: 1.5rem;
      border: 1px solid #222;
      border-radius: 6px;
      background: #161616;
    }
    .subscribe-box h3 {
      color: #ddd;
      font-size: 1rem;
      margin-bottom: 0.25rem;
    }
    .subscribe-box > p {
      font-size: 0.85rem;
      margin-bottom: 0.75rem;
    }
    .subscribe-form {
      display: flex;
      gap: 0.5rem;
    }
    .subscribe-form input {
      flex: 1;
      padding: 0.5rem 0.75rem;
      border: 1px solid #333;
      border-radius: 4px;
      background: #0f0f0f;
      color: #f0f0f0;
      font-size: 0.9rem;
    }
    .subscribe-form button {
      padding: 0.5rem 1rem;
      border: 1px solid #333;
      border-radius: 4px;
      background: #f0f0f0;
      color: #0f0f0f;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
    }
    .subscribe-form button:hover { background: #ddd; }
    .subscribe-msg { font-size: 0.85rem; margin-top: 0.5rem; }
    .post-meta { color: #666; font-size: 0.85rem; margin-bottom: 1.5rem; }
  </style>
</head>
<body>
  <main>${content}</main>
  <script src="/nav.js"></script>
</body>
</html>`
}

// Blog index
app.get("/airadar/blog", (_req, res) => {
  const posts = getAllPosts()
  const list = posts.map(p => `
    <div class="entry">
      <h2><a href="/airadar/blog/${p.slug}">${p.title}</a></h2>
      <span class="date">${p.date}${p.author ? ` · ${p.author}` : ""}</span>
      <p>${p.summary || ""}</p>
    </div>
  `).join("")

  res.send(blogLayout("Blog", `
    <h1>Blog</h1>
    <p class="subtitle">Insights on AI search optimization</p>
    ${list}
    ${subscribeForm}
  `))
})

// Blog post
app.get("/airadar/blog/:slug", (req, res) => {
  try {
    const file = readFileSync(join(postsDir, `${req.params.slug}.md`), "utf-8")
    const { data, content } = matter(file)
    const html = marked(content)

    const meta = [data.date, data.author].filter(Boolean).join(" · ")

    res.send(blogLayout(data.title, `
      <h1>${data.title}</h1>
      <p class="post-meta">${meta}</p>
      ${html}
      <p style="margin-top: 2rem;"><a href="/airadar/blog">← Back to blog</a></p>
      ${subscribeForm}
    `))
  } catch {
    res.status(404).send(blogLayout("Not Found", "<h1>Post not found</h1>"))
  }
})

// AI Radar sub-pages
app.get("/airadar/docs", (_req, res) => res.sendFile(join(__dirname, "public", "airadar", "docs.html")))
app.get("/airadar/tutorial", (_req, res) => res.sendFile(join(__dirname, "public", "airadar", "tutorial.html")))
app.get("/airadar/faq", (_req, res) => res.sendFile(join(__dirname, "public", "airadar", "faq.html")))
app.get("/airadar/changelog", (_req, res) => res.sendFile(join(__dirname, "public", "airadar", "changelog.html")))

app.get("/privacy", (_req, res) => res.sendFile(join(__dirname, "public", "privacy.html")))

app.use(express.static(join(__dirname, "public")))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Server running on port ${PORT}`))
