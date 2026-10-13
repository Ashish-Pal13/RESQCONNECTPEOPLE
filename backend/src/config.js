import net from 'node:net';
const PROXY_PRESETS=new Set(['loopback','linklocal','uniquelocal']);
const MAX_PROXY_HOPS=10;
function isValidProxyEntry(entry){
 if(PROXY_PRESETS.has(entry))return true;
 const parts=entry.split('/');
 if(parts.length>2)return false;
 const family=net.isIP(parts[0]);
 if(!family)return false;
 if(parts.length===1)return true;
 if(!/^\d{1,3}$/.test(parts[1]))return false;
 return Number(parts[1])<=(family===4?32:128);
}
export function parseTrustProxy(raw){
 const value=String(raw??'').trim();
 if(!value)return false;
 const lower=value.toLowerCase();
 if(lower==='false')return false;
 if(lower==='true')return true;
 if(/^\d+$/.test(value)){
  const hops=Number(value);
  if(hops>MAX_PROXY_HOPS)throw new Error(`Invalid TRUST_PROXY value "${value}". Use a proxy hop count between 0 and ${MAX_PROXY_HOPS}.`);
  return hops===0?false:hops;
 }
 const entries=lower.split(',').map(entry=>entry.trim()).filter(Boolean);
 if(!entries.length||!entries.every(isValidProxyEntry)){
  throw new Error(`Invalid TRUST_PROXY value "${value}". Use false, true, a proxy hop count such as 1, or a comma-separated list of IP addresses, CIDR ranges, loopback, linklocal or uniquelocal.`);
 }
 return entries;
}
