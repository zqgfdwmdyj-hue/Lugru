// Lesezeichen für Messe-Ausstellerverzeichnisse, die ihre Liste erst im Browser laden (JavaScript,
// „Mehr laden“, endloses Scrollen). Auf der Ausstellerliste geklickt: scrollt bis alles geladen
// ist, klickt „Mehr laden“, holt „Weiter“-Seiten nach und schickt Text + Links ans Seller-System.
// Es klickt nur Lade-/Weiter-Knöpfe, nichts, was etwas ändert. Ausgewertet wird auf dem Server (KI).

const SOURCE = String.raw`(async()=>{
var O="__ORIGIN__";
var box=document.createElement("div");
box.style.cssText="position:fixed;top:12px;right:12px;z-index:2147483647;background:#fff;color:#111;border:2px solid #0f766e;border-radius:10px;padding:12px 14px;font:14px/1.45 system-ui,sans-serif;max-width:380px;box-shadow:0 6px 24px rgba(0,0,0,.25)";
document.body.appendChild(box);
var say=function(t){box.textContent="Seller-System: "+t};
var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
var MORE=/^(mehr( aussteller)? (laden|anzeigen)|weitere (laden|anzeigen|aussteller|ergebnisse)|alle anzeigen|load more|show more|more results|view more)\b/i;
var last=0,same=0;
for(var i=0;i<80&&same<3;i++){window.scrollTo(0,document.body.scrollHeight);await sleep(900);var b=Array.prototype.slice.call(document.querySelectorAll("button,a,[role=button]")).find(function(x){var t=(x.innerText||"").trim();return t.length<40&&MORE.test(t)&&x.offsetParent!==null});if(b){try{b.click()}catch(e){}await sleep(1500)}var n=document.body.innerText.length;if(n===last)same++;else{same=0;last=n}say("lade Ausstellerliste … ("+Math.round(n/1000)+" k Zeichen)")}
var texts=[document.body.innerText];
var links=Array.prototype.slice.call(document.querySelectorAll("a[href]")).map(function(a){return {t:(a.innerText||"").trim().replace(/\s+/g," ").slice(0,120),h:a.href}}).filter(function(x){return x.t&&/^https?:/.test(x.h)});
var NEXT=/^(weiter|nächste( seite)?|next|›|»)$/i;
var seen={};seen[location.href]=1;var doc=document;
for(var p=0;p<30;p++){var nx=Array.prototype.slice.call(doc.querySelectorAll("a[href]")).find(function(a){return (a.getAttribute("rel")==="next"||NEXT.test((a.textContent||"").trim()))});if(!nx)break;var u=new URL(nx.getAttribute("href"),location.href).href;if(seen[u]||new URL(u).host!==location.host)break;seen[u]=1;say("lese Seite "+(p+2)+" …");try{var h=await (await fetch(u,{credentials:"include"})).text();doc=new DOMParser().parseFromString(h,"text/html");texts.push(doc.body?doc.body.innerText||doc.body.textContent:"");Array.prototype.slice.call(doc.querySelectorAll("a[href]")).forEach(function(a){var t=(a.textContent||"").trim().replace(/\s+/g," ").slice(0,120);try{if(t)links.push({t:t,h:new URL(a.getAttribute("href"),u).href})}catch(e){}})}catch(e){break}await sleep(700)}
var data=JSON.stringify({messeImport:1,url:location.href,title:document.title,text:texts.join("\n").slice(0,600000),links:links.slice(0,4000)});
box.textContent="";var pp=document.createElement("div");pp.textContent="Seller-System: Ausstellerliste gelesen ("+texts.length+" Seite(n), "+Math.round(data.length/1000)+" k Zeichen).";box.appendChild(pp);
var btn=document.createElement("button");btn.textContent="An Seller-System senden";btn.style.cssText="margin-top:8px;padding:8px 12px;background:#0f766e;color:#fff;border:0;border-radius:8px;font-weight:600;cursor:pointer";
btn.onclick=function(){var ta=document.createElement("textarea");ta.value=data;document.body.appendChild(ta);ta.select();try{document.execCommand("copy")}catch(x){}ta.remove();var w=window.open(O+"/lieferanten/finden?import=messe","_blank");var n=0;var iv=setInterval(function(){n++;try{if(w)w.postMessage(data,O)}catch(x){}if(n>60)clearInterval(iv)},500);window.addEventListener("message",function(e){if(e.origin===O&&e.data==="sellersys-ok"){clearInterval(iv);pp.textContent="Seller-System: übertragen ✓ – im anderen Tab „Aussteller übernehmen“ klicken."}});pp.textContent="Seller-System: kopiert. Falls im neuen Tab nichts erscheint: dort unter „Messe“ einfügen (Strg+V)."};
box.appendChild(btn);
})()`;

export function messeBookmarkletSource(origin: string) {
  return SOURCE.replace("__ORIGIN__", origin.replace(/["\\]/g, ""));
}

export const messeBookmarkletHref = (origin: string) => `javascript:${encodeURIComponent(messeBookmarkletSource(origin).replace(/\n/g, ""))}`;
