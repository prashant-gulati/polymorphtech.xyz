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
import { XMLParser } from "fast-xml-parser"
import * as cheerio from "cheerio"

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
  subscribed_at TEXT,
  store_url TEXT DEFAULT "",
  helpfulness INTEGER DEFAULT 0
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

// Report analysis helpers
async function fetchText(url) {
  const res = await fetch(url)
  if (!res.ok) return null
  return res.text()
}

async function fetchJson(url) {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return res.json()
  } catch { return null }
}

async function checkExists(url) {
  try {
    const res = await fetch(url, { method: "HEAD" })
    return res.ok
  } catch { return false }
}

function analyzeHomepage(html, baseUrl) {
  const $ = cheerio.load(html)

  // Site Identity
  const siteName = $('meta[property="og:site_name"]').attr("content") || $("title").text().split("|")[0]?.trim() || ""
  const canonical = $('link[rel="canonical"]').attr("href") || baseUrl
  const faviconUrl = $('link[rel="icon"]').attr("href") || $('link[rel="shortcut icon"]').attr("href") || ""

  // Page Metadata
  const title = $("title").text().trim()
  const description = $('meta[name="description"]').attr("content") || ""
  const ogType = $('meta[property="og:type"]').attr("content") || ""
  const twitterCard = $('meta[name="twitter:card"]').attr("content") || ""
  const twitterTitle = $('meta[name="twitter:title"]').attr("content") || ""
  const twitterImage = $('meta[name="twitter:image"]').attr("content") || ""

  // Structured Data
  const structuredData = { Organization: false, WebSite: false, Product: false, FAQPage: false, Article: false }
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).html())
      const types = Array.isArray(json) ? json : [json]
      for (const item of types) {
        const t = item["@type"]
        if (t && t in structuredData) structuredData[t] = true
        // Handle @graph
        if (item["@graph"]) {
          for (const g of item["@graph"]) {
            if (g["@type"] && g["@type"] in structuredData) structuredData[g["@type"]] = true
          }
        }
      }
    } catch {}
  })

  // Content Authority — extract visible text, compute keywords
  const bodyText = $("body").text().replace(/\s+/g, " ").trim()
  const stopWords = new Set(["the","a","an","and","or","but","in","on","at","to","for","of","is","it","that","this","was","are","be","has","had","have","with","as","by","from","not","no","your","you","we","our","they","their","can","will","do","if","so","all","more","about","up","out","just","than","them","its","also","into","over","after","some","what","how","which","when","where","who","get","been","would","could","should","make","like","new","one","two","know","see","use","may","us","very","most","any","other","each","these","those","then","only","well","even","now","find","here","way","many","much","own","free","still","back","every","best","shop","store"])
  const words = bodyText.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w))
  const freq = {}
  for (const w of words) freq[w] = (freq[w] || 0) + 1
  const topKeywords = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([w]) => w)

  const h1 = $("h1").first().text().trim()
  const brandPositioning = [h1, description].filter(Boolean).join(" — ")

  return {
    siteIdentity: { siteName, canonicalDomain: canonical, faviconUrl },
    metadata: { title, description, ogType, twitterCard, twitterTitle, twitterImage },
    structuredData,
    contentAuthority: { topKeywords, brandPositioning }
  }
}

async function analyzePolicies(baseUrl) {
  const paths = {
    aboutPage: "/pages/about",
    contactPage: "/pages/contact",
    privacyPolicy: "/policies/privacy-policy",
    termsOfService: "/policies/terms-of-service",
    refundPolicy: "/policies/refund-policy"
  }
  const results = {}
  await Promise.all(Object.entries(paths).map(async ([key, path]) => {
    results[key] = await checkExists(`${baseUrl}${path}`)
  }))
  return results
}

async function analyzeCrawlability(baseUrl) {
  const [robotsTxt, sitemapXml, llmsTxt1, llmsTxt2] = await Promise.all([
    checkExists(`${baseUrl}/robots.txt`),
    checkExists(`${baseUrl}/sitemap.xml`),
    checkExists(`${baseUrl}/llms.txt`),
    checkExists(`${baseUrl}/.well-known/llms.txt`)
  ])
  return { robotsTxt, sitemapXml, llmsTxt: llmsTxt1 || llmsTxt2 }
}

