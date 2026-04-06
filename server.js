require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/quickbyte";
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "1234";
const WIKIPEDIA_API_URL = "https://en.wikipedia.org/w/api.php";
const WIKIMEDIA_COMMONS_API_URL = "https://commons.wikimedia.org/w/api.php";
const REMOTE_FOOD_IMAGE_TITLES = [
  { match: ["egg puff", "egg puffs"], titles: ["Puff pastry"] },
  { match: ["curry puff", "curry puffs"], titles: ["Curry puff"] },
  { match: ["samosa", "veg samosa", "aloo samosa"], titles: ["Samosa"] },
  { match: ["pizza", "veg pizza", "cheese pizza"], titles: ["Pizza"] },
  { match: ["sandwich", "veg sandwich", "grilled sandwich"], titles: ["Sandwich"] },
  { match: ["roll", "kathi roll"], titles: ["Kati roll"] },
  { match: ["wrap"], titles: ["Wrap (food)"] },
  { match: ["masala dosa"], titles: ["Masala dosa"] },
  { match: ["dosa", "plain dosa"], titles: ["Dosa"] },
  { match: ["idli", "idly"], titles: ["Idli"] },
  { match: ["medu vada"], titles: ["Medu vada"] },
  { match: ["vada"], titles: ["Vada"] },
  { match: ["poori bhaji", "puri bhaji"], titles: ["Puri bhaji"] },
  { match: ["poori", "puri"], titles: ["Puri"] },
  { match: ["cake", "chocolate cake"], titles: ["Cake"] },
  { match: ["pastry"], titles: ["Pastry"] },
  { match: ["donut", "doughnut"], titles: ["Doughnut"] },
  { match: ["white sauce pasta", "red sauce pasta", "pasta"], titles: ["Pasta"] },
  { match: ["momos", "momo"], titles: ["Momo"] }
];

app.use(cors());
app.use(express.json());
app.use(express.static(FRONTEND_DIR));
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((error) => console.error("MongoDB connection failed", error.message));

const foodSchema = new mongoose.Schema(
  {
    canteen: {
      type: String,
      enum: ["pencil", "aparna", "ball"],
      required: true,
      trim: true
    },
    category: {
      type: String,
      required: true,
      trim: true,
      maxlength: 40
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80
    },
    price: {
      type: Number,
      required: true,
      min: 1,
      max: 5000
    },
    image: {
      type: String,
      default: "watermark5.jpg",
      trim: true
    }
  },
  { timestamps: true }
);

foodSchema.index({ canteen: 1, name: 1 }, { unique: true });

const orderItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    price: { type: Number, required: true, min: 1 },
    qty: { type: Number, required: true, min: 1, max: 50 }
  },
  { _id: false }
);

const orderReviewSchema = new mongoose.Schema(
  {
    rating: { type: Number, min: 1, max: 5, required: true },
    comment: { type: String, trim: true, maxlength: 280, default: "" },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

function isReviewableOrderStatus(status) {
  const normalizedStatus = String(status || "").toLowerCase();

  return normalizedStatus === "accepted" || normalizedStatus === "ready" || normalizedStatus === "completed" || normalizedStatus === "delivered";
}

const orderSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    userEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },
    items: {
      type: [orderItemSchema],
      validate: {
        validator: (items) => Array.isArray(items) && items.length > 0,
        message: "Order must include at least one item"
      }
    },
    payment: {
      type: String,
      required: true,
      trim: true,
      maxlength: 40
    },
    place: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120
    },
    total: {
      type: Number,
      required: true,
      min: 1
    },
    time: {
      type: String,
      required: true
    },
    status: {
      type: String,
      trim: true,
      enum: ["Placed", "Accepted", "Preparing", "Ready"],
      default: "Placed"
    },
    review: {
      type: orderReviewSchema,
      default: null
    }
  },
  { timestamps: true }
);

const Food = mongoose.model("Food", foodSchema);
const Order = mongoose.model("Order", orderSchema);
const authTokenStore = new Map();
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7;

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: 120
    },
    passwordHash: {
      type: String,
      required: true
    },
    passwordSalt: {
      type: String,
      required: true
    }
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

function createPasswordHash(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function createPasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return {
    salt,
    hash: createPasswordHash(password, salt)
  };
}

function verifyPassword(password, salt, expectedHash) {
  const actualHash = createPasswordHash(password, salt);
  return crypto.timingSafeEqual(Buffer.from(actualHash, "hex"), Buffer.from(expectedHash, "hex"));
}

function issueAuthToken(session) {
  const token = crypto.randomBytes(32).toString("hex");

  authTokenStore.set(token, {
    ...session,
    expiresAt: Date.now() + TOKEN_TTL_MS
  });

  return token;
}

