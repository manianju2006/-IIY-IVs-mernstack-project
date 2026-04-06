const STORAGE_KEYS = {
  user: "quickbyte_user",
  loggedIn: "quickbyte_logged_in",
  authToken: "quickbyte_auth_token",
  authRole: "quickbyte_auth_role",
  theme: "quickbyte_theme",
  cart: "quickbyte_cart",
  orders: "quickbyte_orders",
  deadline: "quickbyte_deadline",
  adminFoods: "quickbyte_admin_foods"
};

const DEFAULT_MENU = {
  pencil: {
    title: "Pencil Canteen",
    description: "Comfort food for quick breaks between classes.",
    items: [
      { canteen: "pencil", category: "Rice", name: "Biryani", price: 120, image: "biryani.jpg" },
      { canteen: "pencil", category: "Rice", name: "Fried Rice", price: 90, image: "friedrice.jpg" }
    ]
  },
  aparna: {
    title: "Aparna Canteen",
    description: "Fast favorites for everyday cravings.",
    items: [
      { canteen: "aparna", category: "Snacks", name: "Noodles", price: 80, image: "noodles.jpg" },
      { canteen: "aparna", category: "Snacks", name: "Burger", price: 70, image: "burger.jpg" }
    ]
  },
  ball: {
    title: "Ball Canteen",
    description: "Crowd-pleasers served hot and quick.",
    items: [
      { canteen: "ball", category: "Fast Meal", name: "Burger", price: 70, image: "burger.jpg" },
      { canteen: "ball", category: "Rice", name: "Fried Rice", price: 90, image: "friedrice.jpg" }
    ]
  }
};

let paymentMethod = "";
let currentCanteenKey = "";
let currentSearchTerm = "";
let currentSortMode = "featured";
const API_BASE_URL = "";
let dashboardStatsCache = null;
let adminSuggestedImageUrl = "";
let adminImageSuggestionSource = "";
let adminImageSuggestionTimer = null;
let adminImageSuggestionToken = 0;
let adminImageCandidates = [];
let editingFoodId = "";
let authSessionCache = null;
let adminUsersCache = [];
let accountOrdersSyncTimer = null;
let accountOrdersSyncInFlight = false;
let adminOrdersSyncTimer = null;
let adminOrdersSyncInFlight = false;
let hasRegisteredOrderVisibilitySync = false;

function getThemePreference() {
  return localStorage.getItem(STORAGE_KEYS.theme) || "light";
}

function setThemePreference(theme) {
  localStorage.setItem(STORAGE_KEYS.theme, theme);
}

function updateThemeToggleLabel() {
  const toggle = document.getElementById("themeToggle");
  const toggleLabel = document.getElementById("themeToggleLabel");

  if (!toggle || !toggleLabel) {
    return;
  }

  const isDark = document.body.dataset.theme === "dark";
  toggleLabel.textContent = isDark ? "Dark mode" : "Light mode";
  toggle.setAttribute("aria-pressed", isDark ? "true" : "false");
  toggle.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
}

function applyTheme(theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.body.dataset.theme = nextTheme;
  setThemePreference(nextTheme);
  updateThemeToggleLabel();
}

function toggleTheme() {
  applyTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
}

function ensureThemeToggle() {
  if (document.getElementById("themeToggle")) {
    updateThemeToggleLabel();
    return;
  }

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.id = "themeToggle";
  toggle.className = "theme-toggle";
  toggle.setAttribute("aria-live", "polite");
  toggle.innerHTML = "<span class='theme-toggle-icon' aria-hidden='true'>T</span><span id='themeToggleLabel'>Light mode</span>";
  toggle.addEventListener("click", toggleTheme);
  document.body.appendChild(toggle);
  updateThemeToggleLabel();
}

function ensureDeadlineSelectOptions() {
  const hourField = document.getElementById("deadlineHour");
  const minuteField = document.getElementById("deadlineMinute");

  if (!hourField || !minuteField) {
    return;
  }

  if (!hourField.options.length) {
    hourField.innerHTML = Array.from({ length: 24 }, (_, hour) => {
      const value = String(hour).padStart(2, "0");
      return '<option value="' + value + '">' + value + "</option>";
    }).join("");
  }

  if (!minuteField.options.length) {
    minuteField.innerHTML = Array.from({ length: 60 }, (_, minute) => {
      const value = String(minute).padStart(2, "0");
      return '<option value="' + value + '">' + value + "</option>";
    }).join("");
  }
}

function setDeadlineFields(value) {
  const hourField = document.getElementById("deadlineHour");
  const minuteField = document.getElementById("deadlineMinute");

  if (!hourField || !minuteField) {
    return;
  }

  ensureDeadlineSelectOptions();
  const [hour = "12", minute = "00"] = String(value || "12:00").split(":");
  hourField.value = String(hour).padStart(2, "0");
  minuteField.value = String(minute).padStart(2, "0").slice(0, 2);
}

function getSelectedDeadlineValue() {
  const hourField = document.getElementById("deadlineHour");
  const minuteField = document.getElementById("deadlineMinute");

  if (!hourField || !minuteField) {
    return "";
  }

  return String(hourField.value || "").trim() + ":" + String(minuteField.value || "").trim();
}

async function apiRequest(path, options) {
  const requestOptions = {
    ...(options || {}),
    headers: {
      ...((options && options.headers) || {})
    }
  };
  const authToken = getAuthToken();

  if (authToken) {
    requestOptions.headers.Authorization = "Bearer " + authToken;
  }

  const response = await fetch(API_BASE_URL + path, requestOptions);
  let payload = null;

  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }

  if (!response.ok) {
    throw new Error((payload && payload.message) || "Request failed");
  }

  return payload;
}

async function syncFoodsFromBackend() {
  try {
    const foods = await apiRequest("/foods");

    if (!Array.isArray(foods)) {
      return;
    }

    const normalizedFoods = foods.map((food) => ({
      _id: food._id || "",
      canteen: food.canteen || "pencil",
      category: food.category || "Chef Pick",
      name: food.name,
      price: Number(food.price),
      image: resolveFoodImage(food.name, food.image, food.category)
    }));

    saveAdminFoods(normalizedFoods);
  } catch (error) {
    // The app still works from local storage when the backend is unavailable.
  }
}

async function syncOrdersFromBackend() {
  try {
    const role = getAuthRole();
    const endpoint = role === "admin" ? "/orders" : role === "user" ? "/my-orders" : "";

    if (!endpoint) {
      return;
    }

    const orders = await apiRequest(endpoint);

    if (!Array.isArray(orders)) {
      return;
    }

    const normalizedOrders = orders.map(normalizeOrderRecord);

    saveOrders(normalizedOrders);
  } catch (error) {
    // Fall back to local state when the backend is unavailable.
  }
}

async function syncAccountOrdersAndRender() {
  if (accountOrdersSyncInFlight || document.body.dataset.page !== "account" || getAuthRole() !== "user") {
    return;
  }

  accountOrdersSyncInFlight = true;

  try {
    await syncOrdersFromBackend();
  } finally {
    accountOrdersSyncInFlight = false;
    renderAccount();
  }
}

async function syncAdminOrdersAndRender() {
  if (adminOrdersSyncInFlight || document.body.dataset.page !== "admin-orders" || getAuthRole() !== "admin") {
    return;
  }

  adminOrdersSyncInFlight = true;

  try {
    await syncOrdersFromBackend();
    await syncDashboardStats();
  } finally {
    adminOrdersSyncInFlight = false;
    renderAdminPanel();
  }
}

function startAccountOrdersAutoSync() {
  if (document.body.dataset.page !== "account" || getAuthRole() !== "user") {
    return;
  }

  if (accountOrdersSyncTimer) {
    clearInterval(accountOrdersSyncTimer);
  }

  accountOrdersSyncTimer = setInterval(() => {
    if (document.visibilityState === "visible") {
      syncAccountOrdersAndRender();
    }
  }, 10000);

  if (!hasRegisteredOrderVisibilitySync) {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      syncAccountOrdersAndRender();
      syncAdminOrdersAndRender();
    });
    hasRegisteredOrderVisibilitySync = true;
  }
}

function startAdminOrdersAutoSync() {
  if (document.body.dataset.page !== "admin-orders" || getAuthRole() !== "admin") {
    return;
  }

  if (adminOrdersSyncTimer) {
    clearInterval(adminOrdersSyncTimer);
  }

  adminOrdersSyncTimer = setInterval(() => {
    if (document.visibilityState === "visible") {
      syncAdminOrdersAndRender();
    }
  }, 8000);

  if (!hasRegisteredOrderVisibilitySync) {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      syncAccountOrdersAndRender();
      syncAdminOrdersAndRender();
    });
    hasRegisteredOrderVisibilitySync = true;
  }
}

