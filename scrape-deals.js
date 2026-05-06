const https = require("https");
const http = require("http");

// ─── CONFIG (set these as Netlify env vars) ────────────────────────────────
const REDDIT_CLIENT_ID     = process.env.REDDIT_CLIENT_ID     || "";
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET || "";
const REDDIT_USER_AGENT    = "GlitchHunterBot/2.0 (by /u/glitchhunterapp)";

// ─── KEYWORD FILTERS ───────────────────────────────────────────────────────
const MINI_PC_KEYWORDS = [
  "mini pc", "mini computer", "nuc", "beelink", "gmktec", "minisforum",
  "geekom", "acemagic", "kamrui", "bosgame", "trigkey", "aoostar",
  "raspberry pi", "mac mini", "intel nuc", "nucbox", "ser5", "ser6",
  "ser7", "ser8", "mele", "firebat", "chatreey", "morefine",
  "asus nuc", "lenovo tiny", "hp mini", "dell micro", "optiplex micro",
  "thinkcentre tiny", "compute stick", "4x4 box",
];

const GLITCH_KEYWORDS = [
  "glitch", "price error", "price mistake", "misprice", "mispriced",
  "accidental", "wrong price", "pricing error", "price drop",
  "lowest ever", "all time low", "record low", "lowest price",
  "massive discount", "huge deal", "crazy deal", "insane deal",
  "too good", "checkout glitch", "coupon stack", "price match",
  "flash sale", "lightning deal", "deal alert", "price alert",
  "slickdeals", "front page deal", "hot deal",
];

const DEAD_DEAL_SIGNALS = [
  "expired", "out of stock", "sold out", "no longer available",
  "deal ended", "price changed", "link dead", "404", "removed",
  "deleted", "oos", "[expired]", "(expired)", "deal is dead",
  "ymmv expired",
];

const EXCLUDE_KEYWORDS = [
  "phone", "tablet", "ipad", "iphone", "watch", "headphone",
  "airpod", "earphone", "earbud", "kindle", "echo dot", "fire stick",
  "smart tv", "tv stand", "monitor arm", "mouse pad",
];

// ─── FETCH HELPER ──────────────────────────────────────────────────────────
function fetchUrl(url, options = {}, timeoutMs = 9000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const opts = {
      headers: {
        "User-Agent": options.userAgent || "Mozilla/5.0 (compatible; GlitchHunter/2.0)",
        "Accept": "application/rss+xml, application/xml, application/json, text/xml, */*",
        ...(options.headers || {}),
      },
    };
    const req = lib.get(url, opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchUrl(res.headers.location, options, timeoutMs).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode === 429) { reject(new Error("Rate limited")); return; }
      if (res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(data));
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error("Timeout")); });
    req.on("error", reject);
  });
}

// ─── POST HELPER (for Reddit OAuth token) ─────────────────────────────────
function postUrl(url, body, headers = {}, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString("base64");
    const postData = typeof body === "string" ? body : new URLSearchParams(body).toString();
    const urlObj = new URL(url);
    const opts = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postData),
        "Authorization": `Basic ${auth}`,
        "User-Agent": REDDIT_USER_AGENT,
        ...headers,
      },
    };
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(data));
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error("Timeout")); });
    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

// ─── REDDIT OAUTH TOKEN ────────────────────────────────────────────────────
let redditTokenCache = { token: null, expires: 0 };

async function getRedditToken() {
  if (redditTokenCache.token && Date.now() < redditTokenCache.expires) {
    return redditTokenCache.token;
  }
  if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET) return null;
  try {
    const raw = await postUrl(
      "https://www.reddit.com/api/v1/access_token",
      { grant_type: "client_credentials" }
    );
    const j = JSON.parse(raw);
    if (!j.access_token) return null;
    redditTokenCache = { token: j.access_token, expires: Date.now() + (j.expires_in - 60) * 1000 };
    return j.access_token;
  } catch (e) {
    return null;
  }
}