function getSessionFromToken(token) {
  const record = authTokenStore.get(token);

  if (!record) {
    return null;
  }

  if (record.expiresAt < Date.now()) {
    authTokenStore.delete(token);
    return null;
  }

  return record;
}

function revokeToken(token) {
  authTokenStore.delete(token);
}

function getBearerToken(req) {
  const header = String(req.headers.authorization || "");
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  const session = getSessionFromToken(token);

  if (!token || !session) {
    return res.status(401).json({ message: "Authentication required" });
  }

  req.auth = session;
  req.authToken = token;
  return next();
}

function requireAdmin(req, res, next) {
  return requireAuth(req, res, () => {
    if (!req.auth || req.auth.role !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }

    return next();
  });
}

function buildGeneratedFoodImage(name, category) {
  const safeName = encodeURIComponent((name || "Quick Byte Special").trim().slice(0, 28));
  const safeCategory = encodeURIComponent((category || "Chef Pick").trim().slice(0, 24));

  return `data:image/svg+xml;charset=UTF-8,${[
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 800'>",
    "<defs>",
    "<linearGradient id='g' x1='0%' y1='0%' x2='100%' y2='100%'>",
    "<stop offset='0%' stop-color='%23fff3df'/>",
    "<stop offset='100%' stop-color='%23ffd1b8'/>",
    "</linearGradient>",
    "</defs>",
    "<rect width='1200' height='800' fill='url(%23g)'/>",
    "<circle cx='1040' cy='160' r='140' fill='%23ffffff' fill-opacity='0.35'/>",
    "<circle cx='180' cy='680' r='180' fill='%23ffffff' fill-opacity='0.28'/>",
    "<text x='90' y='180' font-family='Arial' font-size='58' font-weight='700' fill='%23a54926'>Quick Byte</text>",
    "<text x='90' y='300' font-family='Arial' font-size='92' font-weight='800' fill='%23221c18'>"+ safeName +"</text>",
    "<rect x='90' y='360' rx='34' ry='34' width='300' height='82' fill='%23ffffff' fill-opacity='0.72'/>",
    "<text x='130' y='414' font-family='Arial' font-size='38' font-weight='700' fill='%23c85b2b'>"+ safeCategory +"</text>",
    "<text x='90' y='560' font-family='Arial' font-size='180'>🍽️</text>",
    "<text x='300' y='610' font-family='Arial' font-size='74' fill='%23706861'>Freshly added item</text>",
    "</svg>"
  ].join("")}`;
}

function getGeneratedFoodTheme(name, category) {
  const lookup = ((name || "") + " " + (category || "")).toLowerCase();

  if (/biryani|rice|pulao/.test(lookup)) {
    return { start: "%23fff0d0", end: "%23d96b2b", accent: "%238d3c18", panel: "%23fff8ea", icon: "PLATE" };
  }

  if (/burger|sandwich|roll|wrap/.test(lookup)) {
    return { start: "%23ffe0c2", end: "%23b84a26", accent: "%237a2712", panel: "%23fff4e8", icon: "STACK" };
  }

  if (/noodle|pasta|momo/.test(lookup)) {
    return { start: "%23ffe7cf", end: "%23c85b2b", accent: "%238b3415", panel: "%23fff6eb", icon: "BOWL" };
  }

  if (/dosa|idli|vada|poori|puri/.test(lookup)) {
    return { start: "%23fff1d8", end: "%23cf8a2e", accent: "%23865412", panel: "%23fff8ed", icon: "SUN" };
  }

  return { start: "%23f9e6ce", end: "%23c56a36", accent: "%237b3418", panel: "%23fff5ea", icon: "CHEF" };
}

