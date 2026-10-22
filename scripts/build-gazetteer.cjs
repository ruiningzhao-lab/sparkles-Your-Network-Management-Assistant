const cities=require('all-the-cities');const {countries}=require('countries-list');
const sel=cities.filter(c=>c.population>=120000||['Seattle','Portland','Palo Alto','Mountain View','Cupertino','Redmond','Bellevue','Kirkland','Menlo Park','Berkeley','Cambridge','Santa Monica','Boulder','Abingdon','Oxford','Brighton'].includes(c.name)&&c.population>20000);
sel.sort((a,b)=>b.population-a.population);
const seen=new Set();const out=[];
for(const c of sel){const k=c.name+'|'+c.country;if(seen.has(k))continue;seen.add(k);const [lng,lat]=c.loc.coordinates;out.push([c.name,c.country,+lat.toFixed(3),+lng.toFixed(3)]);}
const cn={};for(const [code,v] of Object.entries(countries))cn[code]=v.name;
require('fs').writeFileSync('gaz.json',JSON.stringify({c:out,n:cn}));
console.log(out.length, require('fs').statSync('gaz.json').size, out.slice(0,3));