// ─── REDDIT FETCHER ────────────────────────────────────────────────────────
async function fetchReddit(subreddit, query = "", sort = "new", limit = 25) {
  const token = await getRedditToken();
  const base  = token ? "https://oauth.reddit.com" : "https://www.reddit.com";
  const headers = token
    ? { Authorization: `Bearer ${token}` }
    : {};

  let url;
  if (query) {
    url = `${base}/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&sort=${sort}&restrict_sr=1&limit=${limit}&t=week`;
  } else {
    url = `${base}/r/${subreddit}/${sort}.json?limit=${limit}`;
  }

  const raw  = await fetchUrl(url, { userAgent: REDDIT_USER_AGENT, headers }, 9000);
  const json = JSON.parse(raw);
  const posts = json?.data?.children || [];

  return posts.map((p) => {
    const d = p.data;
    const combined = ((d.title || "") + " " + (d.selftext || "")).toLowerCase();
    const isDead = DEAD_DEAL_SIGNALS.some((s) => combined.includes(s));
    const score  = d.score || 0;
    // Only return posts with some upvotes or very new (not dead)
    if (isDead && score < 5) return null;

    const isGlitch = GLITCH_KEYWORDS.some((k) => combined.includes(k));
    const priceMatch    = (d.title + " " + (d.selftext||"")).match(/\$[\d,]+(?:\.\d{2})?/);
    const discountMatch = (d.title + " " + (d.selftext||"")).match(/(\d{1,3})%\s*off/i);

    return {
      id:          d.id,
      title:       (d.title || "").slice(0, 130),
      description: (d.selftext || "").slice(0, 400).replace(/\n+/g, " ").trim(),
      link:        `https://reddit.com${d.permalink}`,
      externalLink: d.url && !d.url.includes("reddit.com") ? d.url : null,
      source:      `r/${subreddit}`,
      sourceColor: "#ff6314",
      isGlitch,
      isDead,
      score,
      price:       priceMatch    ? priceMatch[0]         : null,
      discount:    discountMatch ? parseInt(discountMatch[1]) : null,
      timestamp:   d.created_utc ? d.created_utc * 1000 : Date.now(),
      numComments: d.num_comments || 0,
      flair:       d.link_flair_text || null,
    };
  }).filter(Boolean);
}

// ─── RSS PARSER ────────────────────────────────────────────────────────────
function parseRSS(xml, sourceName, sourceColor) {
  const items = [];
  const itemMatches = xml.match(/<item[\s\S]*?<\/item>/gi) || [];

  for (const item of itemMatches) {
    const get = (tag) => {
      const m = item.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, "i"))
        || item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
      return m ? m[1].replace(/<[^>]+>/g, "").trim() : "";
    };

    const title   = get("title");
    const desc    = get("description");
    const link    = get("link") || get("guid");
    const pubDate = get("pubDate") || get("dc:date");
    const combined = (title + " " + desc).toLowerCase();

    if (!title || title.length < 5) continue;

    // Freshness check — skip items older than 72 hours
    if (pubDate) {
      const age = Date.now() - new Date(pubDate).getTime();
      if (age > 72 * 60 * 60 * 1000) continue;
    }

    // Keyword relevance
    const isRelevant = MINI_PC_KEYWORDS.some((k) => combined.includes(k));
    const isExcluded = EXCLUDE_KEYWORDS.some((k) => combined.includes(k));
    if (!isRelevant || isExcluded) continue;

    // Dead deal check
    const isDead = DEAD_DEAL_SIGNALS.some((s) => combined.includes(s));
    if (isDead) continue;

    const isGlitch   = GLITCH_KEYWORDS.some((k) => combined.includes(k));
    const priceMatch = (title + " " + desc).match(/\$[\d,]+(?:\.\d{2})?/);
    const discMatch  = (title + " " + desc).match(/(\d{1,3})%\s*off/i);

    items.push({
      id:          Buffer.from(title + link).toString("base64").slice(0, 16),
      title:       title.slice(0, 130),
      description: desc.slice(0, 400),
      link,
      source:      sourceName,
      sourceColor,
      isGlitch,
      isDead:      false,
      price:       priceMatch ? priceMatch[0]         : null,
      discount:    discMatch  ? parseInt(discMatch[1]) : null,
      timestamp:   pubDate ? new Date(pubDate).getTime() : Date.now(),
      numComments: null,
      flair:       null,
      score:       null,
    });
  }
  return items;
}

