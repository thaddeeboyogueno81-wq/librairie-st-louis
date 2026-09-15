const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];

function showToast(message, type="") {
  const el = $("#toast"); if (!el) return;
  el.textContent = message; el.className = `toast show ${type}`;
  clearTimeout(showToast.t); showToast.t = setTimeout(() => el.classList.remove("show"), 3200);
}
function showRoute() {
  const o = $("#routeOverlay"); if (!o) return;
  o.classList.add("show"); setTimeout(()=>o.classList.remove("show"), 450);
}
function money(v) { return v == null ? "Prix à confirmer" : `${Number(v).toLocaleString("fr-FR")} FCFA`; }
function cart() { return JSON.parse(localStorage.getItem("sl_cart") || "[]"); }
function saveCart(c) { localStorage.setItem("sl_cart", JSON.stringify(c)); updateCartCount(); }
function updateCartCount() {
  const n = cart().reduce((s,x)=>s+x.quantity,0);
  $$(".cart-count").forEach(e=>e.textContent=n);
}
function addToCart(product) {
  if(!product || Number(product.stock||0) <= 0){ showToast("Article actuellement indisponible."); return; }
  const c=cart(), item=c.find(x=>x.id===product.id);
  if(item){ if(item.quantity >= Number(product.stock)){ showToast("Stock maximum atteint."); return; } item.quantity++; }
  else c.push({...product,quantity:1});
  saveCart(c); showToast("Article ajouté au panier.");
}
function formatStatus(s) {
  return ({pending:"Commande reçue",confirmed:"Confirmée",preparing:"En préparation",out_for_delivery:"En livraison",delivered:"Livrée",received:"Réception confirmée"})[s] || s;
}
function escapeHtml(v="") { return String(v).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m])); }

const DAYS = [
  ["monday", "Lundi"], ["tuesday", "Mardi"], ["wednesday", "Mercredi"], ["thursday", "Jeudi"],
  ["friday", "Vendredi"], ["saturday", "Samedi"], ["sunday", "Dimanche"]
];

async function loadOpeningHours() {
  const box = $("#hoursPublic");
  if (!box) return;
  try {
    const r = await fetch("/api/settings/hours");
    const hours = await r.json();
    const rows = DAYS.filter(([key]) => hours[key]).map(([key, label]) => `<div><span>${label}</span><strong>${escapeHtml(hours[key])}</strong></div>`);
    box.innerHTML = rows.length ? rows.join("") : "<span>Horaires à renseigner.</span>";
  } catch {
    box.innerHTML = "<span>Horaires à renseigner.</span>";
  }
}

async function loadBusinessSettings() {
  try {
    const r = await fetch('/api/settings/business');
    if (!r.ok) return null;
    const b = await r.json();
    const wa = String(b.whatsapp || '').replace(/\D/g,'');
    $$( '[data-whatsapp]' ).forEach(el => {
      if (wa) el.href = `https://wa.me/${wa}?text=${encodeURIComponent(el.dataset.whatsapp || 'Bonjour, je souhaite avoir des informations sur vos produits.')}`;
      else el.style.display='none';
    });
    $$( '[data-business-phone]' ).forEach(el => el.textContent=b.phone||'');
    $$( '[data-business-address]' ).forEach(el => el.textContent=b.address||'');
    return b;
  } catch { return null; }
}

function whatsappOrderLink(code='') {
  const phone='237699242376';
  const text=code ? `Bonjour Librairie Papeterie Saint Louis, je viens de passer la commande ${code}.` : 'Bonjour Librairie Papeterie Saint Louis, je souhaite avoir des informations sur vos produits.';
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

document.addEventListener("DOMContentLoaded", ()=>{
  updateCartCount();
  loadOpeningHours();
  loadBusinessSettings();
  const menu=$("#menuBtn"), nav=$("#navLinks");
  menu?.addEventListener("click",()=>nav.classList.toggle("open"));
  $$("#navLinks a").forEach(a=>a.addEventListener("click",()=>nav.classList.remove("open")));
  $$(".transition-link").forEach(a=>a.addEventListener("click",e=>{
    if(a.target!=="_blank" && a.origin===location.origin){e.preventDefault();showRoute();setTimeout(()=>location.href=a.href,230);}
  }));
  const loader=$("#loader");
  if(loader) setTimeout(()=>loader.classList.add("hide"),650);
});
