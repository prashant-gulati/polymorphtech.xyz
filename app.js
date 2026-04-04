import { KnownAgents } from "@knownagents/sdk"
import express from "express"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { readFileSync, readdirSync } from "fs"
import { marked } from "marked"
import matter from "gray-matter"

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const knownAgents = new KnownAgents("522be957-6072-4069-b43c-fd6236e6ed10")

app.use((req, res, next) => {
  const start = Date.now()
  res.on("finish", () => {
    console.log(`[visit] ${req.method} ${req.url} ${res.statusCode}`)
    knownAgents.trackVisit(req, res, Date.now() - start)
  })
  next()
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
      <span class="date">${p.date}</span>
      <p>${p.summary || ""}</p>
    </div>
  `).join("")

  res.send(blogLayout("Blog", `
    <h1>Blog</h1>
    <p class="subtitle">Insights on AI search optimization</p>
    ${list}
  `))
})

// Blog post
app.get("/airadar/blog/:slug", (req, res) => {
  try {
    const file = readFileSync(join(postsDir, `${req.params.slug}.md`), "utf-8")
    const { data, content } = matter(file)
    const html = marked(content)

    res.send(blogLayout(data.title, `
      <h1>${data.title}</h1>
      <span class="date">${data.date}</span>
      ${html}
      <p style="margin-top: 2rem;"><a href="/airadar/blog">← Back to blog</a></p>
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