// ─── RSS SOURCES ────────────────────────────────────────────────────────────
const RSS_SOURCES = [
  // Slickdeals
  {
    name: "Slickdeals",
    color: "#e63946",
    url: "https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&q=mini+pc&rss=1",
  },
  {
    name: "Slickdeals",
    color: "#e63946",
    url: "https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&q=beelink&rss=1",
  },
  {
    name: "Slickdeals",
    color: "#e63946",
    url: "https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&q=price+error+computer&rss=1",
  },
  {
    name: "Slickdeals",
    color: "#e63946",
    url: "https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&q=gmktec&rss=1",
  },
  // Dealnews
  {
    name: "Dealnews",
    color: "#2a9d8f",
    url: "https://www.dealnews.com/c142/Computers/?srcval=rss_main",
  },
  // 9to5Toys
  {
    name: "9to5Toys",
    color: "#0066cc",
    url: "https://9to5toys.com/feed/",
  },
  // The Wirecutter / NYT Deals
  {
    name: "Wirecutter Deals",
    color: "#111",
    url: "https://www.nytimes.com/wirecutter/deals/feed/",
  },
  // TechBargains
  {
    name: "TechBargains",
    color: "#457b9d",
    url: "https://techbargains.com/feed/",
  },
  // HotUKDeals (catches Amazon.com glitches too)
  {
    name: "HotUKDeals",
    color: "#e76f51",
    url: "https://www.hotukdeals.com/rss/deals/computers-accessories",
  },
  // CamelCamelCamel top drops
  {
    name: "CamelCamelCamel",
    color: "#6a0572",
    url: "https://camelcamelcamel.com/top_drops/feed?n=25",
  },
  // BensBargains
  {
    name: "BensBargains",
    color: "#c77dff",
    url: "https://bensbargains.com/feed/",
  },
  // DealNews computers
  {
    name: "DealNews Tech",
    color: "#2a9d8f",
    url: "https://www.dealnews.com/c232/Electronics/?srcval=rss_main",
  },
];

// ─── REDDIT SOURCES ────────────────────────────────────────────────────────
const REDDIT_SOURCES = [
  { sub: "buildapcsales",   query: "mini pc",       sort: "new"  },
  { sub: "buildapcsales",   query: "beelink",        sort: "new"  },
  { sub: "buildapcsales",   query: "gmktec",         sort: "new"  },
  { sub: "buildapcsales",   query: "price error",    sort: "new"  },
  { sub: "PCDeals",         query: "mini pc",        sort: "new"  },
  { sub: "PCDeals",         query: "glitch",         sort: "new"  },
  { sub: "hardware_swap",   query: "mini pc",        sort: "new"  },
  { sub: "frugal",          query: "mini pc glitch", sort: "new"  },
  { sub: "Deals",           query: "mini pc",        sort: "new"  },
  { sub: "DealAlert",       query: "mini pc",        sort: "new"  },
  { sub: "amazondealsusa",  query: "mini pc",        sort: "new"  },
];

// ─── DEDUP + VALIDATE ──────────────────────────────────────────────────────
function deduplicateAndValidate(items) {
  const seen = new Set();
  return items.filter((d) => {
    if (!d || !d.title) return false;
    // Skip dead deals
    if (d.isDead) return false;
    // Skip very low-effort Reddit posts (no upvotes, probably spam)
    if (d.score !== null && d.score < 1) return false;
    // Dedup by normalized title prefix
    const key = d.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 35);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── MAIN HANDLER ──────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=1800", // 30 min cache
  };

  try {
    // ── Fetch all RSS sources in parallel ──────────────────────────────────
    const rssResults = await Promise.allSettled(
      RSS_SOURCES.map(async (src) => {
        try {
          const xml = await fetchUrl(src.url);
          return parseRSS(xml, src.name, src.color);
        } catch (e) {
          return [];
        }
      })
    );

    // ── Fetch all Reddit sources in parallel ───────────────────────────────
    const redditResults = await Promise.allSettled(
      REDDIT_SOURCES.map(async (src) => {
        try {
          return await fetchReddit(src.sub, src.query, src.sort, 25);
        } catch (e) {
          return [];
        }
      })
    );

    // ── Combine + clean ────────────────────────────────────────────────────
    const rssItems    = rssResults.flatMap((r)    => r.status === "fulfilled" ? r.value : []);
    const redditItems = redditResults.flatMap((r) => r.status === "fulfilled" ? r.value : []);
    const allRaw      = [...rssItems, ...redditItems];

    // Validate, deduplicate
    let allDeals = deduplicateAndValidate(allRaw);

    // Sort by timestamp desc
    allDeals.sort((a, b) => b.timestamp - a.timestamp);

    const glitches = allDeals.filter((d) => d.isGlitch);
    const deals    = allDeals.filter((d) => !d.isGlitch);

    // Source breakdown for stats
    const sourceCounts = {};
    allDeals.forEach((d) => {
      sourceCounts[d.source] = (sourceCounts[d.source] || 0) + 1;
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        lastUpdated: new Date().toISOString(),
        redditEnabled: !!(REDDIT_CLIENT_ID && REDDIT_CLIENT_SECRET),
        stats: {
          total:    allDeals.length,
          glitches: glitches.length,
          deals:    deals.length,
          sources:  Object.keys(sourceCounts).length,
          sourceCounts,
        },
        glitches,
        deals,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
};
