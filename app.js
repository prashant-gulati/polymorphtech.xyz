import { KnownAgents } from "@knownagents/sdk"
import express from "express"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { readFileSync, readdirSync } from "fs"
import { marked } from "marked"
import matter from "gray-matter"
import { createClient } from "@libsql/client"

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const knownAgents = new KnownAgents("522be957-6072-4069-b43c-fd6236e6ed10")

// Database
const db = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
})
await db.execute(`CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
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
    await db.execute({ sql: "INSERT OR IGNORE INTO subscribers (email, subscribed_at) VALUES (?, datetime('now'))", args: [email] })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: "Something went wrong" })
  }
})

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
          msg.textContent = 'Subscribed!';
          msg.style.color = '#4a4';
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