async function analyzeCommerce(baseUrl) {
  const data = await fetchJson(`${baseUrl}/products.json?limit=250`)
  if (!data?.products) return { available: false }

  const products = data.products
  const prices = products.flatMap(p => p.variants?.map(v => parseFloat(v.price)).filter(n => !isNaN(n)) || [])
  const currency = products[0]?.variants?.[0]?.price ? (products[0]?.variants?.[0]?.currency || "USD") : ""

  return {
    available: true,
    totalProducts: products.length,
    currency,
    averagePrice: prices.length ? (prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2) : null,
    priceRange: prices.length ? { min: Math.min(...prices).toFixed(2), max: Math.max(...prices).toFixed(2) } : null
  }
}

async function analyzeProducts(baseUrl) {
  const data = await fetchJson(`${baseUrl}/products.json?limit=250`)
  if (!data?.products?.length) return []

  // Pick 5 random products
  const shuffled = data.products.sort(() => 0.5 - Math.random())
  const sample = shuffled.slice(0, 5)

  const results = await Promise.all(sample.map(async (product) => {
    const handle = product.handle
    const pageHtml = await fetchText(`${baseUrl}/products/${handle}`)
    const $ = pageHtml ? cheerio.load(pageHtml) : null

    const variant = product.variants?.[0] || {}
    const image = product.images?.[0] || {}

    // SEO & Page Optimization (from HTML)
    const seo = $ ? {
      title: $("title").text().trim(),
      metaDescription: $('meta[name="description"]').attr("content") || "",
      h1: $("h1").first().text().trim(),
      canonicalUrl: $('link[rel="canonical"]').attr("href") || "",
      ogTitle: $('meta[property="og:title"]').attr("content") || "",
      ogDescription: $('meta[property="og:description"]').attr("content") || "",
      ogImage: $('meta[property="og:image"]').attr("content") || "",
      ogType: $('meta[property="og:type"]').attr("content") || "",
      twitterCard: $('meta[name="twitter:card"]').attr("content") || "",
      twitterTitle: $('meta[name="twitter:title"]').attr("content") || "",
      twitterImage: $('meta[name="twitter:image"]').attr("content") || "",
    } : null

    // OpenAI flags (from HTML meta)
    const openai = $ ? {
      enableSearch: $('meta[name="openai:search"]').attr("content") || "",
      enableCheckout: $('meta[name="openai:checkout"]').attr("content") || "",
    } : null

    // Structured data from product page
    let schemaData = {}
    if ($) {
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const json = JSON.parse($(el).html())
          const items = json["@graph"] || (Array.isArray(json) ? json : [json])
          for (const item of items) {
            if (item["@type"] === "Product" || item["@type"]?.includes?.("Product")) {
              schemaData = item
            }
          }
        } catch {}
      })
    }

    const offers = schemaData.offers || schemaData.offers?.[0] || {}
    const singleOffer = Array.isArray(offers) ? offers[0] : offers
    const brand = schemaData.brand?.name || product.vendor || ""
    const reviews = schemaData.aggregateRating || {}

    return {
      handle,
      url: `${baseUrl}/products/${handle}`,

      seo,
      openai,

      basicData: {
        id: product.id,
        gtin: variant.barcode || schemaData.gtin || schemaData.gtin13 || schemaData.gtin12 || "",
        mpn: schemaData.mpn || variant.sku || "",
        title: product.title,
        description: product.body_html ? product.body_html.replace(/<[^>]+>/g, "").slice(0, 200) : "",
        link: `${baseUrl}/products/${handle}`,
      },

      itemInfo: {
        condition: singleOffer?.itemCondition?.replace("https://schema.org/", "") || "",
        productCategory: product.product_type || "",
        brand,
        material: product.tags?.find(t => t.toLowerCase().startsWith("material:"))?.split(":")?.[1]?.trim() || "",
        dimensions: schemaData.depth || schemaData.width || schemaData.height ? "See L/W/H" : "",
        length: schemaData.depth?.value || "",
        width: schemaData.width?.value || "",
        height: schemaData.height?.value || "",
        weight: variant.weight ? `${variant.weight} ${variant.weight_unit || ""}`.trim() : "",
        ageGroup: schemaData.audience?.suggestedMinAge ? `${schemaData.audience.suggestedMinAge}+` : (product.tags?.find(t => t.toLowerCase().startsWith("age_group:"))?.split(":")?.[1]?.trim() || ""),
      },

      media: {
        imageLink: image.src || "",
        additionalImages: product.images?.length > 1 ? product.images.length - 1 : 0,
        videoLink: "",
        model3dLink: "",
      },

      priceAndPromotions: {
        price: variant.price ? `${variant.price}` : "",
        salePrice: variant.compare_at_price && variant.compare_at_price !== variant.price ? variant.price : "",
        compareAtPrice: variant.compare_at_price || "",
        salePriceEffectiveDate: singleOffer?.priceValidUntil || "",
        currency: variant.currency || singleOffer?.priceCurrency || "",
        unitPricingMeasure: schemaData.hasMeasurement?.value || "",
        unitPricingBaseMeasure: schemaData.hasMeasurement?.unitCode || "",
      },

      availability: {
        available: variant.available ?? "",
        availabilityDate: singleOffer?.availabilityStarts || "",
        inventoryQuantity: variant.inventory_quantity ?? "",
      },

      variants: {
        itemGroupId: product.id,
        itemGroupTitle: product.title,
        totalVariants: product.variants?.length || 0,
        color: product.options?.find(o => o.name.toLowerCase() === "color")?.values?.join(", ") || "",
        size: product.options?.find(o => o.name.toLowerCase() === "size")?.values?.join(", ") || "",
        sizeSystem: "",
        gender: product.tags?.find(t => t.toLowerCase().startsWith("gender:"))?.split(":")?.[1]?.trim() || "",
        offerId: variant.id || "",
        options: product.options?.map(o => ({ name: o.name, values: o.values })) || [],
      },

      fulfillment: {
        shipping: singleOffer?.shippingDetails?.shippingRate?.value || "",
        deliveryEstimate: singleOffer?.deliveryLeadTime?.value || "",
      },

      merchantInfo: {
        sellerName: brand,
        sellerUrl: baseUrl,
      },

      returns: {
        returnPolicy: singleOffer?.hasMerchantReturnPolicy?.merchantReturnDays || "",
        returnWindow: singleOffer?.hasMerchantReturnPolicy?.returnPolicyCategory?.replace("https://schema.org/", "") || "",
      },

      reviews: {
        productReviewCount: reviews.reviewCount || reviews.ratingCount || "",
        productReviewRating: reviews.ratingValue || "",
      },
    }
  }))

  return results
}

