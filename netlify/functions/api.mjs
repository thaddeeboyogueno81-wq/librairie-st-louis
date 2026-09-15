import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

/* =========================================================
   CONFIGURATION
========================================================= */

const STORE_NAME = 'saint-louis-data';
const STORE_VERSION = 'netlify-blobs-v2';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_BLOB_BYTES = 5 * 1024 * 1024;
const MIN_PASSWORD_LENGTH = 10;

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

const DEFAULT_HOURS = {
  monday: '', tuesday: '', wednesday: '', thursday: '',
  friday: '', saturday: '', sunday: ''
};

const DEFAULT_BUSINESS = {
  whatsapp: '237699242376',
  phone: '699 24 23 76',
  address: 'WG2M+HH2, YaoundÃ©, Cameroun',
  landmark: 'PrÃ¨s de Neptune Oil Â· Chapelle Manguier',
  deliveryEnabled: true,
  pickupEnabled: true,
  deliveryFee: 0,
  freeDeliveryFrom: 0,
  paymentMethods: ['Paiement Ã  la livraison', 'Paiement au retrait en boutique']
};

const ORDER_STATUSES = [
  'pending', 'confirmed', 'preparing',
  'out_for_delivery', 'delivered', 'received', 'cancelled'
];

const SEED = [
  ['Dictionnaire Larousse', 'Livres & dictionnaires', 'Dictionnaires et ouvrages de rÃ©fÃ©rence disponibles en librairie.', null, '/assets/dictionaries.jpg', 10, 1],
  ["Oxford Advanced Learner's Dictionary", 'Livres & dictionnaires', 'Ouvrage de rÃ©fÃ©rence en langue anglaise.', null, '/assets/dictionaries.jpg', 8, 1],
  ['Manuels scolaires collÃ¨ge', 'Manuels scolaires', 'SÃ©lection de manuels pour les classes du secondaire.', null, '/assets/school.jpg', 20, 1],
  ['Manuels primaire & CE2', 'Manuels scolaires', 'Livres et cahiers dâ€™activitÃ©s pour le primaire.', null, '/assets/school2.jpg', 20, 1],
  ['Bibles & livres religieux', 'Livres religieux', 'DiffÃ©rentes Ã©ditions et formats de Bibles.', null, '/assets/hero.jpg', 12, 1],
  ['Papeterie & fournitures', 'Papeterie', 'Stylos, cahiers, articles scolaires et de bureau.', null, '/assets/hero.jpg', 30, 0]
];

/* =========================================================
   STORE (initialisation paresseuse)
========================================================= */

let _store = null;
function store() {
  if (!_store) _store = getStore(STORE_NAME);
  return _store;
}

/* =========================================================
   HELPERS HTTP
========================================================= */

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extra
  }
});

const text = (data, status = 200, extra = {}) => new Response(data, {
  status,
  headers: { 'Content-Type': 'text/plain; charset=utf-8', ...extra }
});

/* =========================================================
   HELPERS DONNÃ‰ES
========================================================= */

const makeId = prefix => `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
const makeCode = () => `SL-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

const cleanProduct = p => ({
  id: p.id,
  name: p.name,
  category: p.category,
  description: p.description || '',
  price: p.price == null ? null : Number(p.price),
  image: p.image || '/assets/hero.jpg',
  stock: Number(p.stock || 0),
  featured: Boolean(p.featured),
  active: p.active !== false
});

// Vue client : aucune donnÃ©e personnelle superflue n'est exposÃ©e.
const publicOrder = o => ({
  code: o.code,
  customer_name: o.customer_name,
  status: o.status,
  fulfillment: o.fulfillment,
  payment_method: o.payment_method,
  subtotal: o.subtotal,
  delivery_fee: o.delivery_fee,
  total: o.total,
  received: Boolean(o.received),
  created_at: o.created_at,
  updated_at: o.updated_at,
  items: (o.items || []).map(i => ({
    name: i.name,
    quantity: i.quantity,
    unit_price: i.unit_price == null ? null : Number(i.unit_price)
  }))
});

async function getJSON(key, fallback = null) {
  return (await store().get(key, { type: 'json' })) ?? fallback;
}

async function setJSON(key, value, options = {}) {
  return store().setJSON(key, value, options);
}

async function listJSON(prefix) {
  const { blobs } = await store().list({ prefix });
  return Promise.all(blobs.map(x => store().get(x.key, { type: 'json' })));
}

/* =========================================================
   MOTS DE PASSE
========================================================= */

function scryptHex(input, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(input), salt, 64, (err, buf) => err ? reject(err) : resolve(buf.toString('hex')));
  });
}

async function hashPassword(input) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${await scryptHex(input, salt)}`;
}

// Aucun mot de passe de repli n'est codÃ© en dur : sans ADMIN_PASSWORD
// et sans mot de passe enregistrÃ©, la connexion est impossible.
async function passwordMatches(input, saved) {
  if (!saved) {
    if (!ADMIN_PASSWORD) return false;
    const a = Buffer.from(String(input));
    const b = Buffer.from(ADMIN_PASSWORD);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }
  try {
    const [salt, hash] = String(saved).split(':');
    if (!salt || !hash) return false;
    const derived = await scryptHex(input, salt);
    return crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}

/* =========================================================
   REQUÃŠTES
========================================================= */

function cookies(req) {
  const out = {};
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  }
  return out;
}

async function body(req) {
  const raw = await req.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('JSON invalide');
  }
}

function ipOf(req) {
  return req.headers.get('x-nf-client-connection-ip')
    || req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    || 'unknown';
}

// Le drapeau Secure suit le protocole afin que le dÃ©veloppement local en HTTP fonctionne.
function cookieHeader(token, secure, maxAge = SESSION_TTL_MS / 1000) {
  return `sl_admin=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