function buildGeneratedFoodImage(name, category) {
  const safeName = encodeURIComponent((name || "Quick Byte Special").trim().slice(0, 30));
  const safeCategory = encodeURIComponent((category || "Chef Pick").trim().slice(0, 24));
  const theme = getGeneratedFoodTheme(name, category);
  const iconMarkup = {
    PLATE: [
      "<circle cx='915' cy='305' r='126' fill='%23ffffff' fill-opacity='0.92'/>",
      "<circle cx='915' cy='305' r='94' fill='none' stroke='" + theme.accent + "' stroke-width='18' stroke-opacity='0.28'/>",
      "<path d='M845 268c44-28 96-28 140 0' fill='none' stroke='" + theme.accent + "' stroke-width='18' stroke-linecap='round'/>",
      "<path d='M845 338c44 28 96 28 140 0' fill='none' stroke='" + theme.accent + "' stroke-width='18' stroke-linecap='round'/>"
    ].join(""),
    STACK: [
      "<rect x='820' y='220' width='190' height='42' rx='21' fill='%23ffffff' fill-opacity='0.95'/>",
      "<rect x='792' y='270' width='246' height='64' rx='32' fill='" + theme.accent + "' fill-opacity='0.85'/>",
      "<rect x='812' y='350' width='206' height='46' rx='23' fill='%23ffffff' fill-opacity='0.92'/>"
    ].join(""),
    BOWL: [
      "<path d='M810 270h210c-10 118-62 176-105 176s-95-58-105-176Z' fill='%23ffffff' fill-opacity='0.93'/>",
      "<path d='M860 250c14-20 14-44 0-64M915 245c15-22 15-50 0-72M970 250c15-20 15-44 0-64' fill='none' stroke='" + theme.panel + "' stroke-width='16' stroke-linecap='round'/>"
    ].join(""),
    SUN: [
      "<circle cx='920' cy='300' r='112' fill='%23ffffff' fill-opacity='0.92'/>",
      "<circle cx='920' cy='300' r='72' fill='" + theme.panel + "'/>",
      "<path d='M920 154v-44M920 490v-44M774 300h-44M1110 300h-44M815 195l-30-30M1025 405l-30-30M1025 195l30-30M815 405l-30 30' stroke='" + theme.panel + "' stroke-width='18' stroke-linecap='round'/>"
    ].join(""),
    CHEF: [
      "<circle cx='920' cy='288' r='116' fill='%23ffffff' fill-opacity='0.92'/>",
      "<rect x='860' y='280' width='120' height='118' rx='24' fill='" + theme.panel + "'/>",
      "<circle cx='875' cy='258' r='36' fill='%23ffffff'/>",
      "<circle cx='920' cy='238' r='44' fill='%23ffffff'/>",
      "<circle cx='965' cy='258' r='36' fill='%23ffffff'/>"
    ].join("")
  }[theme.icon];

  return `data:image/svg+xml;charset=UTF-8,${[
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 800'>",
    "<defs>",
    "<linearGradient id='g' x1='0%' y1='0%' x2='100%' y2='100%'>",
    "<stop offset='0%' stop-color='" + theme.start + "'/>",
    "<stop offset='100%' stop-color='" + theme.end + "'/>",
    "</linearGradient>",
    "<linearGradient id='overlay' x1='0%' y1='100%' x2='100%' y2='0%'>",
    "<stop offset='0%' stop-color='%231b0d07' stop-opacity='0.18'/>",
    "<stop offset='100%' stop-color='%23ffffff' stop-opacity='0'/>",
    "</linearGradient>",
    "</defs>",
    "<rect width='1200' height='800' fill='url(%23g)'/>",
    "<rect width='1200' height='800' fill='url(%23overlay)'/>",
    "<circle cx='1085' cy='122' r='152' fill='%23ffffff' fill-opacity='0.16'/>",
    "<circle cx='170' cy='730' r='188' fill='%23ffffff' fill-opacity='0.14'/>",
    "<rect x='70' y='74' width='1060' height='652' rx='38' fill='%230f0906' fill-opacity='0.12'/>",
    "<rect x='96' y='102' width='1008' height='596' rx='32' fill='%23ffffff' fill-opacity='0.08'/>",
    "<text x='128' y='170' font-family='Georgia' font-size='42' font-weight='700' fill='%23fff8f1'>Quick Byte</text>",
    "<rect x='126' y='212' rx='24' ry='24' width='248' height='58' fill='" + theme.panel + "' fill-opacity='0.95'/>",
    "<text x='154' y='251' font-family='Arial' font-size='28' font-weight='700' fill='" + theme.accent + "'>" + safeCategory + "</text>",
    "<text x='126' y='358' font-family='Georgia' font-size='84' font-weight='700' fill='%23fffaf3'>" + safeName + "</text>",
    "<text x='126' y='430' font-family='Arial' font-size='34' fill='%23fff0e5'>Chef-crafted favorite</text>",
    "<text x='126' y='612' font-family='Arial' font-size='30' font-weight='700' fill='%23fff8ef'>Freshly prepared at Quick Byte</text>",
    "<path d='M126 642h250' stroke='%23fff1e4' stroke-width='8' stroke-linecap='round' stroke-opacity='0.88'/>",
    iconMarkup,
    "</svg>"
  ].join("")}`;
}

function isLegacyAutoImage(imageValue) {
  const normalizedImage = String(imageValue || "").trim().toLowerCase();

  return normalizedImage.includes("commons.wikimedia.org/wiki/special:filepath/");
}

