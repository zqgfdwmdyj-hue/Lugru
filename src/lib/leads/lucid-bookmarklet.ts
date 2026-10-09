// Lesezeichen für das Verpackungsregister: Sperrt oder drosselt das Register Anfragen vom
// Server, läuft die gleiche Abfrage im eigenen Browser. Auf der Registerseite geklickt, fragt es
// Firmen zur Marke und je Firma die Markenliste ab (nur lesend, nacheinander mit Pause; bremst
// das Register, wird gewartet und notfalls das Gelesene geschickt). Mit „#ids=…“ im Link lädt es
// nur die fehlenden Markenlisten schon bekannter Firmen.
// Ausgewertet wird auf dem Server (logic.ts → parseLucidPayload, service.ts).

const SOURCE = String.raw`(async()=>{
var O="__ORIGIN__";
var box=document.createElement("div");
box.style.cssText="position:fixed;top:12px;right:12px;z-index:2147483647;background:#fff;color:#111;border:2px solid #0f766e;border-radius:10px;padding:12px 14px;font:14px/1.45 system-ui,sans-serif;max-width:380px;box-shadow:0 6px 24px rgba(0,0,0,.25)";
document.body.appendChild(box);
var say=function(t){box.textContent="Seller-System: "+t};
var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
var t=document.querySelector('input[name="__RequestVerificationToken"]');
if(!t){say("Bitte auf der Seite „Herstellerregister“ des Verpackungsregisters klicken (oeffentliche-register.verpackungsregister.org/Producer).");return}
var tok=t.value;
var mi=/[#&]ids=([^&]+)/.exec(location.hash);
var ids=mi?decodeURIComponent(mi[1]).split(",").filter(Boolean).slice(0,600):null;
var m=/[#&]marke=([^&]+)/.exec(location.hash);
var brand=m?decodeURIComponent(m[1].replace(/\+/g," ")):"";
if(!ids&&!brand)brand=(prompt("Seller-System: Welche Marke suchen?","")||"").trim();
if(!ids&&brand.length<2){say("keine Marke angegeben.");return}
var WAIT=[0,15000,45000,90000];
var post=async function(path,form){var body=new URLSearchParams(Object.assign({sort:"",group:"",filter:""},form,{__RequestVerificationToken:tok}));var st=0;for(var a=0;a<WAIT.length;a++){if(a){say("Register bremst (HTTP "+st+") – warte "+(WAIT[a]/1000)+" s …");await sleep(WAIT[a])}var r=await fetch(path,{method:"POST",credentials:"same-origin",headers:{"X-Requested-With":"XMLHttpRequest","Content-Type":"application/x-www-form-urlencoded; charset=UTF-8",Accept:"application/json"},body:body});st=r.status;if(r.ok)return r.json();if(st!==429&&st<500)break}throw new Error("Register antwortet mit HTTP "+st)};
var list=[],total=0,stopped=0;
try{
if(ids){list=ids.map(function(id){return {ManufacturerId:id}});total=list.length}
else{var filter="Brand~contains~'"+brand.replace(/'/g,"''")+"'";
for(var page=1;list.length<1000;page++){say("lese Firmen zu „"+brand+"“ … "+list.length);var r=await post("/Producer/ManufacturerRead",{page:String(page),pageSize:"100",filter:filter});total=r.Total||0;list=list.concat(r.Data||[]);if(!r.Data||r.Data.length<100||list.length>=total)break;await sleep(1500)}}
}catch(x){say("Fehler: "+x.message+" – später erneut klicken.");return}
for(var i=0;i<list.length;i++){list[i].brands=null;list[i].brandsComplete=false}
for(var i=0;i<list.length;i++){say("Markenliste "+(i+1)+" von "+list.length+" – Tab bitte offen lassen");try{var b=await post("/Producer/BrandRead?manufacturerId="+encodeURIComponent(list[i].ManufacturerId),{page:"1",pageSize:"2000"});list[i].brands=(b.Data||[]).filter(function(x){return !x.ValidUntil}).map(function(x){return (x.Name||"").trim()}).filter(Boolean);list[i].brandsComplete=(b.Data||[]).length>=(b.Total||0)}catch(x){stopped=list.length-i;break}await sleep(1200)}
var data=JSON.stringify({lucidImport:1,mode:ids?"brands":"full",brand:brand,total:total,at:new Date().toISOString(),producers:list});
box.textContent="";var p=document.createElement("div");p.textContent="Seller-System: "+(ids?"Markenlisten für "+(list.length-stopped)+" von "+list.length+" Firmen gelesen.":list.length+" von "+total+" Firmen zu „"+brand+"“ gelesen.")+(stopped?" Das Register bremst – "+stopped+" Markenlisten fehlen noch, sie werden später nachgeladen.":"");box.appendChild(p);
var btn=document.createElement("button");btn.textContent="An Seller-System senden";btn.style.cssText="margin-top:8px;padding:8px 12px;background:#0f766e;color:#fff;border:0;border-radius:8px;font-weight:600;cursor:pointer";
btn.onclick=function(){var ta=document.createElement("textarea");ta.value=data;document.body.appendChild(ta);ta.select();try{document.execCommand("copy")}catch(x){}ta.remove();var w=window.open(O+"/lieferanten/finden?import=register","_blank");var n=0;var iv=setInterval(function(){n++;try{if(w)w.postMessage(data,O)}catch(x){}if(n>60)clearInterval(iv)},500);window.addEventListener("message",function(e){if(e.origin===O&&e.data==="sellersys-ok"){clearInterval(iv);p.textContent="Seller-System: übertragen ✓ – Ergebnis im anderen Tab."}});p.textContent="Seller-System: kopiert. Falls im neuen Tab nichts erscheint: dort unter „Daten einfügen“ Strg+V."};
box.appendChild(btn);
})()`;

export function lucidBookmarkletSource(origin: string) {
  return SOURCE.replace("__ORIGIN__", origin.replace(/["\\]/g, ""));
}

export const lucidBookmarkletHref = (origin: string) => `javascript:${encodeURIComponent(lucidBookmarkletSource(origin).replace(/\n/g, ""))}`;
