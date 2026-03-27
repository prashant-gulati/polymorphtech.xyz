import { KnownAgents } from "@knownagents/sdk"
import express from "express"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

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

app.get("/privacy", (_req, res) => res.sendFile(join(__dirname, "public", "privacy.html")))

app.use(express.static(join(__dirname, "public")))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Server running on port ${PORT}`))