function getCuratedFoodImage(name) {
  const normalizedName = normalizeFoodName(name);

  const curatedImages = [
    {
      match: ["burger", "chicken burger", "veg burger"],
      image: "burger.jpg"
    },
    {
      match: ["biryani", "chicken biryani", "veg biryani"],
      image: "biryani.jpg"
    },
    {
      match: ["fried rice", "veg fried rice"],
      image: "friedrice.jpg"
    },
    {
      match: ["noodles", "hakka noodles", "egg noodles"],
      image: "noodles.jpg"
    }
  ];

  const matchedItem = curatedImages.find((item) =>
    item.match.some((term) => normalizedName === normalizeFoodName(term))
  );

  return matchedItem ? matchedItem.image : "";
}

function normalizeFoodName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getMeaningfulTerms(value) {
  return normalizeFoodName(value)
    .split(" ")
    .filter((term) => term && term.length > 2);
}

function getTrustedRemoteArticleTitles(name) {
  const normalizedName = normalizeFoodName(name);
  const matchedItem = REMOTE_FOOD_IMAGE_TITLES.find((item) =>
    item.match.some((term) => normalizedName === normalizeFoodName(term))
  );

  return matchedItem ? matchedItem.titles : [];
}

function getExactRemoteArticleTitles(name) {
  const normalizedName = normalizeFoodName(name);

  if (!normalizedName) {
    return [];
  }

  const seen = new Set();
  const candidates = [];
  const titleForms = [
    String(name || "").trim(),
    normalizedName
      .split(" ")
      .map((term) => term.charAt(0).toUpperCase() + term.slice(1))
      .join(" ")
  ];

  titleForms.forEach((title) => {
    const trimmedTitle = String(title || "").trim();

    if (trimmedTitle && !seen.has(trimmedTitle.toLowerCase())) {
      seen.add(trimmedTitle.toLowerCase());
      candidates.push(trimmedTitle);
    }
  });

  return candidates;
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function isDirectImageUrl(value) {
  return /^https?:\/\/.+\.(jpg|jpeg|png|webp|gif|avif)(\?.*)?$/i.test(String(value || "").trim());
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractMetaImageUrl(html, sourceUrl) {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
    /<meta[^>]+itemprop=["']image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+itemprop=["']image["']/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (match && match[1]) {
      try {
        return new URL(decodeHtmlEntities(match[1]), sourceUrl).toString();
      } catch (error) {
        return decodeHtmlEntities(match[1]);
      }
    }
  }

  return "";
}

async function resolveSubmittedImageInput(imageValue) {
  const trimmedImage = String(imageValue || "").trim();

  if (!trimmedImage || isLegacyAutoImage(trimmedImage)) {
    return "";
  }

  if (!isHttpUrl(trimmedImage) || isDirectImageUrl(trimmedImage)) {
    return trimmedImage;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4500);

  try {
    const response = await fetch(trimmedImage, {
      headers: {
        "User-Agent": "QuickByte/1.0 (submitted image resolver)"
      },
      redirect: "follow",
      signal: controller.signal
    });

    if (!response.ok) {
      return trimmedImage;
    }

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();

    if (contentType.startsWith("image/")) {
      return response.url || trimmedImage;
    }

    if (!contentType.includes("text/html")) {
      return trimmedImage;
    }

    const html = await response.text();
    return extractMetaImageUrl(html, response.url || trimmedImage) || trimmedImage;
  } catch (error) {
    return trimmedImage;
  } finally {
    clearTimeout(timeoutId);
  }
}

function resolveLocalFoodImage(name, imageValue, category) {
  const trimmedImage = (imageValue || "").trim();

  if (trimmedImage && !isLegacyAutoImage(trimmedImage)) {
    return trimmedImage;
  }
  const curatedImage = getCuratedFoodImage(name);

  if (curatedImage) {
    return curatedImage;
  }

  return buildGeneratedFoodImage(name, category);
}

async function fetchPreciseFoodImage(name) {
  const candidateTitles = [
    ...getTrustedRemoteArticleTitles(name),
    ...getExactRemoteArticleTitles(name)
  ].filter((title, index, allTitles) => allTitles.indexOf(title) === index);

  if (!candidateTitles.length) {
    return "";
  }

  const searchUrl = new URL(WIKIPEDIA_API_URL);
  searchUrl.searchParams.set("action", "query");
  searchUrl.searchParams.set("format", "json");
  searchUrl.searchParams.set("prop", "pageimages");
  searchUrl.searchParams.set("piprop", "thumbnail");
  searchUrl.searchParams.set("pithumbsize", "1200");
  searchUrl.searchParams.set("redirects", "1");
  searchUrl.searchParams.set("titles", candidateTitles.join("|"));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500);

  try {
    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent": "QuickByte/1.0 (precise food image lookup)"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      return "";
    }

    const data = await response.json();
    const pages = data && data.query && data.query.pages ? Object.values(data.query.pages) : [];
    const imagePage = pages.find((page) => page && page.thumbnail && page.thumbnail.source);

    return imagePage && imagePage.thumbnail ? imagePage.thumbnail.source : "";
  } catch (error) {
    return "";
  } finally {
    clearTimeout(timeoutId);
  }
}