async function syncDashboardStats() {
  try {
    dashboardStatsCache = await apiRequest("/dashboard/stats");
  } catch (error) {
    dashboardStatsCache = null;
  }
}

async function syncAdminUsers() {
  try {
    const users = await apiRequest("/admin/users");
    adminUsersCache = Array.isArray(users) ? users : [];
  } catch (error) {
    adminUsersCache = [];
  }
}

function getStoredJson(key, fallback) {
  try {
    const rawValue = localStorage.getItem(key);
    return rawValue ? JSON.parse(rawValue) : fallback;
  } catch (error) {
    return fallback;
  }
}

function setStoredJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getOrdersStorageKey() {
  const role = getAuthRole();
  const user = getUser();

  if (role === "admin") {
    return STORAGE_KEYS.orders + "_admin";
  }

  if (role === "user" && user.email) {
    return STORAGE_KEYS.orders + "_" + user.email.toLowerCase();
  }

  return STORAGE_KEYS.orders;
}

function normalizeOrderRecord(order) {
  return {
    _id: order && order._id ? String(order._id) : "",
    userEmail: order && order.userEmail ? order.userEmail : "",
    items: Array.isArray(order && order.items) ? order.items : [],
    payment: order && order.payment ? order.payment : "Unknown",
    place: order && order.place ? order.place : "Campus pickup",
    total: Number((order && order.total) || 0),
    time: order && order.time ? order.time : "",
    status: order && order.status ? order.status : "Placed",
    review: order && order.review ? {
      rating: Number(order.review.rating || 0),
      comment: order.review.comment || "",
      createdAt: order.review.createdAt || ""
    } : null
  };
}

function getUser() {
  return getStoredJson(STORAGE_KEYS.user, {
    email: localStorage.getItem("email") || "",
    password: ""
  });
}

function saveUser(user) {
  setStoredJson(STORAGE_KEYS.user, user);
  localStorage.setItem("email", user.email);
  localStorage.removeItem("pass");
}

function getAuthToken() {
  return localStorage.getItem(STORAGE_KEYS.authToken) || "";
}

function getAuthRole() {
  return localStorage.getItem(STORAGE_KEYS.authRole) || "";
}

function saveAuthSession(token, role, user) {
  localStorage.setItem(STORAGE_KEYS.authToken, token || "");
  localStorage.setItem(STORAGE_KEYS.authRole, role || "");
  authSessionCache = {
    token: token || "",
    role: role || "",
    user: user || null
  };

  if (user && user.email) {
    saveUser({ email: user.email, password: "" });
  }
}

function clearAuthSession() {
  localStorage.removeItem(STORAGE_KEYS.authToken);
  localStorage.removeItem(STORAGE_KEYS.authRole);
  localStorage.removeItem(STORAGE_KEYS.loggedIn);
  localStorage.removeItem("admin");
  authSessionCache = null;
}

function isUserLoggedIn() {
  return getAuthRole() === "user" && Boolean(getAuthToken());
}

function setUserLoggedIn(value) {
  localStorage.setItem(STORAGE_KEYS.loggedIn, value ? "true" : "false");
}

function isAdminLoggedIn() {
  return getAuthRole() === "admin" && Boolean(getAuthToken());
}

function getCart() {
  return getStoredJson(STORAGE_KEYS.cart, getStoredJson("cart", []));
}

function saveCart(cart) {
  setStoredJson(STORAGE_KEYS.cart, cart);
  setStoredJson("cart", cart);
}

function getOrders() {
  return getStoredJson(getOrdersStorageKey(), getStoredJson(STORAGE_KEYS.orders, getStoredJson("orders", [])));
}

function saveOrders(orders) {
  setStoredJson(getOrdersStorageKey(), orders);
  setStoredJson(STORAGE_KEYS.orders, orders);
  setStoredJson("orders", orders);
}

function getDeadline() {
  return localStorage.getItem(STORAGE_KEYS.deadline) || localStorage.getItem("deadline") || "";
}

function saveDeadline(value) {
  localStorage.setItem(STORAGE_KEYS.deadline, value);
  localStorage.setItem("deadline", value);
}

function getAdminFoods() {
  return getStoredJson(STORAGE_KEYS.adminFoods, getStoredJson("foods", []));
}

function saveAdminFoods(foods) {
  setStoredJson(STORAGE_KEYS.adminFoods, foods);
  setStoredJson("foods", foods);
}

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

async function hydrateAuthSession() {
  const token = getAuthToken();

  if (!token) {
    authSessionCache = null;
    setUserLoggedIn(false);
    localStorage.removeItem("admin");
    return null;
  }

  try {
    const session = await apiRequest("/auth/session");
    authSessionCache = {
      token,
      role: session.role,
      user: session.user || null
    };

    localStorage.setItem(STORAGE_KEYS.authRole, session.role || "");
    setUserLoggedIn(session.role === "user");

    if (session.role === "admin") {
      localStorage.setItem("admin", "true");
    } else {
      localStorage.removeItem("admin");
    }

    if (session.user && session.user.email) {
      saveUser({ email: session.user.email, password: "" });
    }

    return authSessionCache;
  } catch (error) {
    clearAuthSession();
    return null;
  }
}

function formatCurrency(value) {
  return "Rs. " + Number(value).toFixed(0);
}

