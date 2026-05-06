const https=require("https");
const http=require("http");
const GLITCH=["glitch","price error","price mistake","misprice","wrong price","lowest ever","all time low","record low","flash sale","lightning deal","coupon stack","checkout glitch","insane deal","massive discount"];
const DEAD=["expired","out of stock","sold out","no longer available","deal ended","[expired]","(expired)","deal is dead","unavailable"];
function fetch(url,ms){
  ms=ms||5000;
  return new Promise((res,rej)=>{
    const lib=url.startsWith("https")?https:http;
    const req=lib.get(url,{headers:{"User-Agent":"Mozilla/5.0 (compatible; GlitchHunterBot/3.0)","Accept":"application/rss+xml,application/xml,text/xml,*/*"}},(r)=>{
      if([301,302,303,307,308].includes(r.statusCode)&&r.headers.location){fetch(r.headers.location,ms).then(res).catch(rej);return;}
      if(r.statusCode>=400){rej(new Error("HTTP "+r.statusCode));return;}
      const c=[];r.on("data",d=>c.push(d));r.on("end",()=>res(Buffer.concat(c).toString("utf8")));
    });
    req.setTimeout(ms,()=>{req.destroy();rej(new Error("timeout"));});
    req.on("error",rej);
  });
}
function parse(xml,source,color){
  const out=[],now=Date.now(),FRESH=48*3600*1000;
  for(const b of(xml.match(/<item[\s\S]*?<\/item>/gi)||[])){
    const g=t=>{const m=b.match(new RegExp("<"+t+"[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></"+t+">","i"))||b.match(new RegExp("<"+t+"[^>]*>([\\s\\S]*?)</"+t+">","i"));return m?m[1].replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim():"";};
    const title=g("title"),desc=g("description"),link=g("link")||g("guid"),pub=g("pubDate")||g("dc:date");
    if(!title||title.length<4)continue;
    if(pub){const a=now-new Date(pub).getTime();if(!isNaN(a)&&a>FRESH)continue;}
    const low=(title+" "+desc).toLowerCase();
    if(DEAD.some(k=>low.includes(k)))continue;
    const pm=(title+" "+desc).match(/\$[\d,]+(?:\.\d{2})?/);
    const dm=(title+" "+desc).match(/(\d{1,3})%\s*off/i);
    const ts=pub?(new Date(pub).getTime()||now):now;
    out.push({id:Buffer.from(title.slice(0,30)).toString("base64").replace(/[^a-zA-Z0-9]/g,"").slice(0,12),title:title.slice(0,120),desc:desc.slice(0,250),link:link||"",extLink:null,source,color,isGlitch:GLITCH.some(k=>low.includes(k)),price:pm?pm[0]:null,discount:dm?parseInt(dm[1]):null,timestamp:ts,score:null,comments:null,flair:null});
  }
  return out;
}
const SOURCES=[
  {url:"https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&q=amazon&rss=1",name:"Slickdeals",color:"#e63946"},
  {url:"https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&q=price+error&rss=1",name:"Slickdeals",color:"#e63946"},
  {url:"https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&rss=1",name:"Slickdeals Hot",color:"#e63946"},
  {url:"https://www.dealnews.com/c142/Computers/?srcval=rss_main",name:"Dealnews",color:"#2a9d8f"},
  {url:"https://www.dealnews.com/c232/Electronics/?srcval=rss_main",name:"Dealnews",color:"#2a9d8f"},
  {url:"https://9to5toys.com/feed/",name:"9to5Toys",color:"#0066cc"},
  {url:"https://9to5mac.com/feed/",name:"9to5Mac",color:"#555"},
  {url:"https://techbargains.com/feed/",name:"TechBargains",color:"#457b9d"},
  {url:"https://camelcamelcamel.com/top_drops/feed?n=25",name:"CamelCamelCamel",color:"#6a0572"},
  {url:"https://www.hotukdeals.com/rss/deals",name:"HotUKDeals",color:"#e76f51"},
  {url:"https://www.nytimes.com/wirecutter/deals/feed/",name:"Wirecutter",color:"#326891"},
  {url:"https://bensbargains.com/feed/",name:"BensBargains",color:"#c77dff"},
];
const RID=process.env.REDDIT_CLIENT_ID||"";
const RSEC=process.env.REDDIT_CLIENT_SECRET||"";
const UA="GlitchHunterBot/3.0";
let rtok={t:null,e:0};
async function rdToken(){
  if(rtok.t&&Date.now()<rtok.e)return rtok.t;
  if(!RID||!RSEC)return null;
  try{
    const auth=Buffer.from(RID+":"+RSEC).toString("base64");
    const body="grant_type=client_credentials";
    const raw=await new Promise((res,rej)=>{
      const req=https.request({hostname:"www.reddit.com",path:"/api/v1/access_token",method:"POST",headers:{"Authorization":"Basic "+auth,"Content-Type":"application/x-www-form-urlencoded","Content-Length":Buffer.byteLength(body),"User-Agent":UA}},(r)=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>res(d));});
      req.setTimeout(5000,()=>{req.destroy();rej(new Error("timeout"));});req.on("error",rej);req.write(body);req.end();
    });
    const j=JSON.parse(raw);
    if(!j.access_token)return null;
    rtok={t:j.access_token,e:Date.now()+(j.expires_in-60)*1000};
    return j.access_token;
  }catch{return null;}
}
async function reddit(sub,q,sort){
  try{
    const tok=await rdToken();
    const base=tok?"https://oauth.reddit.com":"https://www.reddit.com";
    const hdrs=tok?{"Authorization":"Bearer "+tok,"User-Agent":UA}:{"User-Agent":UA};
    const path=q?"/r/"+sub+"/search.json?q="+encodeURIComponent(q)+"&sort="+(sort||"new")+"&restrict_sr=1&limit=20&t=week":"/r/"+sub+"/"+(sort||"hot")+".json?limit=20";
    const raw=await fetch(base+path,5000);
    const posts=(JSON.parse(raw)?.data?.children)||[];
    const now=Date.now(),FRESH=48*3600*1000;
    return posts.map(p=>{
      const d=p.data;if(!d?.title)return null;
      const ts=d.created_utc?d.created_utc*1000:now;
      if(now-ts>FRESH)return null;
      const low=((d.title||"")+" "+(d.selftext||"")).toLowerCase();
      if(DEAD.some(k=>low.includes(k))&&(d.score||0)<10)return null;
      const pm=(d.title+" "+(d.selftext||"")).match(/\$[\d,]+(?:\.\d{2})?/);
      const dm=(d.title+" "+(d.selftext||"")).match(/(\d{1,3})%\s*off/i);
      const ext=d.url&&d.url.startsWith("http")&&!d.url.includes("reddit.com")?d.url:null;
      return{id:d.id||"",title:(d.title||"").slice(0,120),desc:(d.selftext||"").replace(/\n+/g," ").slice(0,250),link:"https://reddit.com"+(d.permalink||""),extLink:ext,source:"r/"+sub,color:"#ff6314",isGlitch:GLITCH.some(k=>low.includes(k)),price:pm?pm[0]:null,discount:dm?parseInt(dm[1]):null,timestamp:ts,score:d.score||0,comments:d.num_comments||0,flair:d.link_flair_text||null};
    }).filter(Boolean);
  }catch{return[];}
}
const RSUBS=[
  {sub:"deals",q:"",sort:"hot"},{sub:"deals",q:"amazon",sort:"new"},
  {sub:"buildapcsales",q:"",sort:"hot"},{sub:"PCDeals",q:"",sort:"hot"},
  {sub:"DealAlert",q:"",sort:"new"},{sub:"amazondealsusa",q:"",sort:"new"},
];
exports.handler=async function(event){
  const h={"Access-Control-Allow-Origin":"*","Content-Type":"application/json","Cache-Control":"public, max-age=1800"};
  if(event.httpMethod==="OPTIONS")return{statusCode:200,headers:h,body:""};
  try{
    const[rss,rd]=await Promise.all([
      Promise.allSettled(SOURCES.map(s=>fetch(s.url,4000).then(x=>parse(x,s.name,s.color)).catch(()=>[]))),
      Promise.allSettled(RSUBS.map(s=>reddit(s.sub,s.q,s.sort))),
    ]);
    const ri=rss.flatMap(r=>r.status==="fulfilled"?r.value:[]);
    const di=rd.flatMap(r=>r.status==="fulfilled"?r.value:[]);
    let all=[...ri,...di];
    const seen=new Set();
    all=all.filter(d=>{
      if(!d?.title)return false;
      const k=d.title.toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,35);
      if(seen.has(k))return false;seen.add(k);return true;
    });
    all.sort((a,b)=>b.timestamp-a.timestamp);
    const glitches=all.filter(d=>d.isGlitch),deals=all.filter(d=>!d.isGlitch);
    const sc={};all.forEach(d=>{sc[d.source]=(sc[d.source]||0)+1;});
    return{statusCode:200,headers:h,body:JSON.stringify({ok:true,ts:new Date().toISOString(),redditOn:!!(RID&&RSEC),stats:{total:all.length,glitches:glitches.length,deals:deals.length,sources:Object.keys(sc).length,sourceCounts:sc},glitches,deals})};
  }catch(e){
    return{statusCode:500,headers:h,body:JSON.stringify({ok:false,error:e.message})};
  }
};