function scoreSearchResult(page, name, category) {
  const normalizedName = normalizeFoodName(name);
  const normalizedTitle = normalizeFoodName(page && page.title);
  const nameTerms = getMeaningfulTerms(name);
  const categoryTerms = getMeaningfulTerms(category);
  const titleTerms = new Set(getMeaningfulTerms(page && page.title));
  let score = 0;

  if (!normalizedTitle || !page || !page.thumbnail || !page.thumbnail.source) {
    return -1;
  }

  if (normalizedTitle === normalizedName) {
    score += 120;
  }

  if (normalizedTitle.startsWith(normalizedName) || normalizedTitle.includes(normalizedName)) {
    score += 70;
  }

  nameTerms.forEach((term) => {
    if (titleTerms.has(term)) {
      score += 18;
    }
  });

  categoryTerms.forEach((term) => {
    if (titleTerms.has(term)) {
      score += 8;
    }
  });

  if (/recipe|dish|food|cuisine|snack|dessert|bread|meal/.test(normalizedTitle)) {
    score += 10;
  }

  if (/film|song|album|actor|actress|village|city|district|company|school|college|politician|novel/.test(normalizedTitle)) {
    score -= 45;
  }

  return score;
}

async function searchRelevantFoodImage(name, category) {
  const normalizedName = normalizeFoodName(name);

  if (!normalizedName) {
    return "";
  }

  const searchUrl = new URL(WIKIPEDIA_API_URL);
  searchUrl.searchParams.set("action", "query");
  searchUrl.searchParams.set("format", "json");
  searchUrl.searchParams.set("generator", "search");
  searchUrl.searchParams.set("gsrsearch", `${name} food ${category || ""}`.trim());
  searchUrl.searchParams.set("gsrlimit", "8");
  searchUrl.searchParams.set("prop", "pageimages");
  searchUrl.searchParams.set("piprop", "thumbnail");
  searchUrl.searchParams.set("pithumbsize", "1200");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500);

  try {
    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent": "QuickByte/1.0 (food search image lookup)"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      return "";
    }

    const data = await response.json();
    const pages = data && data.query && data.query.pages ? Object.values(data.query.pages) : [];
    const rankedPages = pages
      .map((page) => ({
        page,
        score: scoreSearchResult(page, name, category)
      }))
      .filter((entry) => entry.score >= 60)
      .sort((a, b) => b.score - a.score);

    return rankedPages[0] && rankedPages[0].page.thumbnail
      ? rankedPages[0].page.thumbnail.source
      : "";
  } catch (error) {
    return "";
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchFoodImageCandidates(name, category) {
  const normalizedName = normalizeFoodName(name);

  if (!normalizedName) {
    return [];
  }

  const searchTerms = [
    `${name} food`,
    `${name} dish`,
    `${name} recipe`,
    category ? `${name} ${category} food` : ""
  ].filter(Boolean);

  const collected = new Map();

  for (const term of searchTerms) {
    const searchUrl = new URL(WIKIMEDIA_COMMONS_API_URL);
    searchUrl.searchParams.set("action", "query");
    searchUrl.searchParams.set("format", "json");
    searchUrl.searchParams.set("generator", "search");
    searchUrl.searchParams.set("gsrsearch", term);
    searchUrl.searchParams.set("gsrnamespace", "6");
    searchUrl.searchParams.set("gsrlimit", "10");
    searchUrl.searchParams.set("prop", "imageinfo");
    searchUrl.searchParams.set("iiprop", "url");
    searchUrl.searchParams.set("iiurlwidth", "500");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    try {
      const response = await fetch(searchUrl, {
        headers: {
          "User-Agent": "QuickByte/1.0 (food image candidates)"
        },
        signal: controller.signal
      });

      if (!response.ok) {
        continue;
      }

      const data = await response.json();
      const pages = data && data.query && data.query.pages ? Object.values(data.query.pages) : [];

      pages.forEach((page) => {
        const title = String(page && page.title || "");
        const normalizedTitle = normalizeFoodName(title.replace(/^file\s+/i, ""));
        const imageInfo = page && page.imageinfo && page.imageinfo[0] ? page.imageinfo[0] : null;
        const imageUrl = imageInfo ? (imageInfo.thumburl || imageInfo.url || "") : "";

        if (!imageUrl || !normalizedTitle) {
          return;
        }

        if (/logo|icon|map|flag|poster|svg|drawing|illustration/.test(normalizedTitle)) {
          return;
        }

        const termHits = getMeaningfulTerms(name).filter((termToken) => normalizedTitle.includes(termToken)).length;
        const categoryHits = getMeaningfulTerms(category).filter((termToken) => normalizedTitle.includes(termToken)).length;
        const score = termHits * 25 + categoryHits * 8 + (normalizedTitle.includes("food") ? 4 : 0);

        if (score < 20) {
          return;
        }

        if (!collected.has(imageUrl)) {
          collected.set(imageUrl, {
            image: imageUrl,
            title,
            score
          });
        }
      });
    } catch (error) {
      // Ignore a failed candidate query and keep the rest.
    } finally {
      clearTimeout(timeoutId);
    }

    if (collected.size >= 6) {
      break;
    }
  }

  return Array.from(collected.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((item) => ({
      image: item.image,
      title: item.title
    }));
}

async function resolveFoodImage(name, imageValue, category) {
  const submittedImage = await resolveSubmittedImageInput(imageValue);
  const localImage = resolveLocalFoodImage(name, submittedImage, category);

  if (submittedImage) {
    return localImage;
  }

  const preciseRemoteImage = await fetchPreciseFoodImage(name);
  if (preciseRemoteImage) {
    return preciseRemoteImage;
  }

  const searchedRemoteImage = await searchRelevantFoodImage(name, category);
  if (searchedRemoteImage) {
    return searchedRemoteImage;
  }

  const curatedImage = getCuratedFoodImage(name);
  return curatedImage || localImage;
}

function getErrorMessage(error, fallback) {
  if (error && error.code === 11000) {
    return "That food already exists in this canteen.";
  }

  if (error && error.name === "ValidationError") {
    const firstError = Object.values(error.errors)[0];
    return firstError ? firstError.message : fallback;
  }

  return fallback;
}

function buildFoodPayload(body) {
  return {
    canteen: body.canteen,
    category: body.category,
    name: body.name,
    price: body.price,
    image: body.image
  };
}

app.post("/auth/register", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "").trim();

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    if (password.length < 4) {
      return res.status(400).json({ message: "Use at least 4 characters for the password." });
    }

    const passwordRecord = createPasswordRecord(password);
    const user = await User.create({
      email,
      passwordHash: passwordRecord.hash,
      passwordSalt: passwordRecord.salt
    });

    return res.status(201).json({
      id: user._id,
      email: user.email
    });
  } catch (error) {
    return res.status(400).json({ message: getErrorMessage(error, "Failed to create account") });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "").trim();
    const user = await User.findOne({ email });

    if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
      return res.status(401).json({ message: "Wrong email or password." });
    }

    const token = issueAuthToken({
      role: "user",
      userId: String(user._id),
      email: user.email
    });

    return res.json({
      token,
      role: "user",
      user: {
        id: user._id,
        email: user.email
      }
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to log in" });
  }
});