function formatDisplayDate(value) {
  const parsedDate = value ? new Date(value) : null;

  if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
    return value || "Just now";
  }

  return parsedDate.toLocaleString([], {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatShortDate(value) {
  const parsedDate = value ? new Date(value) : null;

  if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
    return value || "Unknown";
  }

  return parsedDate.toLocaleDateString([], {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function getOrderTimestamp(order) {
  const parsedDate = order && order.time ? new Date(order.time) : null;

  if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
    return 0;
  }

  return parsedDate.getTime();
}

function getSortedOrders(orders) {
  return [...orders].sort((firstOrder, secondOrder) => getOrderTimestamp(secondOrder) - getOrderTimestamp(firstOrder));
}

function isOrderReviewable(order) {
  const normalizedStatus = String((order && order.status) || "").toLowerCase();

  return normalizedStatus === "accepted" || normalizedStatus === "ready" || normalizedStatus === "completed" || normalizedStatus === "delivered";
}

function getOrderStatusTone(status) {
  const normalizedStatus = String(status || "").toLowerCase();

  if (normalizedStatus === "ready") {
    return "success";
  }

  if (normalizedStatus === "accepted") {
    return "warm";
  }

  if (normalizedStatus === "preparing") {
    return "warm";
  }

  return "default";
}

function buildRatingStars(rating) {
  const safeRating = Math.max(0, Math.min(5, Number(rating || 0)));

  return [1, 2, 3, 4, 5]
    .map((value) => (value <= safeRating ? "&#9733;" : "&#9734;"))
    .join("");
}

function getGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) {
    return "Good morning";
  }

  if (hour < 17) {
    return "Good afternoon";
  }

  return "Good evening";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function isDirectImageUrl(imageValue) {
  return /^https?:\/\/.+\.(jpg|jpeg|png|webp|gif|avif)(\?.*)?$/i.test(String(imageValue || "").trim());
}

function isGeneratedFoodImage(imageValue) {
  return String(imageValue || "").trim().startsWith("data:image/svg+xml");
}

function getCuratedFoodImage(name) {
  const normalizedName = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

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
    item.match.some((term) => normalizedName === term)
  );

  return matchedItem ? matchedItem.image : "";
}

function resolveFoodImage(name, imageValue, category) {
  const trimmedImage = (imageValue || "").trim();

  if (trimmedImage && !isLegacyAutoImage(trimmedImage) && (!/^https?:\/\//i.test(trimmedImage) || isDirectImageUrl(trimmedImage))) {
    return trimmedImage;
  }
  const curatedImage = getCuratedFoodImage(name);

  if (curatedImage) {
    return curatedImage;
  }

  return buildGeneratedFoodImage(name, category);
}

function getAdminResolvedImage(name, imageValue, category) {
  return resolveFoodImage(name, imageValue || adminSuggestedImageUrl, category);
}

function setFoodSuggestionStatus(message, isError) {
  const status = document.getElementById("foodSuggestionStatus");

  if (!status) {
    return;
  }

  status.textContent = message;
  status.style.color = isError ? "#c74b4b" : "";
}

function clearSuggestedFoodImage() {
  adminSuggestedImageUrl = "";
  adminImageSuggestionSource = "";
  adminImageCandidates = [];
  renderFoodImageCandidates();
}

function updateFoodFormState() {
  const title = document.getElementById("foodFormTitle");
  const submitButton = document.getElementById("foodSubmitButton");
  const cancelButton = document.getElementById("foodCancelButton");
  const isEditing = Boolean(editingFoodId);

  if (title) {
    title.textContent = isEditing ? "Edit menu item" : "Add a new menu item";
  }

  if (submitButton) {
    submitButton.textContent = isEditing ? "Save Changes" : "Add Food";
  }

  if (cancelButton) {
    cancelButton.hidden = !isEditing;
  }
}

function resetFoodForm() {
  const nameField = document.getElementById("foodname");
  const priceField = document.getElementById("foodprice");
  const canteenField = document.getElementById("foodcanteen");
  const categoryField = document.getElementById("foodcategory");
  const imageField = document.getElementById("foodimage");

  editingFoodId = "";

  if (nameField) {
    nameField.value = "";
  }

  if (priceField) {
    priceField.value = "";
  }

  if (canteenField) {
    canteenField.value = "pencil";
  }

  if (categoryField) {
    categoryField.value = "";
  }

  if (imageField) {
    imageField.value = "";
  }

  clearSuggestedFoodImage();
  setFoodSuggestionStatus("Type a dish name to fetch an image automatically.", false);
  updateFoodFormState();
  updateFoodPreview();
}

async function suggestFoodImage(name, category) {
  const payload = await apiRequest(
    "/foods/suggest-image?name=" + encodeURIComponent(name) + "&category=" + encodeURIComponent(category || "")
  );

  return payload && payload.image ? payload : { image: "", source: "fallback" };
}

async function fetchFoodImageCandidates(name, category) {
  const payload = await apiRequest(
    "/foods/image-candidates?name=" + encodeURIComponent(name) + "&category=" + encodeURIComponent(category || "")
  );

  return payload && Array.isArray(payload.candidates) ? payload.candidates : [];
}

function renderFoodImageCandidates() {
  const container = document.getElementById("foodImageCandidates");

  if (!container) {
    return;
  }

  if (!adminImageCandidates.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = adminImageCandidates
    .map(
      (candidate, index) => `
        <button
          type="button"
          class="ghost-button"
          onclick="selectFoodImageCandidate(${index})"
          style="display:flex; align-items:center; gap:12px; width:100%; text-align:left;"
        >
          <img src="${escapeHtml(candidate.image)}" alt="${escapeHtml(candidate.title || "Suggested image")}" style="width:72px; height:72px; object-fit:cover; border-radius:14px;">
          <span>${escapeHtml(candidate.title || "Suggested image")}</span>
        </button>
      `
    )
    .join("");
}

function selectFoodImageCandidate(index) {
  const imageField = document.getElementById("foodimage");
  const candidate = adminImageCandidates[index];

  if (!imageField || !candidate) {
    return;
  }

  imageField.value = candidate.image;
  adminSuggestedImageUrl = candidate.image;
  adminImageSuggestionSource = "candidate";
  setFoodSuggestionStatus("Selected the image you chose.", false);
  renderFoodImageCandidates();
  updateFoodPreview();
}

function queueFoodImageSuggestion() {
  const nameField = document.getElementById("foodname");
  const categoryField = document.getElementById("foodcategory");
  const imageField = document.getElementById("foodimage");

  if (!nameField || !categoryField || !imageField) {
    return;
  }

  window.clearTimeout(adminImageSuggestionTimer);

  if (imageField.value.trim()) {
    clearSuggestedFoodImage();
    setFoodSuggestionStatus("Using the image link or file name you entered.", false);
    return;
  }

  const name = nameField.value.trim();
  const category = categoryField.value.trim() || "Chef Pick";

  if (!name) {
    clearSuggestedFoodImage();
    setFoodSuggestionStatus("Type a dish name to fetch an image automatically.", false);
    return;
  }

  const requestToken = ++adminImageSuggestionToken;
  setFoodSuggestionStatus("Looking for a matching image...", false);

  adminImageSuggestionTimer = window.setTimeout(async () => {
    try {
      const suggestion = await suggestFoodImage(name, category);
      const latestNameField = document.getElementById("foodname");
      const latestImageField = document.getElementById("foodimage");

      if (
        requestToken !== adminImageSuggestionToken ||
        !latestNameField ||
        !latestImageField ||
        latestImageField.value.trim() ||
        latestNameField.value.trim() !== name
      ) {
        return;
      }

      adminSuggestedImageUrl = suggestion.image || "";
      adminImageSuggestionSource = suggestion.source || "";
      adminImageCandidates = await fetchFoodImageCandidates(name, category);
      renderFoodImageCandidates();

      if (adminSuggestedImageUrl) {
        setFoodSuggestionStatus(
          adminImageSuggestionSource === "search"
            ? "Found a web image match. You can also choose from the suggestions below."
            : "Image fetched automatically for this dish. You can also choose another suggestion below.",
          false
        );
      } else {
        setFoodSuggestionStatus(
          adminImageCandidates.length
            ? "Pick one of the image suggestions below."
            : "No strong image match found, using the built-in fallback.",
          false
        );
      }

      updateFoodPreview();
    } catch (error) {
      if (requestToken !== adminImageSuggestionToken) {
        return;
      }

      clearSuggestedFoodImage();
      setFoodSuggestionStatus("Could not fetch an image right now, using the built-in fallback.", true);
      updateFoodPreview();
    }
  }, 450);
}

function showToast(message, isError) {
  const toast = document.getElementById("toast");

  if (!toast) {
    alert(message);
    return;
  }

  toast.textContent = message;
  toast.className = "toast show" + (isError ? " error" : "");

  window.clearTimeout(showToast.timeoutId);
  showToast.timeoutId = window.setTimeout(() => {
    toast.className = "toast";
  }, 2600);
}

function getAllCanteenData() {
  const adminFoods = getAdminFoods();
  const menu = JSON.parse(JSON.stringify(DEFAULT_MENU));

  adminFoods.forEach((food) => {
    const targetKey = menu[food.canteen] ? food.canteen : "pencil";

    menu[targetKey].items.push({
      _id: food._id || "",
      canteen: targetKey,
      category: food.category || "Chef Pick",
      name: food.name,
      price: Number(food.price),
      image: resolveFoodImage(food.name, food.image, food.category)
    });
  });

  return menu;
}

function getFilteredItems(data) {
  let items = data.items || [];

  if (currentSearchTerm) {
    items = items.filter((item) => item.name.toLowerCase().includes(currentSearchTerm.toLowerCase()));
  }

  if (currentSortMode === "price-low") {
    return [...items].sort((a, b) => a.price - b.price);
  }

  if (currentSortMode === "price-high") {
    return [...items].sort((a, b) => b.price - a.price);
  }

  if (currentSortMode === "name") {
    return [...items].sort((a, b) => a.name.localeCompare(b.name));
  }

  return items;
}

function getCanteenMeta(canteenKey) {
  const meta = {
    pencil: {
      badge: "Fast Lunch",
      eta: "10-15 min",
      rating: "4.7",
      theme: "linear-gradient(135deg, rgba(61,30,17,0.2), rgba(61,30,17,0.55)), url('biryani.jpg')"
    },
    aparna: {
      badge: "Most Loved",
      eta: "12-18 min",
      rating: "4.8",
      theme: "linear-gradient(135deg, rgba(61,30,17,0.18), rgba(61,30,17,0.58)), url('noodles.jpg')"
    },
    ball: {
      badge: "Quick Bites",
      eta: "8-12 min",
      rating: "4.6",
      theme: "linear-gradient(135deg, rgba(61,30,17,0.18), rgba(61,30,17,0.58)), url('burger.jpg')"
    }
  };

  return meta[canteenKey] || {
    badge: "Chef Picks",
    eta: "10-15 min",
    rating: "4.7",
    theme: "linear-gradient(135deg, rgba(61,30,17,0.2), rgba(61,30,17,0.56)), url('burger.jpg')"
  };
}

function buildItemNote(item) {
  const category = String(item.category || "Chef Pick").toLowerCase();

  if (category.includes("rice")) {
    return "Comforting, filling, and served hot for a proper meal break.";
  }

  if (category.includes("snack")) {
    return "Perfect for quick cravings between classes without feeling too heavy.";
  }

  if (category.includes("fast")) {
    return "A familiar grab-and-go favorite that works well for busy afternoons.";
  }

  return "Freshly added to the menu with a simple, crowd-friendly flavor profile.";
}

function renderMenu(canteenKey) {
  const menuArea = document.getElementById("menuArea");
  const data = getAllCanteenData()[canteenKey];
  const filteredItems = data ? getFilteredItems(data) : [];
  const canteenMeta = getCanteenMeta(canteenKey);
  const categories = [...new Set((data && data.items ? data.items : []).map((item) => item.category || "Chef Pick"))].slice(0, 3);
  const featuredNames = filteredItems.slice(0, 2).map((item) => item.name).join(" and ");

  if (!menuArea || !data) {
    return;
  }

  currentCanteenKey = canteenKey;

  document.querySelectorAll("[data-canteen-card]").forEach((card) => {
    card.classList.toggle("active-card", card.dataset.canteenCard === canteenKey);
  });

  menuArea.innerHTML = `
    <section class="menu-experience">
      <article class="menu-hero" style="--menu-hero-image:${canteenMeta.theme};">
        <div class="menu-hero-copy">
          <p class="eyebrow">Now Serving</p>
          <h2>${escapeHtml(data.title)}</h2>
          <p>${escapeHtml(data.description)}</p>
          <div class="menu-hero-chips">
            <span>${escapeHtml(canteenMeta.badge)}</span>
            <span>${filteredItems.length} dishes available</span>
            <span>${escapeHtml(canteenMeta.eta)} delivery window</span>
          </div>
        </div>
        <div class="menu-hero-side">
          <div class="menu-hero-stat">
            <strong>${escapeHtml(canteenMeta.rating)} / 5</strong>
            <span>Popular with students ordering quick campus meals.</span>
          </div>
          <div class="menu-hero-stat">
            <strong>${escapeHtml(featuredNames || "Chef picks ready")}</strong>
            <span>${escapeHtml(categories.join(" | ") || "Fresh dishes")} on this canteen menu.</span>
          </div>
          <a class="ghost-button" href="cart.html">Go to Cart</a>
        </div>
      </article>
      <section class="menu-panel">
        <div class="menu-highlights">
          ${categories.map((category) => `<span>${escapeHtml(category)}</span>`).join("")}
        </div>
        <div class="menu-toolbar">
          <input id="menuSearch" type="search" placeholder="Search dishes, for example biryani or burger" value="${escapeHtml(currentSearchTerm)}" oninput="updateMenuSearch(this.value)">
          <select id="menuSort" onchange="updateMenuSort(this.value)">
            <option value="featured" ${currentSortMode === "featured" ? "selected" : ""}>Featured</option>
            <option value="price-low" ${currentSortMode === "price-low" ? "selected" : ""}>Price: Low to High</option>
            <option value="price-high" ${currentSortMode === "price-high" ? "selected" : ""}>Price: High to Low</option>
            <option value="name" ${currentSortMode === "name" ? "selected" : ""}>Name</option>
          </select>
          <div class="stat-chip">${filteredItems.length} items shown</div>
        </div>
        <div class="menu-grid">
          ${filteredItems.length
            ? filteredItems
            .map(
              (item) => `
                <article class="menu-card">
                  <img
                    class="${isGeneratedFoodImage(item.image) ? "menu-image-generated" : "menu-image-photo"}"
                    src="${escapeHtml(item.image)}"
                    alt="${escapeHtml(item.name)}"
                  >
                  <div class="menu-card-content">
                    <div class="menu-card-head">
                      <span class="menu-badge">${escapeHtml(item.category || "Chef Pick")}</span>
                      <div class="menu-card-title-row">
                        <h3>${escapeHtml(item.name)}</h3>
                        <strong class="menu-price">${formatCurrency(item.price)}</strong>
                      </div>
                    </div>
                    <p class="menu-item-note">${escapeHtml(buildItemNote(item))}</p>
                    <div class="menu-card-footer">
                      <div class="menu-item-meta">
                        <span>Freshly served</span>
                        <span>${escapeHtml(canteenMeta.eta)}</span>
                      </div>
                      <button class="primary-button menu-action-button" onclick="addCart('${escapeHtml(item.name)}', ${Number(item.price)})">Add to Cart</button>
                    </div>
                  </div>
                </article>
              `
            )
            .join("")
            : '<div class="empty-card menu-empty">No dishes matched your search.</div>'}
        </div>
      </section>
    </section>
  `;
}

function updateMenuSearch(value) {
  currentSearchTerm = value.trim();

  if (currentCanteenKey) {
    renderMenu(currentCanteenKey);
  }
}

function updateMenuSort(value) {
  currentSortMode = value;

  if (currentCanteenKey) {
    renderMenu(currentCanteenKey);
  }
}

function renderCanteenCards() {
  const canteenGrid = document.getElementById("canteenGrid");
  const summary = document.getElementById("canteenSummary");
  const menu = getAllCanteenData();
  const canteenKeys = Object.keys(menu);

  if (!canteenGrid) {
    return;
  }

  canteenGrid.innerHTML = canteenKeys
    .map((key) => {
      const canteenMeta = getCanteenMeta(key);

      return `
        <article class="canteen-card" data-canteen-card="${key}" style="--canteen-image:${canteenMeta.theme};">
          <div class="canteen-card-top">
            <span class="canteen-pill">${escapeHtml(canteenMeta.badge)}</span>
            <span class="canteen-rating">${escapeHtml(canteenMeta.rating)} rating</span>
          </div>
          <h3>${escapeHtml(menu[key].title)}</h3>
          <p>${escapeHtml(menu[key].description)}</p>
          <div class="canteen-meta-row">
            <span>${menu[key].items.length} dishes</span>
            <span>${escapeHtml(canteenMeta.eta)}</span>
          </div>
          <div class="canteen-card-actions">
            <strong>${escapeHtml(menu[key].items[0] ? menu[key].items[0].name : "Chef picks")}</strong>
            <button class="ghost-button card-action-button" onclick="renderMenu('${key}')">View Menu</button>
          </div>
        </article>
      `;
    })
    .join("");

  if (summary) {
    const totalItems = canteenKeys.reduce((sum, key) => sum + menu[key].items.length, 0);
    summary.textContent = canteenKeys.length + " canteens | " + totalItems + " dishes";
  }

  if (canteenKeys.length > 0) {
    renderMenu(canteenKeys[0]);
  }
}

async function register() {
  const emailInput = document.getElementById("regemail");
  const passwordInput = document.getElementById("regpass");

  if (!emailInput || !passwordInput) {
    return;
  }

  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();

  if (!email || !password) {
    showToast("Please fill in both email and password.", true);
    return;
  }

  if (password.length < 4) {
    showToast("Use at least 4 characters for the password.", true);
    return;
  }

  try {
    await apiRequest("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    saveUser({ email, password: "" });
    setUserLoggedIn(false);
    showToast("Account created. You can log in now.");
    window.setTimeout(() => {
      window.location = "index.html";
    }, 900);
  } catch (error) {
    showToast(error.message || "Failed to create account.", true);
  }
}

async function login() {
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");

  if (!emailInput || !passwordInput) {
    return;
  }

  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();
  try {
    const session = await apiRequest("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    saveAuthSession(session.token, session.role, session.user);
    setUserLoggedIn(true);
    showToast("Login successful.");
    window.setTimeout(() => {
      window.location = "canteens.html";
    }, 700);
  } catch (error) {
    showToast(error.message || "Wrong email or password.", true);
  }
}

async function adminLogin() {
  const userField = document.getElementById("adminuser");
  const passwordField = document.getElementById("adminpass");

  if (!userField || !passwordField) {
    return;
  }

  const username = userField.value.trim();
  const password = passwordField.value.trim();

  if (!username || !password) {
    showToast("Please enter admin username and password.", true);
    return;
  }

  try {
    const session = await apiRequest("/auth/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    saveAuthSession(session.token, session.role, session.user);
    localStorage.setItem("admin", "true");
    showToast("Admin login successful.");
    window.setTimeout(() => {
      window.location = "adminpanel.html";
    }, 700);
  } catch (error) {
    showToast(error.message || "Wrong admin username or password.", true);
  }
}

function addCart(name, price) {
  const cart = getCart();
  const existingItem = cart.find((item) => item.name === name);

  if (existingItem) {
    existingItem.qty += 1;
  } else {
    cart.push({ name, price: Number(price), qty: 1 });
  }

  saveCart(cart);
  updateCartBadge();
  showToast(name + " added to cart.");
}

function updateCartBadge() {
  const badge = document.getElementById("cartCount");

  if (!badge) {
    return;
  }

  const count = getCart().reduce((total, item) => total + item.qty, 0);
  badge.textContent = count;
}

function increase(index) {
  const cart = getCart();

  if (!cart[index]) {
    return;
  }

  cart[index].qty += 1;
  saveCart(cart);
  renderCart();
}

function decrease(index) {
  const cart = getCart();

  if (!cart[index]) {
    return;
  }

  if (cart[index].qty > 1) {
    cart[index].qty -= 1;
  }

  saveCart(cart);
  renderCart();
}

function removeItem(index) {
  const cart = getCart();
  cart.splice(index, 1);
  saveCart(cart);
  renderCart();
  showToast("Item removed from cart.");
}

function goToPayment() {
  const placeField = document.getElementById("place");

  if (!placeField || !placeField.value) {
    showToast("Please select a delivery location.", true);
    return;
  }

  if (getCart().length === 0) {
    showToast("Your cart is empty.", true);
    return;
  }

  localStorage.setItem("place", placeField.value);
  window.location = "payment.html";
}

function showUPI() {
  const upiOptions = document.getElementById("upiOptions");
  if (upiOptions) {
    upiOptions.style.display = "grid";
  }
}

function selectPayment(method) {
  paymentMethod = method;

  document.querySelectorAll("[data-payment-option]").forEach((button) => {
    button.classList.toggle("selected", button.dataset.paymentOption === method);
  });

  const chosenMethod = document.getElementById("chosenMethod");
  if (chosenMethod) {
    chosenMethod.textContent = method;
  }

  showToast(method + " selected.");
}

async function placeOrder() {
  const cart = getCart();
  const place = localStorage.getItem("place") || "Campus pickup";

  if (paymentMethod === "") {
    showToast("Please select a payment method.", true);
    return;
  }

  if (cart.length === 0) {
    showToast("Your cart is empty.", true);
    return;
  }

  const orders = getOrders();
  const previousOrders = cloneData(orders);
  const previousCart = cloneData(cart);
  const previousPlace = place;
  const draftOrder = {
    items: cart,
    payment: paymentMethod,
    place,
    total: cart.reduce((sum, item) => sum + item.price * item.qty, 0),
    time: new Date().toISOString(),
    status: "Placed",
    review: null
  };
  const optimisticOrder = normalizeOrderRecord(draftOrder);
  orders.unshift(optimisticOrder);

  saveOrders(orders);
  saveCart([]);
  localStorage.removeItem("place");
  paymentMethod = "";

  try {
    const savedOrder = await apiRequest("/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draftOrder)
    });
    const updatedOrders = getOrders();

    if (updatedOrders.length) {
      updatedOrders[0] = normalizeOrderRecord(savedOrder);
      saveOrders(updatedOrders);
    }
  } catch (error) {
    saveOrders(previousOrders);
    saveCart(previousCart);
    localStorage.setItem("place", previousPlace);
    paymentMethod = draftOrder.payment;
    renderCart();
    renderPaymentPage();
    showToast(error.message || "Could not save the order to the backend.", true);
    return;
  }

  const message = document.getElementById("msg");
  if (message) {
    message.textContent = "Order confirmed. Your meal is being prepared.";
  }

  renderAccount();
  updateCartBadge();
  showToast("Order placed successfully.");
}

function togglePassword() {
  const passwordField = document.getElementById("password");
  const icon = document.getElementById("eyeIcon");

  if (!passwordField || !icon) {
    return;
  }

  if (passwordField.type === "password") {
    passwordField.type = "text";
    icon.classList.replace("fa-eye", "fa-eye-slash");
  } else {
    passwordField.type = "password";
    icon.classList.replace("fa-eye-slash", "fa-eye");
  }
}

function renderCart() {
  const container = document.getElementById("cartItems");
  const totalElement = document.getElementById("total");
  const summaryElement = document.getElementById("cartSummary");
  const emptyState = document.getElementById("emptyCart");
  const placeField = document.getElementById("place");
  const cart = getCart();
  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);

  if (!container || !totalElement) {
    return;
  }

  if (placeField && localStorage.getItem("place")) {
    placeField.value = localStorage.getItem("place");
  }

  if (cart.length === 0) {
    container.innerHTML = "";
    totalElement.textContent = formatCurrency(0);

    if (summaryElement) {
      summaryElement.textContent = "Your cart is waiting for something delicious.";
    }

    if (emptyState) {
      emptyState.hidden = false;
    }

    updateCartBadge();
    return;
  }

  if (emptyState) {
    emptyState.hidden = true;
  }

  container.innerHTML = cart
    .map(
      (item, index) => `
        <article class="cart-card">
          <div>
            <h3>${escapeHtml(item.name)}</h3>
            <p>${formatCurrency(item.price)} each</p>
          </div>
          <div class="cart-actions">
            <button class="ghost-button" onclick="decrease(${index})">-</button>
            <span>${item.qty}</span>
            <button class="ghost-button" onclick="increase(${index})">+</button>
            <button class="danger-button" onclick="removeItem(${index})">Delete</button>
          </div>
        </article>
      `
    )
    .join("");

  totalElement.textContent = formatCurrency(total);

  if (summaryElement) {
    summaryElement.textContent = cart.reduce((sum, item) => sum + item.qty, 0) + " items ready for checkout";
  }

  updateCartBadge();
}

async function saveProfile() {
  const emailField = document.getElementById("accountEmail");
  const passwordField = document.getElementById("accountPassword");
  const locationField = document.getElementById("accountLocation");
  const saveButton = document.getElementById("accountSaveButton");

  if (!emailField || !passwordField || !locationField || !saveButton) {
    return;
  }

  const email = emailField.value.trim();
  const password = passwordField.value.trim();
  const location = locationField.value;
  const currentUser = getUser();

  if (!email) {
    showToast("Email cannot be empty.", true);
    return;
  }

  saveButton.disabled = true;
  saveButton.textContent = "Saving...";

  try {
    const response = await apiRequest("/auth/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password
      })
    });

    saveUser({
      email: response && response.user && response.user.email ? response.user.email : email,
      password: password || currentUser.password || ""
    });

    if (authSessionCache && authSessionCache.user) {
      authSessionCache.user.email = response && response.user && response.user.email ? response.user.email : email;
    }
  } catch (error) {
    saveButton.disabled = false;
    saveButton.textContent = "Save Profile";
    showToast(error.message || "Could not update your profile.", true);
    return;
  }

  localStorage.setItem("place", location);

  if (passwordField) {
    passwordField.value = "";
  }

  saveButton.disabled = false;
  saveButton.textContent = "Save Profile";
  syncOrdersFromBackend().finally(renderAccount);
  showToast("Profile updated.");
}

async function submitOrderReview(orderId) {
  const ratingField = document.getElementById("reviewRating-" + orderId);
  const commentField = document.getElementById("reviewComment-" + orderId);

  if (!ratingField || !commentField) {
    return;
  }

  const rating = Number(ratingField.value);
  const comment = commentField.value.trim();

  if (!rating) {
    showToast("Please choose a rating before saving your review.", true);
    return;
  }

  try {
    const updatedOrder = await apiRequest("/orders/" + orderId + "/review", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating, comment })
    });
    const orders = getOrders();
    const orderIndex = orders.findIndex((order) => order._id === orderId);

    if (orderIndex >= 0) {
      orders[orderIndex] = normalizeOrderRecord(updatedOrder);
      saveOrders(orders);
    }

    renderAccount();
    showToast("Review saved.");
  } catch (error) {
    showToast(error.message || "Could not save your review.", true);
  }
}