/* =========================================================
   INITIALISATION
========================================================= */

async function ensureInitialized() {
  const meta = await getJSON('meta', null);
  if (meta?.version === STORE_VERSION) return;

  const lock = await setJSON('init-lock', { startedAt: Date.now() }, { onlyIfNew: true });
  if (!lock.modified) {
    for (let i = 0; i < 6; i++) {
      const ready = await getJSON('meta', null);
      if (ready?.version === STORE_VERSION) return;
      await new Promise(r => setTimeout(r, 100));
    }
  }

  const existing = (await listJSON('product:')).filter(Boolean);
  if (!existing.length) {
    for (const s of SEED) {
      const p = {
        id: makeId('p'), name: s[0], category: s[1], description: s[2],
        price: s[3], image: s[4], stock: s[5], featured: Boolean(s[6]),
        active: true, created_at: new Date().toISOString()
      };
      await setJSON(`product:${p.id}`, p);
    }
  }

  if (!(await getJSON('settings:business'))) await setJSON('settings:business', DEFAULT_BUSINESS);
  if (!(await getJSON('settings:hours'))) await setJSON('settings:hours', DEFAULT_HOURS);

  // Reprise des commandes existantes : crÃ©ation de l'index code -> identifiant.
  const orders = (await listJSON('order:')).filter(Boolean);
  for (const o of orders) {
    if (o?.code && o?.id) await setJSON(`order-code:${o.code}`, { id: o.id });
  }

  await setJSON('meta', { version: STORE_VERSION, initializedAt: new Date().toISOString() });
  await store().delete('init-lock');
}

/* =========================================================
   SESSIONS
========================================================= */

async function session(req) {
  const token = cookies(req).sl_admin;
  if (!token) return null;
  const s = await getJSON(`session:${token}`, null);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL_MS) {
    await store().delete(`session:${token}`);
    return null;
  }
  return { username: s.username || ADMIN_USER };
}

const UNAUTHORIZED = () => json({ error: 'Connexion gÃ©rant requise.' }, 401);

/* =========================================================
   PRODUITS
========================================================= */

async function productList({ includeHidden = false } = {}) {
  return (await listJSON('product:'))
    .filter(Boolean)
    .filter(p => includeHidden || p.active !== false)
    .sort((a, b) =>
      (Number(b.featured) - Number(a.featured))
      || String(b.created_at).localeCompare(String(a.created_at)))
    .map(cleanProduct);
}

// Les images importÃ©es sont stockÃ©es sÃ©parÃ©ment : le catalogue ne transporte
// plus de base64 et reste lÃ©ger mÃªme avec de nombreux produits.
async function persistImage(value, previous) {
  const raw = String(value || '');
  if (!raw.startsWith('data:')) return raw || '/assets/hero.jpg';

  const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) throw new Error("Format d'image non pris en charge.");

  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length) throw new Error("Image illisible.");
  if (buffer.length > MAX_BLOB_BYTES) {
    throw new Error('Image trop lourde. Limite Netlify Blobs : 5 Mo par donnÃ©e.');
  }

  const id = makeId('img');
  await setJSON(`image:${id}`, {
    contentType: match[1],
    data: buffer.toString('base64'),
    created_at: new Date().toISOString()
  });

  if (previous && /^\/api\/images\/[^/]+$/.test(previous)) {
    try { await store().delete(`image:${previous.split('/').pop()}`); } catch {}
  }
  return `/api/images/${id}`;
}

async function updateProductStock(id, delta) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const key = `product:${id}`;
    const got = await store().getWithMetadata(key, { type: 'json' });
    if (!got?.data) throw new Error('Produit introuvable');
    const p = got.data;
    const next = Number(p.stock || 0) + delta;
    if (next < 0) throw new Error(`Stock insuffisant pour ${p.name}.`);
    p.stock = next;
    const r = await setJSON(key, p, { onlyIfMatch: got.etag });
    if (r.modified) return p;
  }
  throw new Error('Le stock a Ã©tÃ© modifiÃ© simultanÃ©ment. RÃ©essayez.');
}

/* =========================================================
   COMMANDES
========================================================= */

async function orderList() {
  return (await listJSON('order:'))
    .filter(Boolean)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

// Recherche indexÃ©e : une seule lecture au lieu d'un parcours complet.
async function findOrder(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) return null;

  const index = await getJSON(`order-code:${normalized}`, null);
  if (index?.id) {
    const order = await getJSON(`order:${index.id}`, null);
    if (order) return order;
  }

  const found = (await listJSON('order:')).find(o => o?.code === normalized) || null;
  if (found) await setJSON(`order-code:${normalized}`, { id: found.id });
  return found;
}

// Une annulation remet les articles en stock, une seule fois.
async function restockOrder(order) {
  if (order.stock_restored) return;
  for (const item of order.items || []) {
    try { await updateProductStock(item.id, item.quantity); } catch {}
  }
  order.stock_restored = true;
}

/* =========================================================
   LIMITATION DES TENTATIVES DE CONNEXION
========================================================= */

async function loginThrottle(req) {
  const key = `login:${ipOf(req)}`;
  const attempt = await getJSON(key, { count: 0, until: 0 });
  const now = Date.now();
  if (attempt.until > now) {
    return { blocked: true, wait: Math.ceil((attempt.until - now) / 60000), key, attempt };
  }
  return { blocked: false, key, attempt };
}

/* =========================================================
   HANDLER
========================================================= */