app.post("/auth/admin/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "").trim();

  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ message: "Wrong admin username or password." });
  }

  const token = issueAuthToken({
    role: "admin",
    username: ADMIN_USERNAME
  });

  return res.json({
    token,
    role: "admin",
    user: {
      username: ADMIN_USERNAME
    }
  });
});

app.get("/auth/session", requireAuth, (req, res) => {
  return res.json({
    role: req.auth.role,
    user:
      req.auth.role === "admin"
        ? { username: req.auth.username || ADMIN_USERNAME }
        : { id: req.auth.userId, email: req.auth.email || "" }
  });
});

app.put("/auth/profile", requireAuth, async (req, res) => {
  try {
    if (!req.auth || req.auth.role !== "user" || !req.auth.userId) {
      return res.status(403).json({ message: "User profile access required" });
    }

    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "").trim();

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const existingUser = await User.findOne({
      email,
      _id: { $ne: req.auth.userId }
    }).lean();

    if (existingUser) {
      return res.status(400).json({ message: "That email is already in use." });
    }

    const updates = { email };

    if (password) {
      if (password.length < 4) {
        return res.status(400).json({ message: "Use at least 4 characters for the password." });
      }

      const passwordRecord = createPasswordRecord(password);
      updates.passwordHash = passwordRecord.hash;
      updates.passwordSalt = passwordRecord.salt;
    }

    const updatedUser = await User.findByIdAndUpdate(req.auth.userId, updates, {
      new: true,
      runValidators: true
    });

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    await Order.updateMany(
      { userId: updatedUser._id },
      { $set: { userEmail: updatedUser.email } }
    );

    const session = getSessionFromToken(req.authToken);

    if (session) {
      authTokenStore.set(req.authToken, {
        ...session,
        email: updatedUser.email
      });
    }

    return res.json({
      role: "user",
      user: {
        id: updatedUser._id,
        email: updatedUser.email
      }
    });
  } catch (error) {
    return res.status(400).json({ message: getErrorMessage(error, "Failed to update profile") });
  }
});

