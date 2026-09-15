import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

const store = getStore('saint-louis-data');
const STORE_VERSION = 'netlify-blobs-v1';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'SaintLouis2026!';
const DEFAULT_HOURS = { monday:'', tuesday:'', wednesday:'', thursday:'', friday:'', saturday:'', sunday:'' };
const DEFAULT_BUSINESS = {
  whatsapp:'237699242376', phone:'699 24 23 76', address:'WG2M+HH2, Yaoundé, Cameroun',
  landmark:'Près de Neptune Oil · Chapelle Manguier', deliveryEnabled:true, pickupEnabled:true,
  deliveryFee:0, freeDeliveryFrom:0,
  paymentMethods:['Paiement à la livraison','Paiement au retrait en boutique']
};
const SEED = [
  ['Dictionnaire Larousse','Livres & dictionnaires','Dictionnaires et ouvrages de référence disponibles en librairie.',null,'/assets/dictionaries.jpg',10,1],
  ["Oxford Advanced Learner's Dictionary",'Livres & dictionnaires','Ouvrage de référence en langue anglaise.',null,'/assets/dictionaries.jpg',8,1],
  ['Manuels scolaires collège','Manuels scolaires','Sélection de manuels pour les classes du secondaire.',null,'/assets/school.jpg',20,1],
  ['Manuels primaire & CE2','Manuels scolaires','Livres et cahiers d’activités pour le primaire.',null,'/assets/school2.jpg',20,1],
  ['Bibles & livres religieux','Livres religieux','Différentes éditions et formats de Bibles.',null,'/assets/hero.jpg',12,1],
  ['Papeterie & fournitures','Papeterie','Stylos, cahiers, articles scolaires et de bureau.',null,'/assets/hero.jpg',30,0]
];

const json = (data, status=200, extra={}) => new Response(JSON.stringify(data), {
  status, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store', ...extra}
});
const text = (data, status=200, extra={}) => new Response(data,{status,headers:{'Content-Type':'text/plain; charset=utf-8',...extra}});
const cleanProduct = p => ({ id:p.id, name:p.name, category:p.category, description:p.description||'', price:p.price==null?null:Number(p.price), image:p.image||'/assets/hero.jpg', stock:Number(p.stock||0), featured:Boolean(p.featured), active:p.active!==false });
const makeId = prefix => `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
const makeCode = () => `SL-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

async function getJSON(key, fallback=null){ return (await store.get(key,{type:'json'})) ?? fallback; }
async function setJSON(key,value,options={}){ await store.setJSON(key,value,options); }
async function list(prefix){ const {blobs}=await store.list({prefix}); return Promise.all(blobs.map(x=>store.get(x.key,{type:'json'}))); }
async function hashPassword(input){ const salt=crypto.randomBytes(16).toString('hex'); const hash=await new Promise((resolve,reject)=>crypto.scrypt(String(input),salt,64,(e,b)=>e?reject(e):resolve(b.toString('hex')))); return `${salt}:${hash}`; }
async function passwordMatches(input,saved){
  if(!saved) return String(input)===DEFAULT_ADMIN_PASSWORD;
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