export default async (req) => {
  try {
    const url = new URL(req.url);
    const path = url.pathname;
    const secure = url.protocol === 'https:';

    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': url.origin,
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        }
      });
    }

    await ensureInitialized();

    /* ---------- SANTÃ‰ ---------- */

    if (path === '/api/health' && req.method === 'GET') {
      return json({
        ok: true,
        service: 'saint-louis-netlify',
        version: STORE_VERSION,
        admin_password_configured: Boolean(ADMIN_PASSWORD) || Boolean(await getJSON('admin:password', null))
      });
    }

    /* ---------- IMAGES ---------- */

    const im = path.match(/^\/api\/images\/([^/]+)$/);
    if (im && req.method === 'GET') {
      const image = await getJSON(`image:${im[1]}`, null);
      if (!image?.data) return json({ error: 'Image introuvable.' }, 404);
      return new Response(Buffer.from(image.data, 'base64'), {
        status: 200,
        headers: {
          'Content-Type': image.contentType || 'image/jpeg',
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      });
    }

    /* ---------- AUTHENTIFICATION ---------- */

    if (path === '/api/auth/login' && req.method === 'POST') {
      const b = await body(req);
      const saved = await getJSON('admin:password', null);

      if (!saved && !ADMIN_PASSWORD) {
        return json({
          error: "Configuration incomplÃ¨te : la variable d'environnement ADMIN_PASSWORD doit Ãªtre dÃ©finie sur Netlify."
        }, 503);
      }

      const throttle = await loginThrottle(req);
      if (throttle.blocked) {
        return json({ error: `Trop de tentatives. RÃ©essayez dans ${throttle.wait} minute(s).` }, 429);
      }

      const ok = String(b.username || '').trim() === ADMIN_USER
        && await passwordMatches(b.password || '', saved);

      if (!ok) {
        throttle.attempt.count++;
        if (throttle.attempt.count >= 5) {
          throttle.attempt.count = 0;
          throttle.attempt.until = Date.now() + 10 * 60 * 1000;
        }
        await setJSON(throttle.key, throttle.attempt);
        return json({ error: 'Identifiants incorrects.' }, 401);
      }

      await store().delete(throttle.key);
      const token = crypto.randomBytes(32).toString('hex');
      await setJSON(`session:${token}`, { createdAt: Date.now(), username: ADMIN_USER });
      return json({ ok: true, user: { username: ADMIN_USER } }, 200, {
        'Set-Cookie': cookieHeader(token, secure)
      });
    }

    if (path === '/api/auth/me' && req.method === 'GET') {
      const user = await session(req);
      return json({ authenticated: Boolean(user), user });
    }

    if (path === '/api/auth/logout' && req.method === 'POST') {
      const token = cookies(req).sl_admin;
      if (token) await store().delete(`session:${token}`);
      return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader('', secure, 0) });
    }

    /* ---------- PARAMÃˆTRES PUBLICS ---------- */

    if (path === '/api/settings/business' && req.method === 'GET') {
      return json({ ...DEFAULT_BUSINESS, ...(await getJSON('settings:business', {})) });
    }

    if (path === '/api/settings/hours' && req.method === 'GET') {
      return json({ ...DEFAULT_HOURS, ...(await getJSON('settings:hours', {})) });
    }

    /* ---------- PARAMÃˆTRES GÃ‰RANT ---------- */

    if (path === '/api/admin/settings/business' && req.method === 'PUT') {
      if (!await session(req)) return UNAUTHORIZED();
      const b = await body(req);
      const next = { ...DEFAULT_BUSINESS, ...(await getJSON('settings:business', {})) };

      for (const k of ['whatsapp', 'phone', 'address', 'landmark']) {
        if (typeof b[k] === 'string') next[k] = b[k].trim();
      }
      next.deliveryEnabled = Boolean(b.deliveryEnabled);
      next.pickupEnabled = Boolean(b.pickupEnabled);
      next.deliveryFee = Math.max(0, Number(b.deliveryFee || 0));
      next.freeDeliveryFrom = Math.max(0, Number(b.freeDeliveryFrom || 0));
      next.paymentMethods = Array.isArray(b.paymentMethods) && b.paymentMethods.length
        ? b.paymentMethods.map(String).slice(0, 10)
        : DEFAULT_BUSINESS.paymentMethods;

      if (!next.deliveryEnabled && !next.pickupEnabled) {
        return json({ error: 'Activez au moins la livraison ou le retrait en boutique.' }, 400);
      }

      await setJSON('settings:business', next);
      return json(next);
    }

    if (path === '/api/admin/settings/hours' && req.method === 'PUT') {
      if (!await session(req)) return UNAUTHORIZED();
      const b = await body(req);
      const hours = {};
      for (const d of Object.keys(DEFAULT_HOURS)) {
        hours[d] = typeof b[d] === 'string' ? b[d].trim().slice(0, 60) : '';
      }
      await setJSON('settings:hours', hours);
      return json(hours);
    }

    if (path === '/api/admin/security/password' && req.method === 'PUT') {
      if (!await session(req)) return UNAUTHORIZED();
      const b = await body(req);
      const saved = await getJSON('admin:password', null);

      if (!b.currentPassword || !(await passwordMatches(b.currentPassword, saved))) {
        return json({ error: 'Mot de passe actuel incorrect.' }, 400);
      }
      if (String(b.newPassword || '').length < MIN_PASSWORD_LENGTH) {
        return json({ error: `Le nouveau mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractÃ¨res.` }, 400);
      }
      if (b.newPassword === b.currentPassword) {
        return json({ error: 'Le nouveau mot de passe doit Ãªtre diffÃ©rent de lâ€™actuel.' }, 400);
      }

      await setJSON('admin:password', await hashPassword(b.newPassword));
      return json({ ok: true });
    }

    /* ---------- PRODUITS ---------- */

    if (path === '/api/products' && req.method === 'GET') {
      let products = await productList();
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      const cat = (url.searchParams.get('category') || '').trim();
      if (q) products = products.filter(p => [p.name, p.category, p.description].some(x => String(x).toLowerCase().includes(q)));
      if (cat) products = products.filter(p => p.category === cat);
      return json(products);
    }

    // Vue gÃ©rant : inclut les produits masquÃ©s afin de pouvoir les rÃ©activer.
    if (path === '/api/admin/products' && req.method === 'GET') {
      if (!await session(req)) return UNAUTHORIZED();
      return json(await productList({ includeHidden: true }));
    }

    if (path === '/api/products/categories' && req.method === 'GET') {
      const products = await productList();
      return json([...new Set(products.map(p => p.category))].sort((a, b) => a.localeCompare(b, 'fr')));
    }

    if (path === '/api/products' && req.method === 'POST') {
      if (!await session(req)) return UNAUTHORIZED();
      const b = await body(req);
      if (!String(b.name || '').trim() || !String(b.category || '').trim()) {
        return json({ error: 'Nom et catÃ©gorie requis.' }, 400);
      }

      let image;
      try {
        image = await persistImage(b.image, null);
      } catch (e) {
        return json({ error: e.message }, 400);
      }

      const p = {
        id: makeId('p'),
        name: String(b.name).trim(),
        category: String(b.category).trim(),
        description: String(b.description || '').trim(),
        price: b.price === '' || b.price == null ? null : Math.max(0, Number(b.price)),
        image,
        stock: Math.max(0, Number(b.stock || 0)),
        featured: Boolean(b.featured),
        active: true,
        created_at: new Date().toISOString()
      };
      await setJSON(`product:${p.id}`, p);
      return json(cleanProduct(p), 201);
    }

    const pm = path.match(/^\/api\/products\/([^/]+)$/);

    if (pm && req.method === 'PUT') {
      if (!await session(req)) return UNAUTHORIZED();
      const key = `product:${pm[1]}`;
      const got = await store().getWithMetadata(key, { type: 'json' });
      if (!got?.data) return json({ error: 'Produit introuvable.' }, 404);

      const b = await body(req);
      let image;
      try {
        image = b.image
          ? await persistImage(b.image, got.data.image)
          : (got.data.image || '/assets/hero.jpg');
      } catch (e) {
        return json({ error: e.message }, 400);
      }

      const p = {
        ...got.data,
        name: String(b.name || got.data.name).trim(),
        category: String(b.category || got.data.category).trim(),
        description: String(b.description ?? got.data.description ?? '').trim(),
        price: b.price === '' || b.price == null ? null : Math.max(0, Number(b.price)),
        image,
        stock: Math.max(0, Number(b.stock || 0)),
        featured: Boolean(b.featured),
        active: b.active !== false,
        updated_at: new Date().toISOString()
      };

      const r = await setJSON(key, p, { onlyIfMatch: got.etag });
      if (!r.modified) {
        return json({ error: 'Le produit a Ã©tÃ© modifiÃ© simultanÃ©ment. Rechargez puis rÃ©essayez.' }, 409);
      }
      return json(cleanProduct(p));
    }

    if (pm && req.method === 'DELETE') {
      if (!await session(req)) return UNAUTHORIZED();
      const key = `product:${pm[1]}`;
      const p = await getJSON(key);
      if (!p) return json({ error: 'Produit introuvable.' }, 404);
      p.active = false;
      p.updated_at = new Date().toISOString();
      await setJSON(key, p);
      return json({ ok: true });
    }

    /* ---------- COMMANDES CLIENT ---------- */

    if (path === '/api/orders' && req.method === 'POST') {
      const b = await body(req);
      const business = { ...DEFAULT_BUSINESS, ...(await getJSON('settings:business', {})) };
      const fulfillment = b.fulfillment === 'pickup' ? 'pickup' : 'delivery';

      if (!String(b.customer_name || '').trim() || !String(b.phone || '').trim()) {
        return json({ error: 'Nom et tÃ©lÃ©phone requis.' }, 400);
      }
      if (!Array.isArray(b.items) || !b.items.length) {
        return json({ error: 'Votre panier est vide.' }, 400);
      }
      if (fulfillment === 'delivery' && !business.deliveryEnabled) {
        return json({ error: "La livraison n'est pas disponible actuellement." }, 400);
      }
      if (fulfillment === 'pickup' && !business.pickupEnabled) {
        return json({ error: "Le retrait en boutique n'est pas disponible actuellement." }, 400);
      }
      // L'adresse n'a de sens que pour une livraison.
      if (fulfillment === 'delivery' && !String(b.address || '').trim()) {
        return json({ error: 'Adresse de livraison requise.' }, 400);
      }

      const ids = [...new Set(b.items.map(x => String(x.id)))];
      const products = [];
      for (const id of ids) {
        const p = await getJSON(`product:${id}`);
        if (p?.active !== false && p) products.push(p);
      }
      const map = new Map(products.map(p => [String(p.id), p]));

      let subtotal = 0;
      const normalized = [];
      for (const item of b.items) {
        const p = map.get(String(item.id));
        const qty = Math.max(1, Math.min(999, Number(item.quantity || 1)));
        if (!p) continue;
        if (qty > Number(p.stock || 0)) return json({ error: `Stock insuffisant pour ${p.name}.` }, 400);
        const unit = p.price == null ? null : Number(p.price);
        if (unit != null) subtotal += unit * qty;
        normalized.push({ id: p.id, name: p.name, quantity: qty, unit_price: unit });
      }
      if (!normalized.length) return json({ error: 'Aucun produit valide dans le panier.' }, 400);

      const freeFrom = Number(business.freeDeliveryFrom) > 0 && subtotal >= Number(business.freeDeliveryFrom);
      const deliveryFee = fulfillment === 'delivery' && Number(business.deliveryFee) > 0 && !freeFrom
        ? Number(business.deliveryFee)
        : 0;

      const payment = typeof b.payment_method === 'string' && business.paymentMethods.includes(b.payment_method)
        ? b.payment_method
        : business.paymentMethods[0];

      const code = makeCode();
      const order = {
        id: makeId('o'),
        code,
        customer_name: String(b.customer_name).trim().slice(0, 120),
        phone: String(b.phone).trim().slice(0, 40),
        email: String(b.email || '').trim().slice(0, 160),
        address: fulfillment === 'pickup'
          ? (String(b.address || '').trim().slice(0, 400) || 'Retrait en boutique')
          : String(b.address).trim().slice(0, 400),
        notes: String(b.notes || '').trim().slice(0, 600),
        subtotal,
        delivery_fee: deliveryFee,
        total: subtotal + deliveryFee,
        status: 'pending',
        received: false,
        fulfillment,
        payment_method: payment,
        items: normalized,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const changed = [];
      try {
        for (const item of normalized) {
          await updateProductStock(item.id, -item.quantity);
          changed.push(item);
        }
        await setJSON(`order:${order.id}`, order);
        await setJSON(`order-code:${order.code}`, { id: order.id });
      } catch (e) {
        for (const item of changed) {
          try { await updateProductStock(item.id, item.quantity); } catch {}
        }
        return json({ error: e.message || 'Impossible dâ€™enregistrer la commande.' }, 400);
      }

      return json({
        id: order.id,
        code,
        total: order.total,
        delivery_fee: deliveryFee,
        fulfillment,
        price_pending: normalized.some(x => x.unit_price == null),
        status: 'pending',
        message: 'Commande enregistrÃ©e.',
        whatsapp: business.whatsapp
      }, 201);
    }

    const om = path.match(/^\/api\/orders\/([^/]+)$/);
    if (om && req.method === 'GET') {
      const o = await findOrder(om[1]);
      if (!o) return json({ error: 'Commande introuvable.' }, 404);
      return json(publicOrder(o));
    }

    const rm = path.match(/^\/api\/orders\/([^/]+)\/received$/);
    if (rm && req.method === 'POST') {
      const o = await findOrder(rm[1]);
      if (!o) return json({ error: 'Commande introuvable.' }, 404);
      if (o.status === 'received') return json({ ok: true, status: 'received' });
      // Seule une commande livrÃ©e peut Ãªtre confirmÃ©e par le client.
      if (o.status !== 'delivered') {
        return json({ error: 'Cette commande ne peut pas encore Ãªtre confirmÃ©e.' }, 409);
      }
      o.received = true;
      o.status = 'received';
      o.updated_at = new Date().toISOString();
      await setJSON(`order:${o.id}`, o);
      return json({ ok: true, status: 'received' });
    }

    /* ---------- COMMANDES GÃ‰RANT ---------- */

    if (path === '/api/admin/orders' && req.method === 'GET') {
      if (!await session(req)) return UNAUTHORIZED();
      return json(await orderList());
    }

    const sm = path.match(/^\/api\/admin\/orders\/([^/]+)\/status$/);
    if (sm && req.method === 'PUT') {
      if (!await session(req)) return UNAUTHORIZED();
      const b = await body(req);
      if (!ORDER_STATUSES.includes(b.status)) return json({ error: 'Statut invalide.' }, 400);

      const key = `order:${sm[1]}`;
      const o = await getJSON(key);
      if (!o) return json({ error: 'Commande introuvable.' }, 404);

      if (b.status === 'cancelled') await restockOrder(o);
      o.status = b.status;
      o.received = b.status === 'received';
      o.updated_at = new Date().toISOString();
      await setJSON(key, o);
      return json({ ok: true, status: o.status });
    }

    if (path === '/api/admin/backup' && req.method === 'GET') {
      if (!await session(req)) return UNAUTHORIZED();
      const backup = {
        exported_at: new Date().toISOString(),
        format: 'saint-louis-netlify-backup-v2',
        settings: {
          business: { ...DEFAULT_BUSINESS, ...(await getJSON('settings:business', {})) },
          hours: { ...DEFAULT_HOURS, ...(await getJSON('settings:hours', {})) }
        },
        products: (await listJSON('product:')).filter(Boolean),
        orders: await orderList()
      };
      return new Response(JSON.stringify(backup, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="saint-louis-backup-${new Date().toISOString().slice(0, 10)}.json"`,
          'Cache-Control': 'no-store'
        }
      });
    }

    /* ---------- SEO ---------- */

    const base = (process.env.SITE_URL || process.env.URL || `${url.protocol}//${url.host}`).replace(/\/$/, '');

    if (path === '/robots.txt' && req.method === 'GET') {
      return text(
        `User-agent: *\nAllow: /\nDisallow: /admin.html\nSitemap: ${base}/sitemap.xml\n`,
        200,
        { 'Cache-Control': 'public, max-age=3600' }
      );
    }

    if (path === '/sitemap.xml' && req.method === 'GET') {
      const pages = ['/', '/catalogue.html', '/panier.html', '/commande.html', '/suivi.html'];
      const today = new Date().toISOString().slice(0, 10);
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages
          .map(p => `<url><loc>${base}${p}</loc><lastmod>${today}</lastmod></url>`)
          .join('')}</urlset>`,
        { status: 200, headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } }
      );
    }

    return json({ error: 'API introuvable.' }, 404);
  } catch (e) {
    console.error(e);
    if (e?.message === 'JSON invalide') return json({ error: 'RequÃªte invalide.' }, 400);
    return json({ error: 'Une erreur interne est survenue.' }, 500);
  }
};

export const config = { path: ['/api/*', '/robots.txt', '/sitemap.xml'] };  if(!saved) return String(input)===DEFAULT_ADMIN_PASSWORD;
  try { const [salt,hash]=String(saved).split(':'); const derived=await new Promise((resolve,reject)=>crypto.scrypt(String(input),salt,64,(e,b)=>e?reject(e):resolve(b.toString('hex')))); return crypto.timingSafeEqual(Buffer.from(derived,'hex'),Buffer.from(hash,'hex')); } catch { return false; }
}
function cookies(req){ const out={}; for(const part of (req.headers.get('cookie')||'').split(';')){const [k,...v]=part.trim().split('=');if(k)out[k]=decodeURIComponent(v.join('='));}return out; }
async function body(req){ const raw=await req.text(); if(!raw)return {}; try{return JSON.parse(raw)}catch{throw new Error('JSON invalide')} }
async function ensureInitialized(){
  const meta=await getJSON('meta',null);
  if(meta?.version===STORE_VERSION) return;
  const lock=await store.setJSON('init-lock',{startedAt:Date.now()},{onlyIfNew:true});
  if(!lock.modified){
    for(let i=0;i<6;i++){const ready=await getJSON('meta',null);if(ready?.version===STORE_VERSION)return;await new Promise(r=>setTimeout(r,100));}
  }
  const existing=await list('product:');
  if(!existing.length){ for(const s of SEED){const p={id:makeId('p'),name:s[0],category:s[1],description:s[2],price:s[3],image:s[4],stock:s[5],featured:Boolean(s[6]),active:true,created_at:new Date().toISOString()};await setJSON(`product:${p.id}`,p);} }
  if(!(await getJSON('settings:business'))) await setJSON('settings:business',DEFAULT_BUSINESS);
  if(!(await getJSON('settings:hours'))) await setJSON('settings:hours',DEFAULT_HOURS);
  if(!(await getJSON('admin:password'))) await setJSON('admin:password',null);
  await setJSON('meta',{version:STORE_VERSION,initializedAt:new Date().toISOString()});
  await store.delete('init-lock');
}
async function session(req){
  const token=cookies(req).sl_admin; if(!token)return false;
  const s=await getJSON(`session:${token}`,null); if(!s)return false;
  if(Date.now()-s.createdAt>8*60*60*1000){await store.delete(`session:${token}`);return false;}
  return true;
}
async function requireAdmin(req){return session(req)}
function cookieHeader(token,secure=true,maxAge=28800){return `sl_admin=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure?'; Secure':''}`}
function ipOf(req){return req.headers.get('x-nf-client-connection-ip')||req.headers.get('x-forwarded-for')?.split(',')[0].trim()||'unknown'}
async function rateLogin(req){const key=`login:${ipOf(req)}`,a=await getJSON(key,{count:0,until:0}),now=Date.now();if(a.until>now)return {blocked:true,wait:Math.ceil((a.until-now)/60000),key,a};return {blocked:false,key,a}}
async function productList(){return (await list('product:')).filter(Boolean).filter(p=>p.active!==false).sort((a,b)=>(Number(b.featured)-Number(a.featured))||String(b.created_at).localeCompare(String(a.created_at))).map(cleanProduct)}
async function orderList(){return (await list('order:')).filter(Boolean).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))}
async function findOrder(code){const orders=await list('order:');return orders.find(o=>o?.code===String(code).toUpperCase())||null}
async function updateProductStock(id,delta){
  for(let attempt=0;attempt<5;attempt++){
    const key=`product:${id}`;const got=await store.getWithMetadata(key,{type:'json'});if(!got?.data)throw new Error('Produit introuvable');
    const p=got.data;const next=Number(p.stock||0)+delta;if(next<0)throw new Error(`Stock insuffisant pour ${p.name}.`);p.stock=next;
    const r=await store.setJSON(key,p,{onlyIfMatch:got.etag});if(r.modified)return p;
  }
  throw new Error('Le stock a été modifié simultanément. Réessayez.');
}

export default async (req) => {
  try {
    await ensureInitialized();
    const url=new URL(req.url); const path=url.pathname;
    if(req.method==='OPTIONS') return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS'}});
    if(path==='/api/health' && req.method==='GET') return json({ok:true,service:'saint-louis-netlify'});

    if(path==='/api/auth/login' && req.method==='POST'){
      const b=await body(req), rl=await rateLogin(req);if(rl.blocked)return json({error:`Trop de tentatives. Réessayez dans ${rl.wait} minute(s).`},429);
      const saved=await getJSON('admin:password',null);const ok=b.username===ADMIN_USER&&await passwordMatches(b.password,saved);
      if(!ok){rl.a.count++;if(rl.a.count>=5){rl.a.count=0;rl.a.until=Date.now()+10*60*1000}await setJSON(rl.key,rl.a);return json({error:'Identifiants incorrects.'},401)}
      await store.delete(rl.key);const token=crypto.randomBytes(32).toString('hex');await setJSON(`session:${token}`,{createdAt:Date.now()},{metadata:{expiration:Date.now()+8*60*60*1000}});
      return json({ok:true},200,{'Set-Cookie':cookieHeader(token,true)});
    }
    if(path==='/api/auth/me' && req.method==='GET') return json({authenticated:await session(req)});
    if(path==='/api/auth/logout' && req.method==='POST'){const token=cookies(req).sl_admin;if(token)await store.delete(`session:${token}`);return json({ok:true},200,{'Set-Cookie':cookieHeader('',true,0)});}

    if(path==='/api/settings/business' && req.method==='GET')return json(await getJSON('settings:business',DEFAULT_BUSINESS));
    if(path==='/api/settings/hours' && req.method==='GET')return json(await getJSON('settings:hours',DEFAULT_HOURS));
    if(path==='/api/admin/settings/business' && req.method==='PUT'){
      if(!await requireAdmin(req))return json({error:'Connexion gérant requise.'},401);const b=await body(req);const current=await getJSON('settings:business',DEFAULT_BUSINESS);const next={...DEFAULT_BUSINESS,...current};
      for(const k of ['whatsapp','phone','address','landmark'])if(typeof b[k]==='string')next[k]=b[k].trim();next.deliveryEnabled=Boolean(b.deliveryEnabled);next.pickupEnabled=Boolean(b.pickupEnabled);next.deliveryFee=Math.max(0,Number(b.deliveryFee||0));next.freeDeliveryFrom=Math.max(0,Number(b.freeDeliveryFrom||0));next.paymentMethods=Array.isArray(b.paymentMethods)&&b.paymentMethods.length?b.paymentMethods.map(String).slice(0,10):DEFAULT_BUSINESS.paymentMethods;await setJSON('settings:business',next);return json(next);
    }
    if(path==='/api/admin/settings/hours' && req.method==='PUT'){
      if(!await requireAdmin(req))return json({error:'Connexion gérant requise.'},401);const b=await body(req),hours={};for(const d of Object.keys(DEFAULT_HOURS))hours[d]=typeof b[d]==='string'?b[d].trim():'';await setJSON('settings:hours',hours);return json(hours);
    }
    if(path==='/api/admin/security/password' && req.method==='PUT'){
      if(!await requireAdmin(req))return json({error:'Connexion gérant requise.'},401);const b=await body(req),saved=await getJSON('admin:password',null);if(!b.currentPassword||!(await passwordMatches(b.currentPassword,saved)))return json({error:'Mot de passe actuel incorrect.'},400);if(String(b.newPassword||'').length<10)return json({error:'Le nouveau mot de passe doit contenir au moins 10 caractères.'},400);await setJSON('admin:password',await hashPassword(b.newPassword));return json({ok:true});
    }

    if(path==='/api/products' && req.method==='GET'){
      let products=await productList();const q=(url.searchParams.get('q')||'').trim().toLowerCase(),cat=(url.searchParams.get('category')||'').trim();if(q)products=products.filter(p=>[p.name,p.category,p.description].some(x=>String(x).toLowerCase().includes(q)));if(cat)products=products.filter(p=>p.category===cat);return json(products);
    }
    if(path==='/api/products/categories' && req.method==='GET'){const products=await productList();return json([...new Set(products.map(p=>p.category))].sort((a,b)=>a.localeCompare(b)));}
    if(path==='/api/products' && req.method==='POST'){
      if(!await requireAdmin(req))return json({error:'Connexion gérant requise.'},401);const b=await body(req);if(!b.name||!b.category)return json({error:'Nom et catégorie requis.'},400);const p={id:makeId('p'),name:String(b.name).trim(),category:String(b.category).trim(),description:String(b.description||''),price:b.price===''||b.price==null?null:Math.max(0,Number(b.price)),image:b.image||'/assets/hero.jpg',stock:Math.max(0,Number(b.stock||0)),featured:Boolean(b.featured),active:true,created_at:new Date().toISOString()};if(String(p.image).startsWith('data:')&&String(p.image).length>5*1024*1024)return json({error:'Image trop lourde. Limite Netlify Blobs : 5 Mo par donnée.'},400);await setJSON(`product:${p.id}`,p);return json(cleanProduct(p),201);
    }
    const pm=path.match(/^\/api\/products\/([^/]+)$/);
    if(pm && req.method==='PUT'){
      if(!await requireAdmin(req))return json({error:'Connexion gérant requise.'},401);const key=`product:${pm[1]}`,got=await store.getWithMetadata(key,{type:'json'});if(!got?.data)return json({error:'Produit introuvable.'},404);const b=await body(req),p={...got.data,name:String(b.name||got.data.name),category:String(b.category||got.data.category),description:String(b.description??''),price:b.price===''||b.price==null?null:Math.max(0,Number(b.price)),image:b.image||got.data.image||'/assets/hero.jpg',stock:Math.max(0,Number(b.stock||0)),featured:Boolean(b.featured),active:b.active===false?false:true};if(String(p.image).startsWith('data:')&&String(p.image).length>5*1024*1024)return json({error:'Image trop lourde. Limite Netlify Blobs : 5 Mo par donnée.'},400);const r=await store.setJSON(key,p,{onlyIfMatch:got.etag});if(!r.modified)return json({error:'Le produit a été modifié simultanément. Rechargez puis réessayez.'},409);return json(cleanProduct(p));
    }
    if(pm && req.method==='DELETE'){if(!await requireAdmin(req))return json({error:'Connexion gérant requise.'},401);const key=`product:${pm[1]}`,p=await getJSON(key);if(!p)return json({error:'Produit introuvable.'},404);p.active=false;await setJSON(key,p);return json({ok:true});}

    if(path==='/api/orders' && req.method==='POST'){
      const b=await body(req);if(!b.customer_name||!b.phone||!b.address||!Array.isArray(b.items)||!b.items.length)return json({error:'Informations client et panier requis.'},400);const business=await getJSON('settings:business',DEFAULT_BUSINESS),requested=b.fulfillment==='pickup'?'pickup':'delivery';if(requested==='delivery'&&!business.deliveryEnabled)return json({error:"La livraison n'est pas disponible actuellement."},400);if(requested==='pickup'&&!business.pickupEnabled)return json({error:"Le retrait en boutique n'est pas disponible actuellement."},400);
      const ids=[...new Set(b.items.map(x=>String(x.id)))],products=[];for(const id of ids){const p=await getJSON(`product:${id}`);if(p?.active)products.push(p);}const map=new Map(products.map(p=>[String(p.id),p]));let subtotal=0;const normalized=[];for(const item of b.items){const p=map.get(String(item.id)),qty=Math.max(1,Number(item.quantity||1));if(!p)continue;if(qty>Number(p.stock||0))return json({error:`Stock insuffisant pour ${p.name}.`},400);const unit=p.price==null?null:Number(p.price);if(unit!=null)subtotal+=unit*qty;normalized.push({id:p.id,name:p.name,quantity:qty,unit_price:unit});}if(!normalized.length)return json({error:'Aucun produit valide dans le panier.'},400);
      const deliveryFee=requested==='delivery'&&Number(business.deliveryFee)>0&&!(Number(business.freeDeliveryFrom)>0&&subtotal>=Number(business.freeDeliveryFrom))?Number(business.deliveryFee):0,total=subtotal+deliveryFee,payment=typeof b.payment_method==='string'&&business.paymentMethods.includes(b.payment_method)?b.payment_method:business.paymentMethods[0],code=makeCode(),order={id:makeId('o'),code,customer_name:String(b.customer_name).trim(),phone:String(b.phone).trim(),email:String(b.email||''),address:String(b.address).trim(),notes:String(b.notes||''),total,subtotal,delivery_fee:deliveryFee,status:'pending',received:false,fulfillment:requested,payment_method:payment,items:normalized,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
      const changed=[];try{for(const item of normalized){await updateProductStock(item.id,-item.quantity);changed.push(item);}await setJSON(`order:${order.id}`,order);}catch(e){for(const item of changed){try{await updateProductStock(item.id,item.quantity)}catch{}}return json({error:e.message||'Impossible d’enregistrer la commande.'},400)}
      return json({id:order.id,code,total,delivery_fee:deliveryFee,fulfillment:requested,price_pending:normalized.some(x=>x.unit_price==null),status:'pending',message:'Commande enregistrée.',whatsapp:business.whatsapp},201);
    }
    const om=path.match(/^\/api\/orders\/([^/]+)$/);
    if(om&&req.method==='GET'){const o=await findOrder(om[1]);if(!o)return json({error:'Commande introuvable.'},404);return json(o);}
    const rm=path.match(/^\/api\/orders\/([^/]+)\/received$/);
    if(rm&&req.method==='POST'){const o=await findOrder(rm[1]);if(!o)return json({error:'Commande introuvable.'},404);o.received=true;o.status='received';o.updated_at=new Date().toISOString();await setJSON(`order:${o.id}`,o);return json({ok:true,status:'received'});}

    if(path==='/api/admin/orders'&&req.method==='GET'){if(!await requireAdmin(req))return json({error:'Connexion gérant requise.'},401);return json(await orderList());}
    const sm=path.match(/^\/api\/admin\/orders\/([^/]+)\/status$/);
    if(sm&&req.method==='PUT'){if(!await requireAdmin(req))return json({error:'Connexion gérant requise.'},401);const b=await body(req),allowed=['pending','confirmed','preparing','out_for_delivery','delivered','received'];if(!allowed.includes(b.status))return json({error:'Statut invalide.'},400);const key=`order:${sm[1]}`,o=await getJSON(key);if(!o)return json({error:'Commande introuvable.'},404);o.status=b.status;o.received=b.status==='received';o.updated_at=new Date().toISOString();await setJSON(key,o);return json({ok:true});}

    if(path==='/api/admin/backup'&&req.method==='GET'){
      if(!await requireAdmin(req))return json({error:'Connexion gérant requise.'},401);const products=await list('product:'),orders=await list('order:'),backup={exported_at:new Date().toISOString(),format:'saint-louis-netlify-backup-v1',settings:{business:await getJSON('settings:business',DEFAULT_BUSINESS),hours:await getJSON('settings:hours',DEFAULT_HOURS)},products,orders};return new Response(JSON.stringify(backup,null,2),{status:200,headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="saint-louis-backup-${new Date().toISOString().slice(0,10)}.json"`,'Cache-Control':'no-store'}});
    }

    if(path==='/robots.txt'&&req.method==='GET'){const base=process.env.URL||`${url.protocol}//${url.host}`;return text(`User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`,200,{'Cache-Control':'public, max-age=3600'});}
    if(path==='/sitemap.xml'&&req.method==='GET'){const base=process.env.URL||`${url.protocol}//${url.host}`,pages=['/','/catalogue.html','/panier.html','/commande.html','/suivi.html'];return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.map(p=>`<url><loc>${base}${p}</loc></url>`).join('')}</urlset>`,{status:200,headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public, max-age=3600'}});}
    return json({error:'API introuvable.'},404);
  } catch(e){ console.error(e); return json({error:'Une erreur interne est survenue.'},500); }
};

export const config = { path: ['/api/*', '/robots.txt', '/sitemap.xml'] };