app.post("/auth/logout", requireAuth, (req, res) => {
  revokeToken(req.authToken);
  return res.json({ message: "Logged out" });
});

/* ADD FOOD */
app.post("/addFood", requireAdmin, async (req, res) => {
  try {
    const payload = buildFoodPayload(req.body);
    payload.image = await resolveFoodImage(payload.name, payload.image, payload.category);
    const food = new Food(payload);
    await food.save();
    res.status(201).json(food);
  } catch (error) {
    res.status(400).json({ message: getErrorMessage(error, "Failed to add food") });
  }
});

/* GET FOOD */
app.get("/foods", async (req, res) => {
  try {
    const foods = await Food.find().lean();
    const normalizedFoods = await Promise.all(
      foods.map(async (food) => {
        const resolvedImage = await resolveFoodImage(food.name, food.image, food.category);

        if (resolvedImage !== food.image) {
          await Food.findByIdAndUpdate(food._id, { image: resolvedImage });
        }

        return {
          ...food,
          image: resolvedImage
        };
      })
    );

    res.json(normalizedFoods);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch foods" });
  }
});

app.get("/foods/suggest-image", async (req, res) => {
  try {
    const name = String(req.query.name || "").trim();
    const category = String(req.query.category || "").trim();

    if (!name) {
      return res.json({ image: "", source: "empty" });
    }

    const preciseRemoteImage = await fetchPreciseFoodImage(name);

    if (preciseRemoteImage) {
      return res.json({ image: preciseRemoteImage, source: "precise" });
    }

    const searchedRemoteImage = await searchRelevantFoodImage(name, category);

    if (searchedRemoteImage) {
      return res.json({ image: searchedRemoteImage, source: "search" });
    }

    const curatedImage = getCuratedFoodImage(name);

    if (curatedImage) {
      return res.json({ image: curatedImage, source: "curated" });
    }

    return res.json({ image: "", source: "fallback" });
  } catch (error) {
    return res.status(500).json({ message: "Failed to suggest food image" });
  }
});

app.get("/foods/image-candidates", async (req, res) => {
  try {
    const name = String(req.query.name || "").trim();
    const category = String(req.query.category || "").trim();

    if (!name) {
      return res.json({ candidates: [] });
    }

    const candidates = await fetchFoodImageCandidates(name, category);
    return res.json({ candidates });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch image candidates" });
  }
});

app.delete("/foods/:id", requireAdmin, async (req, res) => {
  try {
    await Food.findByIdAndDelete(req.params.id);
    res.json({ message: "Food deleted" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete food" });
  }
});

app.put("/foods/:id", requireAdmin, async (req, res) => {
  try {
    const payload = buildFoodPayload(req.body);
    payload.image = await resolveFoodImage(payload.name, payload.image, payload.category);
    const updatedFood = await Food.findByIdAndUpdate(req.params.id, payload, {
      new: true,
      runValidators: true
    });

    if (!updatedFood) {
      return res.status(404).json({ message: "Food not found" });
    }

    return res.json(updatedFood);
  } catch (error) {
    return res.status(400).json({ message: getErrorMessage(error, "Failed to update food") });
  }
});

app.post("/orders", requireAuth, async (req, res) => {
  try {
    if (!req.auth || req.auth.role !== "user" || !req.auth.userId) {
      return res.status(403).json({ message: "Only logged-in users can place orders." });
    }

    const order = new Order({
      userId: req.auth.userId,
      userEmail: req.auth.email || "",
      items: req.body.items,
      payment: req.body.payment,
      place: req.body.place,
      total: req.body.total,
      time: req.body.time,
      status: "Placed"
    });
    await order.save();
    res.status(201).json(order);
  } catch (error) {
    res.status(400).json({ message: getErrorMessage(error, "Failed to save order") });
  }
});

app.get("/my-orders", requireAuth, async (req, res) => {
  try {
    if (!req.auth || req.auth.role !== "user" || !req.auth.userId) {
      return res.status(403).json({ message: "User order access required" });
    }

    const orders = await Order.find({ userId: req.auth.userId }).sort({ _id: -1 }).lean();
    return res.json(orders);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch your orders" });
  }
});

app.put("/orders/:id/review", requireAuth, async (req, res) => {
  try {
    if (!req.auth || req.auth.role !== "user" || !req.auth.userId) {
      return res.status(403).json({ message: "User review access required" });
    }

    const rating = Number(req.body.rating);
    const comment = String(req.body.comment || "").trim();

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ message: "Please choose a rating from 1 to 5." });
    }

    const existingOrder = await Order.findOne({ _id: req.params.id, userId: req.auth.userId });

    if (!existingOrder) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (!isReviewableOrderStatus(existingOrder.status)) {
      return res.status(400).json({ message: "Reviews open once the admin accepts the order." });
    }

    const order = await Order.findOneAndUpdate(
      { _id: req.params.id, userId: req.auth.userId },
      {
        $set: {
          review: {
            rating,
            comment,
            createdAt: new Date()
          }
        }
      },
      { new: true, runValidators: true }
    );

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    return res.json(order);
  } catch (error) {
    return res.status(400).json({ message: getErrorMessage(error, "Failed to save review") });
  }
});