async function updateOrderStatus(orderId) {
  const statusField = document.getElementById("orderStatus-" + orderId);

  if (!statusField) {
    return;
  }

  const status = String(statusField.value || "").trim();
  const previousValue = statusField.dataset.previousValue || "Placed";
  statusField.disabled = true;

  try {
    const updatedOrder = await apiRequest("/orders/" + orderId + "/status", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    const orders = getOrders();
    const orderIndex = orders.findIndex((order) => order._id === orderId);

    if (orderIndex >= 0) {
      orders[orderIndex] = normalizeOrderRecord(updatedOrder);
      saveOrders(orders);
    }

    statusField.dataset.previousValue = status;
    renderAdminPanel();
    showToast("Order marked " + status + ".");
  } catch (error) {
    statusField.value = previousValue;
    showToast(error.message || "Could not update the order status.", true);
  } finally {
    statusField.disabled = false;
  }
}

async function acceptOrder(orderId) {
  const statusField = document.getElementById("orderStatus-" + orderId);

  if (!statusField) {
    return;
  }

  statusField.value = "Accepted";
  await updateOrderStatus(orderId);
}

function focusReviewForm(orderId) {
  const ratingField = document.getElementById("reviewRating-" + orderId);
  const reviewCard = ratingField ? ratingField.closest(".review-form-card") : null;

  if (reviewCard) {
    reviewCard.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  if (ratingField) {
    ratingField.focus();
  }
}

function renderAccount() {
  const emailField = document.getElementById("accountEmail");
  const passwordField = document.getElementById("accountPassword");
  const locationField = document.getElementById("accountLocation");
  const greeting = document.getElementById("accountGreeting");
  const orderCount = document.getElementById("accountOrders");
  const savedLocation = document.getElementById("accountPlace");
  const spendValue = document.getElementById("accountSpend");
  const reviewedCount = document.getElementById("accountReviewed");
  const favoriteItemValue = document.getElementById("accountFavoriteItem");
  const favoriteItemNote = document.getElementById("accountFavoriteItemNote");
  const lastOrderValue = document.getElementById("accountLastOrder");
  const lastOrderNote = document.getElementById("accountLastOrderNote");
  const pendingReviewsValue = document.getElementById("accountPendingReviews");
  const pendingReviewsNote = document.getElementById("accountPendingReviewsNote");
  const statusChip = document.getElementById("accountStatusChip");
  const reviewChip = document.getElementById("accountReviewChip");
  const recentOrders = document.getElementById("recentOrders");
  const user = getUser();
  const orders = getSortedOrders(getOrders());
  const itemCounts = {};
  const reviewedOrders = orders.filter((order) => order.review && order.review.rating);
  const reviewableOrders = orders.filter((order) => !order.review && order._id && isOrderReviewable(order));
  const latestOrder = orders[0] || null;

  orders.forEach((order) => {
    order.items.forEach((item) => {
      itemCounts[item.name] = (itemCounts[item.name] || 0) + item.qty;
    });
  });

  if (emailField) {
    emailField.value = user.email;
  }

  if (passwordField) {
    passwordField.value = "";
  }

  if (locationField) {
    locationField.value = localStorage.getItem("place") || "";
  }

  if (greeting) {
    greeting.textContent = getGreeting() + (user.email ? ", " + user.email : "");
  }

  if (orderCount) {
    orderCount.textContent = String(orders.length);
  }

  if (savedLocation) {
    savedLocation.textContent = localStorage.getItem("place") || "No delivery location selected yet";
  }

  if (spendValue) {
    spendValue.textContent = formatCurrency(orders.reduce((sum, order) => sum + Number(order.total || 0), 0));
  }

  if (reviewedCount) {
    reviewedCount.textContent = String(reviewedOrders.length);
  }

  const favoriteItem = Object.keys(itemCounts).sort((firstItem, secondItem) => itemCounts[secondItem] - itemCounts[firstItem])[0];

  if (favoriteItemValue) {
    favoriteItemValue.textContent = favoriteItem || "Nothing ordered yet";
  }

  if (favoriteItemNote) {
    favoriteItemNote.textContent = favoriteItem
      ? itemCounts[favoriteItem] + " total item" + (itemCounts[favoriteItem] === 1 ? "" : "s") + " ordered"
      : "Your most repeated dish will appear here once orders start coming in.";
  }

  if (lastOrderValue) {
    lastOrderValue.textContent = latestOrder ? formatShortDate(latestOrder.time) : "No recent order yet";
  }

  if (lastOrderNote) {
    lastOrderNote.textContent = latestOrder
      ? (latestOrder.place || "Campus pickup") + " | " + formatCurrency(latestOrder.total || 0)
      : "Your latest order update will show here.";
  }

  if (pendingReviewsValue) {
    pendingReviewsValue.textContent = String(reviewableOrders.length);
  }

  if (pendingReviewsNote) {
    pendingReviewsNote.textContent = reviewableOrders.length
      ? "Accepted order" + (reviewableOrders.length === 1 ? "" : "s") + " ready for feedback."
      : "Accepted orders will appear here once they are ready for review.";
  }

  if (statusChip) {
    statusChip.textContent = latestOrder
      ? "Latest order: " + (latestOrder.status || "Placed") + " on " + formatShortDate(latestOrder.time)
      : "No live orders yet";
  }

  if (reviewChip) {
    reviewChip.textContent = reviewableOrders.length
      ? reviewableOrders.length + " accepted order" + (reviewableOrders.length === 1 ? "" : "s") + " ready for review"
      : reviewedOrders.length
        ? reviewedOrders.length + " orders reviewed"
        : "Reviews ready when you are";
  }

  if (recentOrders) {
    recentOrders.innerHTML = orders.length
      ? orders
          .slice(0, 5)
          .map(
            (order) => `
              <article class="account-order-card">
                <div class="account-order-head">
                  <div>
                    <h3>${escapeHtml(order.place || "Campus pickup")}</h3>
                    <p>${escapeHtml(formatDisplayDate(order.time || ""))}</p>
                  </div>
                  <div class="account-order-actions">
                    <span class="order-status-badge order-status-${getOrderStatusTone(order.status)}">${escapeHtml(order.status || "Placed")}</span>
                    ${!order.review && order._id && isOrderReviewable(order)
                      ? `<button class="ghost-button review-trigger-button" onclick="focusReviewForm('${escapeHtml(order._id)}')">Review Order</button>`
                      : ""}
                  </div>
                </div>
                <div class="account-order-summary">
                  <span>${escapeHtml(order.payment)} payment</span>
                  <span>${formatCurrency(order.total || 0)}</span>
                </div>
                <div class="account-order-items">
                  ${order.items
                    .map(
                      (item) => `
                        <div class="account-order-item">
                          <span>${escapeHtml(item.name)}</span>
                          <strong>x${Number(item.qty || 0)}</strong>
                        </div>
                      `
                    )
                    .join("")}
                </div>
                ${order.review && order.review.rating
                  ? `
                    <div class="review-display-card">
                      <div class="review-display-head">
                        <strong>Your review</strong>
                        <span class="review-stars">${buildRatingStars(order.review.rating)}</span>
                      </div>
                      <p>${escapeHtml(order.review.comment || "Thanks for rating this order.")}</p>
                    </div>
                  `
                  : order._id && isOrderReviewable(order)
                    ? `
                      <div class="review-form-card">
                        <div class="review-form-head">
                          <strong>Review this order</strong>
                          <span>Tell us how it went</span>
                        </div>
                        <div class="review-form-controls">
                          <select id="reviewRating-${escapeHtml(order._id)}">
                            <option value="">Choose rating</option>
                            <option value="5">5 - Excellent</option>
                            <option value="4">4 - Very good</option>
                            <option value="3">3 - Good</option>
                            <option value="2">2 - Needs work</option>
                            <option value="1">1 - Poor</option>
                          </select>
                          <input id="reviewComment-${escapeHtml(order._id)}" type="text" maxlength="280" placeholder="Add a short note about the food or delivery">
                        </div>
                        <button class="primary-button review-save-button" onclick="submitOrderReview('${escapeHtml(order._id)}')">Save Review</button>
                      </div>
                    `
                    : order._id
                      ? `
                      <div class="review-display-card">
                        <div class="review-display-head">
                          <strong>Review locked for now</strong>
                          <span class="review-stars">${buildRatingStars(0)}</span>
                        </div>
                        <p>You can leave feedback once the admin accepts this order.</p>
                      </div>
                    `
                    : `
                      <div class="review-display-card">
                        <div class="review-display-head">
                          <strong>Review unavailable</strong>
                          <span class="review-stars">${buildRatingStars(0)}</span>
                        </div>
                        <p>This older local order is not linked to the backend, so it cannot be reviewed.</p>
                      </div>
                    `}
              </article>
            `
          )
          .join("")
      : '<div class="empty-card">No recent orders yet. Once you place an order, it will show up here with status and review options. <a href="canteens.html">Browse the menu.</a></div>';
  }
}

function renderPaymentPage() {
  const orderTotal = document.getElementById("paymentTotal");
  const orderLocation = document.getElementById("paymentLocation");
  const cart = getCart();
  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);

  if (orderTotal) {
    orderTotal.textContent = formatCurrency(total);
  }

  if (orderLocation) {
    orderLocation.textContent = localStorage.getItem("place") || "Campus pickup";
  }
}

function renderAdminPanel() {
  const foodContainer = document.getElementById("foodList");
  const orderContainer = document.getElementById("ordersList");
  const recentOrdersContainer = document.getElementById("recentOrdersList");
  const ordersPageSummary = document.getElementById("ordersPageSummary");
  const ordersPageRevenue = document.getElementById("ordersPageRevenue");
  const totalOrders = document.getElementById("totalOrders");
  const foodCount = document.getElementById("foodCount");
  const revenueValue = document.getElementById("revenueValue");
  const topItemValue = document.getElementById("topItemValue");
  const backendStatus = document.getElementById("backendStatus");
  const bestCanteen = document.getElementById("bestCanteen");
  const deadlineHourField = document.getElementById("deadlineHour");
  const deadlineMinuteField = document.getElementById("deadlineMinute");
  const showDeadline = document.getElementById("showDeadline");
  const sideFoodCount = document.getElementById("sideFoodCount");
  const sideTopItem = document.getElementById("sideTopItem");
  const sideBestCanteen = document.getElementById("sideBestCanteen");
  const orders = getOrders();
  const foods = getAdminFoods();
  const topItems = {};
  const orderMarkup = orders.length
    ? orders
        .map(
          (order, index) => `
            <article class="order-card">
              <div class="order-card-head">
                <h3>Order ${index + 1}</h3>
                <span>${escapeHtml(formatDisplayDate(order.time || ""))}</span>
              </div>
              <p>${escapeHtml(order.place || "Campus pickup")} | ${escapeHtml(order.payment)} | ${formatCurrency(order.total || 0)}</p>
              <p>${escapeHtml(order.userEmail || "Customer")} | ${escapeHtml(order.status || "Placed")}</p>
              <ul class="order-items">
                ${order.items
                  .map((item) => `<li>${escapeHtml(item.name)} x ${item.qty}</li>`)
                  .join("")}
              </ul>
              ${order._id
                ? `
                  <div class="review-form-controls">
                    <select id="orderStatus-${escapeHtml(order._id)}" data-previous-value="${escapeHtml(order.status || "Placed")}">
                      <option value="Placed" ${(order.status || "Placed") === "Placed" ? "selected" : ""}>Placed</option>
                      <option value="Accepted" ${(order.status || "") === "Accepted" ? "selected" : ""}>Accepted</option>
                      <option value="Preparing" ${(order.status || "") === "Preparing" ? "selected" : ""}>Preparing</option>
                      <option value="Ready" ${(order.status || "") === "Ready" ? "selected" : ""}>Ready</option>
                    </select>
                    <button class="ghost-button" onclick="updateOrderStatus('${escapeHtml(order._id)}')">Save Status</button>
                    ${(order.status || "").toLowerCase() !== "accepted" && (order.status || "").toLowerCase() !== "ready"
                      ? `<button class="primary-button" onclick="acceptOrder('${escapeHtml(order._id)}')">Accept Order</button>`
                      : ""}
                  </div>
                `
                : ""}
              ${order.review && order.review.rating
                ? `<p>Review: ${buildRatingStars(order.review.rating)} ${escapeHtml(order.review.comment || "")}</p>`
                : "<p>No review yet.</p>"}
            </article>
          `
        )
        .join("")
    : '<div class="empty-card">No orders have been placed yet.</div>';

  orders.forEach((order) => {
    order.items.forEach((item) => {
      topItems[item.name] = (topItems[item.name] || 0) + item.qty;
    });
  });

  const topItem = Object.keys(topItems).sort((a, b) => topItems[b] - topItems[a])[0];

  if (foodContainer) {
    foodContainer.innerHTML = foods.length
      ? foods
          .map(
              (food, index) => `
                <article class="list-card">
                  <div>
                    <h3>${escapeHtml(food.name)}</h3>
                    <p>${escapeHtml((food.canteen || "pencil").toUpperCase())} | ${escapeHtml(food.category || "Chef Pick")} | ${formatCurrency(food.price)}</p>
                  </div>
                  <div class="top-links">
                    <button class="ghost-button" onclick="editFood(${index})">Edit</button>
                    <button class="danger-button" onclick="deleteFood(${index})">Delete</button>
                  </div>
                </article>
              `
            )
            .join("")
      : '<div class="empty-card">No custom foods added yet.</div>';
  }

  if (orderContainer) {
    orderContainer.innerHTML = orderMarkup;
  }

  if (recentOrdersContainer) {
    recentOrdersContainer.innerHTML = orders.length
      ? orders
          .slice(0, 3)
          .map(
            (order, index) => `
              <article class="order-card">
                <div class="order-card-head">
                  <h3>Recent Order ${index + 1}</h3>
                  <span>${escapeHtml(formatDisplayDate(order.time || ""))}</span>
                </div>
                <p>${escapeHtml(order.userEmail || "Customer")}</p>
                <p>${escapeHtml(order.place || "Campus pickup")} | ${formatCurrency(order.total || 0)}</p>
                <ul class="order-items">
                  ${order.items
                    .slice(0, 3)
                    .map((item) => `<li>${escapeHtml(item.name)} x ${item.qty}</li>`)
                    .join("")}
                </ul>
              </article>
            `
          )
          .join("")
      : '<div class="empty-card">No recent orders yet.</div>';
  }

  if (totalOrders) {
    totalOrders.textContent = orders.length + " orders received";
  }

  if (ordersPageSummary) {
    ordersPageSummary.textContent = orders.length + " orders received";
  }

  if (foodCount) {
    foodCount.textContent = String(foods.length);
  }

  if (sideFoodCount) {
    sideFoodCount.textContent = String(foods.length);
  }

  if (revenueValue) {
    revenueValue.textContent = dashboardStatsCache
      ? formatCurrency(dashboardStatsCache.revenue || 0)
      : formatCurrency(orders.reduce((sum, order) => sum + Number(order.total || 0), 0));
  }

  if (ordersPageRevenue) {
    ordersPageRevenue.textContent = formatCurrency(
      dashboardStatsCache
        ? dashboardStatsCache.revenue || 0
        : orders.reduce((sum, order) => sum + Number(order.total || 0), 0)
    ) + " total";
  }

  if (topItemValue) {
    topItemValue.textContent = (dashboardStatsCache && dashboardStatsCache.topItem) || topItem || "No item yet";
  }

  if (sideTopItem) {
    sideTopItem.textContent = (dashboardStatsCache && dashboardStatsCache.topItem) || topItem || "No item yet";
  }

  if (backendStatus) {
    backendStatus.textContent = dashboardStatsCache ? "Live" : "Offline cache";
  }

  if (bestCanteen) {
    if (dashboardStatsCache && dashboardStatsCache.canteenCounts) {
      const topCanteen = Object.keys(dashboardStatsCache.canteenCounts).sort(
        (a, b) => dashboardStatsCache.canteenCounts[b] - dashboardStatsCache.canteenCounts[a]
      )[0];
      bestCanteen.textContent = topCanteen
        ? topCanteen.charAt(0).toUpperCase() + topCanteen.slice(1)
        : "No data yet";
    } else {
      bestCanteen.textContent = "No data yet";
    }
  }

  if (sideBestCanteen) {
    sideBestCanteen.textContent = bestCanteen ? bestCanteen.textContent : "No data yet";
  }

  if (deadlineHourField && deadlineMinuteField) {
    setDeadlineFields(getDeadline());
  }

  if (showDeadline) {
    showDeadline.textContent = getDeadline() ? "Current order deadline: " + getDeadline() : "No deadline set";
  }
}

async function deleteAdminUser(userId) {
  if (!userId) {
    return;
  }

  try {
    await apiRequest("/admin/users/" + userId, {
      method: "DELETE"
    });
    await Promise.all([syncAdminUsers(), syncOrdersFromBackend(), syncDashboardStats()]);
    renderAdminUsersPage();
    showToast("User removed.");
  } catch (error) {
    showToast(error.message || "Could not remove the user.", true);
  }
}

function renderAdminUsersPage() {
  const usersList = document.getElementById("usersList");
  const usersPageSummary = document.getElementById("usersPageSummary");
  const usersPageOrders = document.getElementById("usersPageOrders");
  const usersCountValue = document.getElementById("usersCountValue");
  const activeUsersValue = document.getElementById("activeUsersValue");
  const usersSpendValue = document.getElementById("usersSpendValue");
  const users = adminUsersCache;
  const totalOrders = users.reduce((sum, user) => sum + Number(user.ordersCount || 0), 0);
  const activeUsers = users.filter((user) => Number(user.ordersCount || 0) > 0).length;
  const totalSpend = users.reduce((sum, user) => sum + Number(user.totalSpend || 0), 0);

  if (usersPageSummary) {
    usersPageSummary.textContent = users.length + " users";
  }

  if (usersPageOrders) {
    usersPageOrders.textContent = totalOrders + " total orders";
  }

  if (usersCountValue) {
    usersCountValue.textContent = String(users.length);
  }

  if (activeUsersValue) {
    activeUsersValue.textContent = String(activeUsers);
  }

  if (usersSpendValue) {
    usersSpendValue.textContent = formatCurrency(totalSpend);
  }

  if (usersList) {
    usersList.innerHTML = users.length
      ? users
          .map(
            (user) => `
              <article class="list-card user-admin-card">
                <div>
                  <h3>${escapeHtml(user.email || "Unknown user")}</h3>
                  <p>Joined ${escapeHtml(formatShortDate(user.createdAt))}</p>
                  <p>${Number(user.ordersCount || 0)} orders | ${formatCurrency(user.totalSpend || 0)}</p>
                </div>
                <div class="top-links">
                  <button class="danger-button" onclick="deleteAdminUser('${escapeHtml(user.id)}')">Remove User</button>
                </div>
              </article>
            `
          )
          .join("")
      : '<div class="empty-card">No registered users yet.</div>';
  }
}

async function addFood() {
  const nameField = document.getElementById("foodname");
  const priceField = document.getElementById("foodprice");
  const canteenField = document.getElementById("foodcanteen");
  const categoryField = document.getElementById("foodcategory");
  const imageField = document.getElementById("foodimage");

  if (!nameField || !priceField || !canteenField || !categoryField || !imageField) {
    return;
  }

  const name = nameField.value.trim();
  const price = Number(priceField.value);
  const canteen = canteenField.value;
  const category = categoryField.value.trim() || "Chef Pick";
  const image = (imageField.value.trim() || adminSuggestedImageUrl || "").trim();
  const previewImage = getAdminResolvedImage(name, image, category);
  const wasEditing = Boolean(editingFoodId);
  const isEditingPersistedFood = Boolean(editingFoodId) && !editingFoodId.startsWith("local-");

  if (!name || !price) {
    showToast("Please enter a valid food name and price.", true);
    return;
  }

  const foods = getAdminFoods();
  const previousFoods = cloneData(foods);
  const foodId = editingFoodId || "local-" + Date.now();
  const draftFood = {
    _id: foodId,
    canteen,
    category,
    name,
    price,
    image: previewImage
  };
  const existingIndex = foods.findIndex((food) => food._id === foodId);

  if (existingIndex >= 0) {
    foods[existingIndex] = draftFood;
  } else {
    foods.unshift(draftFood);
  }

  saveAdminFoods(foods);

  try {
    const response = await apiRequest(isEditingPersistedFood ? "/foods/" + editingFoodId : "/addFood", {
      method: isEditingPersistedFood ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draftFood)
    });

      if (response) {
        await Promise.all([syncFoodsFromBackend(), syncDashboardStats()]);
      }
    } catch (error) {
      saveAdminFoods(previousFoods);
      renderAdminPanel();
      renderCanteenCards();
      refreshAdminPreview();
      showToast(error.message || "Failed to save food.", true);
      return;
    }

  resetFoodForm();
  renderAdminPanel();
  renderCanteenCards();
  refreshAdminPreview();
  showToast(wasEditing ? "Food updated." : "Food added to the menu.");
}