// Sitemap helpers
const xmlParser = new XMLParser()

async function fetchSitemap(baseUrl) {
  const res = await fetch(`${baseUrl}/sitemap.xml`)
  if (!res.ok) throw new Error(`Could not fetch sitemap: ${res.status}`)
  return xmlParser.parse(await res.text())
}

async function fetchSubSitemap(url) {
  try {
    const res = await fetch(url)
    if (!res.ok) return []
    const parsed = xmlParser.parse(await res.text())
    const urlset = parsed.urlset?.url
    if (!urlset) return []
    const urls = Array.isArray(urlset) ? urlset : [urlset]
    return urls.map(u => u.loc).filter(Boolean)
  } catch {
    return []
  }
}

function categorizeUrls(urls, baseUrl) {
  const tree = { products: [], collections: [], pages: [], blogs: [], other: [] }
  for (const url of urls) {
    const path = url.replace(baseUrl, "")
    if (path.startsWith("/products/")) {
      tree.products.push({ url, name: decodeURIComponent(path.replace("/products/", "").replace(/-/g, " ")) })
    } else if (path.startsWith("/collections/")) {
      tree.collections.push({ url, name: decodeURIComponent(path.replace("/collections/", "").replace(/-/g, " ")) })
    } else if (path.startsWith("/pages/")) {
      tree.pages.push({ url, name: decodeURIComponent(path.replace("/pages/", "").replace(/-/g, " ")) })
    } else if (path.startsWith("/blogs/")) {
      tree.blogs.push({ url, name: decodeURIComponent(path.replace("/blogs/", "").replace(/-/g, " ")) })
    } else if (path && path !== "/") {
      tree.other.push({ url, name: decodeURIComponent(path.replace(/^\//, "").replace(/-/g, " ")) })
    }
  }
  return tree
}

// Quick validation endpoint
app.post("/api/validate-store", async (req, res) => {
  let baseUrl = req.body.url?.trim()
  if (!baseUrl) return res.status(400).json({ error: "URL is required" })

  try {
    new URL(baseUrl)
  } catch {
    return res.status(400).json({ error: "Invalid URL" })
  }

  baseUrl = baseUrl.replace(/\/+$/, "")

  let isShopify = false
  try {
    const metaRes = await fetch(`${baseUrl}/meta.json`)
    if (metaRes.ok) {
      const meta = await metaRes.json()
      isShopify = !!(meta.id || meta.name || meta.shopify)
    }
  } catch {}

  if (!isShopify) {
    return res.status(400).json({ error: "This doesn't appear to be a Shopify store" })
  }

  res.json({ ok: true })
})

app.post("/api/report", async (req, res) => {
  let baseUrl = req.body.url?.trim()
  if (!baseUrl) return res.status(400).json({ error: "URL is required" })

  try {
    new URL(baseUrl)
  } catch {
    return res.status(400).json({ error: "Invalid URL" })
  }

  baseUrl = baseUrl.replace(/\/+$/, "")

  try {
    // Verify it's a Shopify store
    let isShopify = false
    try {
      const metaRes = await fetch(`${baseUrl}/meta.json`)
      if (metaRes.ok) {
        const meta = await metaRes.json()
        isShopify = !!(meta.id || meta.name || meta.shopify)
      }
    } catch {}
    if (!isShopify) {
      return res.status(400).json({ error: "This doesn't appear to be a Shopify store" })
    }

    // Run all analyses in parallel
    const [homepageHtml, sitemapIndex, policies, crawlability, commerce, productSamples] = await Promise.all([
      fetchText(baseUrl),
      fetchSitemap(baseUrl).catch(() => null),
      analyzePolicies(baseUrl),
      analyzeCrawlability(baseUrl),
      analyzeCommerce(baseUrl),
      analyzeProducts(baseUrl)
    ])

    // Sitemap tree
    let allUrls = []
    if (sitemapIndex) {
      const sitemaps = sitemapIndex.sitemapindex?.sitemap
      if (sitemaps) {
        const entries = Array.isArray(sitemaps) ? sitemaps : [sitemaps]
        const subUrls = await Promise.all(entries.map(s => fetchSubSitemap(s.loc)))
        allUrls = subUrls.flat()
      }
      const urlset = sitemapIndex.urlset?.url
      if (urlset) {
        const entries = Array.isArray(urlset) ? urlset : [urlset]
        allUrls = entries.map(u => u.loc).filter(Boolean)
      }
    }

    const tree = categorizeUrls(allUrls, baseUrl)

    // Homepage analysis
    let homepage = null
    if (homepageHtml) {
      homepage = analyzeHomepage(homepageHtml, baseUrl)
    }

    res.json({
      ok: true,
      url: baseUrl,
      total: allUrls.length,
      tree,
      siteIdentity: homepage?.siteIdentity || null,
      metadata: homepage?.metadata || null,
      structuredData: homepage?.structuredData || null,
      contentAuthority: homepage?.contentAuthority || null,
      policies,
      crawlability,
      commerce,
      productSamples
    })
  } catch (err) {
    console.error("[report error]", err.message)
    res.status(500).json({ error: err.message || "Could not analyze this site" })
  }
})

// Report email gate
app.post("/api/report-email", async (req, res) => {
  const email = req.body.email?.trim().toLowerCase()
  const storeUrl = req.body.store_url?.trim()

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Invalid email address" })
  }
  if (!storeUrl) {
    return res.status(400).json({ error: "Store URL is required" })
  }

  try {
    const existing = await db.execute({ sql: "SELECT * FROM subscribers WHERE email = ?", args: [email] })

    let token
    if (existing.rows.length > 0) {
      token = existing.rows[0].token
      await db.execute({ sql: "UPDATE subscribers SET store_url = ? WHERE email = ?", args: [storeUrl, email] })
    } else {
      token = crypto.randomUUID()
      await db.execute({
        sql: "INSERT INTO subscribers (email, token, confirmed, subscribed_at, store_url) VALUES (?, ?, 0, datetime('now'), ?)",
        args: [email, token, storeUrl]
      })
    }

    await sendReportEmail(email, token)
    res.json({ ok: true })
  } catch (err) {
    console.error("[report-email error]", err.message)
    res.status(500).json({ error: "Something went wrong" })
  }
})

async function sendReportEmail(email, token) {
  const reportUrl = `${BASE_URL}/api/view-report?token=${token}`
  await resend.emails.send({
    from: "AI Radar <support@polymorphtech.xyz>",
    to: email,
    subject: "Access Your AI Readiness Report",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem;">
        <h2 style="margin-bottom: 1rem;">AI Radar</h2>
        <a href="${reportUrl}" style="display: inline-block; margin-top: 1rem; padding: 0.75rem 1.5rem; background: #111; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600;">View AI Readiness Report</a>
        <p style="margin-top: 2rem; font-size: 0.85rem; color: #999;">Accessing your AI Readiness Report also subscribes you to AI Radar's mailing list. You can unsubscribe at any point.</p>
      </div>
    `
  })
}

// Report feedback
app.post("/api/report-feedback", async (req, res) => {
  const { token, helpfulness } = req.body
  if (!token || ![1, -1].includes(helpfulness)) {
    return res.status(400).json({ error: "Invalid feedback" })
  }
  try {
    await db.execute({ sql: "UPDATE subscribers SET helpfulness = ? WHERE token = ?", args: [helpfulness, token] })
    res.json({ ok: true })
  } catch (err) {
    console.error("[feedback error]", err.message)
    res.status(500).json({ error: "Something went wrong" })
  }
})

// View report (confirms subscription + redirects to report)
app.get("/api/view-report", async (req, res) => {
  const { token } = req.query
  if (!token) return res.status(400).send("Invalid link")

  try {
    const result = await db.execute({ sql: "SELECT * FROM subscribers WHERE token = ?", args: [token] })
    if (result.rows.length === 0) {
      return res.status(404).send(simplePage("Not Found", "<h1>Invalid link</h1>"))
    }

    const subscriber = result.rows[0]
    await db.execute({ sql: "UPDATE subscribers SET confirmed = 1 WHERE token = ?", args: [token] })

    const storeUrl = subscriber.store_url || ""
    if (storeUrl) {
      res.redirect(`/airadar/report?url=${encodeURIComponent(storeUrl)}&token=${token}`)
    } else {
      res.redirect("/airadar/report")
    }
  } catch {
    res.status(500).send(simplePage("Error", "<h1>Something went wrong</h1>"))
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
        <h2 style="margin-bottom: 1rem;">Confirm your subscription to AI Radar</h2>
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
app.get("/airadar/report", (_req, res) => res.sendFile(join(__dirname, "public", "airadar", "report.html")))
app.get("/airadar/docs", (_req, res) => res.sendFile(join(__dirname, "public", "airadar", "docs.html")))
app.get("/airadar/tutorial", (_req, res) => res.sendFile(join(__dirname, "public", "airadar", "tutorial.html")))
app.get("/airadar/faq", (_req, res) => res.sendFile(join(__dirname, "public", "airadar", "faq.html")))
app.get("/airadar/changelog", (_req, res) => res.sendFile(join(__dirname, "public", "airadar", "changelog.html")))

app.get("/privacy", (_req, res) => res.sendFile(join(__dirname, "public", "privacy.html")))

app.use(express.static(join(__dirname, "public")))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Server running on port ${PORT}`))
