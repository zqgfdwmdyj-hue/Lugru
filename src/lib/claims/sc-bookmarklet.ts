// Lesezeichen für Seller Central: Auf der Liste der Remissionsaufträge öffnet es jeden Auftrag
// unsichtbar (gleiche Anmeldung), stellt „Alle versendeten Einheiten anzeigen“ ein, klappt die
// Sendungsverfolgung auf und nimmt den Seitentext mit. Gedeutet wird auf dem Server (sc-removal.ts),
// damit Verbesserungen ohne neues Lesezeichen wirken. Es klickt nur diese Anzeige-Schalter, nie
// Knöpfe, die etwas ändern.

const SOURCE = String.raw`(async()=>{
var O="__ORIGIN__";
var box=document.createElement("div");
box.style.cssText="position:fixed;top:12px;right:12px;z-index:2147483647;background:#fff;color:#111;border:2px solid #0f766e;border-radius:10px;padding:12px 14px;font:14px/1.45 system-ui,sans-serif;max-width:380px;box-shadow:0 6px 24px rgba(0,0,0,.25)";
document.body.appendChild(box);
var say=function(t){box.textContent="Seller-System: "+t};
var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
var all=function(root,sel,out){out=out||[];root.querySelectorAll(sel).forEach(function(e){out.push(e)});root.querySelectorAll("*").forEach(function(e){if(e.shadowRoot)all(e.shadowRoot,sel,out)});return out};
var deep=function(n){var s="";n.childNodes.forEach(function(c){if(c.nodeType===3){s+=c.textContent}else if(c.nodeType===1){var t=c.tagName;if(t==="SCRIPT"||t==="STYLE"||t==="NOSCRIPT")return;if(c.shadowRoot)s+=deep(c.shadowRoot);s+=deep(c);if(t==="TD"||t==="TH"||t==="KAT-TABLE-CELL")s+="\t";else if(/^(DIV|P|TR|LI|H[1-6]|SECTION|TABLE|BR|LABEL|KAT-TABLE-ROW)$/.test(t))s+="\n"}});return s};
var textOf=function(doc){if(!doc||!doc.body)return "";var a=doc.body.innerText||"";var b=deep(doc.body);return (b.length>a.length*1.2?b:a).replace(/[ \u00a0]+/g," ").replace(/\n\s*\n+/g,"\n").slice(0,40000)};
var click=function(doc,re){var n=0;all(doc,"a,button,label,kat-radiobutton,kat-link,kat-button,[role=button],[role=radio]").forEach(function(e){var t=(e.innerText||e.getAttribute("label")||e.getAttribute("aria-label")||"").trim();if(t&&t.length<80&&re.test(t)){try{e.click();n++}catch(x){}}});return n};
var SHIP=/^(Alle versendeten Einheiten anzeigen|Show all shipped units|View all shipped units)$/i;
var TRK=/^(Sendungsverfolgungsdetails anzeigen|SV anzeigen|Sendungsverfolgung anzeigen|View tracking details|Track package|Tracking details)$/i;
var READY=/Sendungsverfolgung|Tracking|Versandte St|Shipped/i;
var grab=async function(doc){if(click(doc,SHIP))await sleep(1500);if(click(doc,TRK))await sleep(3000);return textOf(doc)};
var ID=/^[A-Za-z0-9][A-Za-z0-9-]{5,29}$/;
var links=[],seen={},rows=[];
all(document,"a[href]").forEach(function(a){var t=(a.innerText||"").trim();if(!ID.test(t))return;var h=a.href;if(!/^https?:/.test(h)||seen[h]||a.origin!==location.origin)return;var row=a.closest("tr,[role=row],kat-table-row");if(!row||rows.indexOf(row)>=0)return;rows.push(row);seen[h]=1;links.push({orderId:t,url:h,rowText:(row.innerText||"").replace(/\s+/g," ").slice(0,400)})});
var pages=[];
if(!links.length){say("lese diese Seite …");pages.push({url:location.href,orderId:null,rowText:"",text:await grab(document)})}
else{for(var i=0;i<links.length;i++){var L=links[i];say("Auftrag "+(i+1)+" von "+links.length+" ("+L.orderId+") – Tab bitte offen lassen");var txt="";var f=document.createElement("iframe");f.style.cssText="position:fixed;left:-3000px;top:0;width:1280px;height:1000px;opacity:0";f.src=L.url;document.body.appendChild(f);try{await new Promise(function(r){f.onload=r;setTimeout(r,20000)});var d=f.contentDocument;for(var k=0;k<30&&d&&!READY.test(textOf(d));k++){await sleep(500);d=f.contentDocument}if(d)txt=await grab(d)}catch(x){txt=""}f.remove();if(!txt){try{var h=await (await fetch(L.url,{credentials:"include"})).text();txt=textOf(new DOMParser().parseFromString(h,"text/html"))}catch(x){}}pages.push({url:L.url,orderId:L.orderId,rowText:L.rowText,text:txt})}}
var data=JSON.stringify({scRemoval:1,from:location.href,at:new Date().toISOString(),pages:pages});
var hits=(data.match(/tendron/gi)||[]).length;
box.textContent="";var p=document.createElement("div");p.textContent="Seller-System: "+pages.length+" Auftragsseite(n) gelesen, "+hits+"× „Tendron“ im Text.";box.appendChild(p);
var b=document.createElement("button");b.textContent="Kopieren und ans Seller-System senden";b.style.cssText="margin-top:8px;padding:8px 12px;background:#0f766e;color:#fff;border:0;border-radius:8px;font-weight:600;cursor:pointer";
b.onclick=function(){var ta=document.createElement("textarea");ta.value=data;document.body.appendChild(ta);ta.select();try{document.execCommand("copy")}catch(x){}ta.remove();var w=window.open(O+"/remissionen/erfassen","_blank");var n=0;var t=setInterval(function(){n++;try{if(w)w.postMessage(data,O)}catch(x){}if(n>60)clearInterval(t)},500);window.addEventListener("message",function(e){if(e.origin===O&&e.data==="sellersys-ok"){clearInterval(t);p.textContent="Seller-System: übertragen ✓ – Ergebnis im anderen Tab."}});p.textContent="Seller-System: kopiert. Falls im neuen Tab nichts erscheint: dort Strg+V."};
box.appendChild(b);
})()`;

export function scBookmarkletSource(origin: string) {
  return SOURCE.replace("__ORIGIN__", origin.replace(/["\\]/g, ""));
}

export const scBookmarkletHref = (origin: string) => `javascript:${encodeURIComponent(scBookmarkletSource(origin).replace(/\n/g, ""))}`;