app.put("/orders/:id/status", requireAdmin, async (req, res) => {
  try {
    const nextStatus = String(req.body.status || "").trim();
    const allowedStatuses = ["Placed", "Accepted", "Preparing", "Ready"];

    if (!allowedStatuses.includes(nextStatus)) {
      return res.status(400).json({ message: "Choose a valid order status." });
    }

    const updatedOrder = await Order.findByIdAndUpdate(
      req.params.id,
      { $set: { status: nextStatus } },
      { new: true, runValidators: true }
    );

    if (!updatedOrder) {
      return res.status(404).json({ message: "Order not found" });
    }

    return res.json(updatedOrder);
  } catch (error) {
    return res.status(400).json({ message: getErrorMessage(error, "Failed to update order status") });
  }
});

app.get("/orders", requireAdmin, async (req, res) => {
  try {
    const orders = await Order.find().sort({ _id: -1 });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch orders" });
  }
});

app.get("/admin/users", requireAdmin, async (req, res) => {
  try {
    const [users, orders] = await Promise.all([
      User.find({}, "email createdAt").sort({ createdAt: -1 }).lean(),
      Order.find({}, "userId total").lean()
    ]);

    const userStats = new Map();

    orders.forEach((order) => {
      const key = String(order.userId || "");

      if (!userStats.has(key)) {
        userStats.set(key, { ordersCount: 0, totalSpend: 0 });
      }

      const entry = userStats.get(key);
      entry.ordersCount += 1;
      entry.totalSpend += Number(order.total || 0);
    });

    return res.json(
      users.map((user) => {
        const stats = userStats.get(String(user._id)) || { ordersCount: 0, totalSpend: 0 };

        return {
          id: user._id,
          email: user.email,
          createdAt: user.createdAt,
          ordersCount: stats.ordersCount,
          totalSpend: stats.totalSpend
        };
      })
    );
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch users" });
  }
});

app.delete("/admin/users/:id", requireAdmin, async (req, res) => {
  try {
    const deletedUser = await User.findByIdAndDelete(req.params.id);

    if (!deletedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    await Order.deleteMany({ userId: deletedUser._id });

    for (const [token, session] of authTokenStore.entries()) {
      if (session && session.role === "user" && String(session.userId) === String(deletedUser._id)) {
        authTokenStore.delete(token);
      }
    }

    return res.json({ message: "User removed" });
  } catch (error) {
    return res.status(400).json({ message: "Failed to remove user" });
  }
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptimeSeconds: Math.round(process.uptime()),
    database:
      mongoose.connection.readyState === 1
        ? "connected"
        : mongoose.connection.readyState === 2
          ? "connecting"
          : "disconnected"
  });
});

app.get("/dashboard/stats", requireAdmin, async (req, res) => {
  try {
    const [foods, orders] = await Promise.all([
      Food.find({}, "canteen category name price").lean(),
      Order.find({}, "items total").lean()
    ]);

    const revenue = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
    const topItems = {};
    const canteenCounts = { pencil: 0, aparna: 0, ball: 0 };

    foods.forEach((food) => {
      canteenCounts[food.canteen] = (canteenCounts[food.canteen] || 0) + 1;
    });

    orders.forEach((order) => {
      order.items.forEach((item) => {
        topItems[item.name] = (topItems[item.name] || 0) + item.qty;
      });
    });

    const topItem = Object.keys(topItems).sort((a, b) => topItems[b] - topItems[a])[0] || "";

    res.json({
      foodsCount: foods.length,
      ordersCount: orders.length,
      revenue,
      topItem,
      canteenCounts
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch dashboard stats" });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});

app.listen(PORT, () => console.log("Server running on port " + PORT));