function editFood(index) {
  const foods = getAdminFoods();
  const selectedFood = foods[index];
  const nameField = document.getElementById("foodname");
  const priceField = document.getElementById("foodprice");
  const canteenField = document.getElementById("foodcanteen");
  const categoryField = document.getElementById("foodcategory");
  const imageField = document.getElementById("foodimage");

  if (
    !selectedFood ||
    !nameField ||
    !priceField ||
    !canteenField ||
    !categoryField ||
    !imageField
  ) {
    return;
  }

  editingFoodId = selectedFood._id || "";
  nameField.value = selectedFood.name || "";
  priceField.value = String(selectedFood.price || "");
  canteenField.value = selectedFood.canteen || "pencil";
  categoryField.value = selectedFood.category || "";
  imageField.value = selectedFood.image || "";
  clearSuggestedFoodImage();
  setFoodSuggestionStatus("Editing this food item. You can keep or replace its image.", false);
  updateFoodFormState();
  updateFoodPreview();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteFood(index) {
  const foods = getAdminFoods();
  const previousFoods = cloneData(foods);
  const [removedFood] = foods.splice(index, 1);
  saveAdminFoods(foods);

  if (removedFood && removedFood._id === editingFoodId) {
    resetFoodForm();
  }

  if (removedFood && removedFood._id && !removedFood._id.startsWith("local-")) {
    try {
      await apiRequest("/foods/" + removedFood._id, {
        method: "DELETE"
      });
      await syncDashboardStats();
    } catch (error) {
      saveAdminFoods(previousFoods);
      renderAdminPanel();
      renderCanteenCards();
      refreshAdminPreview();
      showToast("Could not delete the food from the backend.", true);
      return;
    }
  }

  renderAdminPanel();
  renderCanteenCards();
  refreshAdminPreview();
  showToast("Food removed.");
}

function setDeadline() {
  const deadlineHourField = document.getElementById("deadlineHour");
  const deadlineMinuteField = document.getElementById("deadlineMinute");
  const deadlineValue = getSelectedDeadlineValue();

  if (!deadlineHourField || !deadlineMinuteField || !deadlineValue || deadlineValue === ":") {
    showToast("Please choose a deadline time.", true);
    return;
  }

  saveDeadline(deadlineValue);
  renderAdminPanel();
  refreshAdminPreview();
  showToast("Deadline updated.");
}

async function logoutAdmin() {
  try {
    await apiRequest("/auth/logout", {
      method: "POST"
    });
  } catch (error) {
    // Clear client state even if the backend token is already gone.
  }

  clearAuthSession();
  window.location = "index.html";
}

function refreshAdminPreview() {
  // Preview now opens as a separate page from the admin panel.
}

function updateFoodPreview() {
  const nameField = document.getElementById("foodname");
  const categoryField = document.getElementById("foodcategory");
  const imageField = document.getElementById("foodimage");
  const priceField = document.getElementById("foodprice");
  const previewImage = document.getElementById("foodPreviewImage");
  const previewCategory = document.getElementById("foodPreviewCategory");
  const previewName = document.getElementById("foodPreviewName");
  const previewPrice = document.getElementById("foodPreviewPrice");

  if (
    !nameField ||
    !categoryField ||
    !imageField ||
    !priceField ||
    !previewImage ||
    !previewCategory ||
    !previewName ||
    !previewPrice
  ) {
    return;
  }

  const name = nameField.value.trim() || "New Food Item";
  const category = categoryField.value.trim() || "Chef Pick";
  const image = getAdminResolvedImage(name, imageField.value, category);
  const price = Number(priceField.value || 0);

  previewImage.src = image;
  previewImage.className = isGeneratedFoodImage(image) ? "menu-image-generated" : "menu-image-photo";
  previewImage.alt = name + " preview";
  previewCategory.textContent = category;
  previewName.textContent = name;
  previewPrice.textContent = formatCurrency(price);

  refreshAdminPreview();
}

function openAdminPreviewPage() {
  const previewUrl = "preview.html?preview=" + Date.now();
  window.location = previewUrl;
}

function openAdminOrdersPage() {
  window.location = "orders.html";
}

function openAdminUsersPage() {
  window.location = "users.html";
}

function toggleAdminPreview() {
  const previewPanel = document.getElementById("adminPreviewPanel");
  const previewButton = document.getElementById("previewToggleButton");

  if (!previewPanel || !previewButton) {
    return;
  }

  const isHidden = previewPanel.hasAttribute("hidden");

  if (isHidden) {
    previewPanel.removeAttribute("hidden");
    previewButton.textContent = "Hide Preview";
    refreshAdminPreview();
    previewPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  previewPanel.setAttribute("hidden", "");
  previewButton.textContent = "Show Preview";
}

function renderHomeIntro() {
  const greeting = document.getElementById("heroGreeting");
  const deadline = document.getElementById("heroDeadline");
  const user = getUser();

  if (greeting) {
    greeting.textContent = getGreeting() + (user.email ? ", " + user.email : "");
  }

  if (deadline) {
    deadline.textContent = getDeadline() ? "Today's order deadline: " + getDeadline() : "No deadline announced yet";
  }
}

async function requireUserLogin() {
  const protectedPages = new Set(["canteens", "cart", "payment", "account", "legacy-menu"]);
  const adminPages = new Set(["admin", "admin-orders", "admin-users", "preview"]);
  const currentPage = document.body.dataset.page;
  const isPreviewMode = new URLSearchParams(window.location.search).has("preview");
  const session = await hydrateAuthSession();

  if (currentPage === "canteens" && isPreviewMode) {
    return true;
  }

  if (protectedPages.has(currentPage) && !session) {
    window.location = "index.html";
    return false;
  }

  if (adminPages.has(currentPage) && (!session || session.role !== "admin")) {
    window.location = "adminlogin.html";
    return false;
  }

  return true;
}

async function logoutUser() {
  try {
    await apiRequest("/auth/logout", {
      method: "POST"
    });
  } catch (error) {
    // Clear client state even if the backend token is already gone.
  }

  if (accountOrdersSyncTimer) {
    clearInterval(accountOrdersSyncTimer);
    accountOrdersSyncTimer = null;
  }

  if (adminOrdersSyncTimer) {
    clearInterval(adminOrdersSyncTimer);
    adminOrdersSyncTimer = null;
  }

  clearAuthSession();
  window.location = "index.html";
}

document.addEventListener("DOMContentLoaded", () => {
  applyTheme(getThemePreference());
  ensureThemeToggle();

  requireUserLogin().then((isAllowed) => {
    if (!isAllowed && document.body.dataset.page !== "login" && document.body.dataset.page !== "register" && document.body.dataset.page !== "admin-login") {
      return;
    }

    Promise.allSettled([syncFoodsFromBackend(), syncOrdersFromBackend(), syncDashboardStats(), syncAdminUsers()]).finally(() => {
      renderCanteenCards();
      if (document.body.dataset.page === "admin") {
        renderAdminPanel();
      }
      if (document.body.dataset.page === "admin-orders") {
        renderAdminPanel();
      }
      if (document.body.dataset.page === "admin-users") {
        renderAdminUsersPage();
      }
      renderAccount();
      startAccountOrdersAutoSync();
      startAdminOrdersAutoSync();
    });

    updateCartBadge();
    renderHomeIntro();
    renderCart();
    renderPaymentPage();
    const accountProfileForm = document.getElementById("accountProfileForm");

    if (accountProfileForm) {
      accountProfileForm.addEventListener("submit", (event) => {
        event.preventDefault();
        saveProfile();
      });
    }

    setFoodSuggestionStatus("Type a dish name to fetch an image automatically.", false);
    renderFoodImageCandidates();
    updateFoodFormState();
    updateFoodPreview();
  });
});

