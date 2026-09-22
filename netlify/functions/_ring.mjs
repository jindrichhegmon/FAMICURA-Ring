import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";
export const API="https://api.amazonvision.com";
const OAUTH="https://oauth.ring.com/oauth/token";
export const env=(n,req=true)=>{const v=process.env[n];if(req&&!v)throw new Error(`Missing env ${n}`);return v||""};
export const out=(s,b)=>({statusCode:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"},body:JSON.stringify(b)});
export const safe=(a,b)=>{const x=Buffer.from(String(a||"")),y=Buffer.from(String(b||""));return x.length===y.length&&crypto.timingSafeEqual(x,y)};
export const nonce=(time,account)=>crypto.createHmac("sha256",env("RING_HMAC_KEY")).update(`${time}:${account}`).digest("base64url");
export const verifyHook=(raw,sig)=>{if(!sig)return false;const got=String(sig).replace(/^sha256=/i,"");const exp=crypto.createHmac("sha256",env("RING_HMAC_KEY")).update(Buffer.from(raw||"","utf8")).digest("hex");return safe(exp,got)};
export const ring=async(path,token,opt={})=>{const h=new Headers(opt.headers||{});h.set("authorization",`Bearer ${token}`);if(opt.body&&!h.has("content-type"))h.set("content-type","application/json");return fetch(API+path,{...opt,headers:h})};
export async function exchangeCode(code){const r=await fetch(OAUTH,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"authorization_code",code,client_id:env("RING_CLIENT_ID"),client_secret:env("RING_CLIENT_SECRET")})});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j={raw:t}}if(!r.ok)throw new Error(`Ring token exchange ${r.status}: ${t}`);return j}
export async function refresh(rec){const r=await fetch(OAUTH,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"refresh_token",refresh_token:rec.refresh_token,client_id:env("RING_CLIENT_ID"),client_secret:env("RING_CLIENT_SECRET")})});const t=await r.text();if(!r.ok)throw new Error(`Ring refresh ${r.status}: ${t}`);const j=JSON.parse(t),now=Date.now();return {...rec,access_token:j.access_token,refresh_token:j.refresh_token||rec.refresh_token,expires_at:now+(j.expires_in||14400)*1000,updated_at:new Date(now).toISOString()}}
export async function me(token){const r=await ring("/v1/users/me",token);const t=await r.text();if(!r.ok)throw new Error(`/v1/users/me ${r.status}: ${t}`);const j=JSON.parse(t);const id=j?.meta?.account_id||j?.data?.attributes?.account_id||j?.data?.relationships?.account?.data?.id||j?.data?.id||j?.account_id||j?.id;if(!id)throw new Error("Account ID not found in /v1/users/me");return id}
export const store=()=>getStore("ring-tokens");
export async function records(){const s=store(),l=await s.list({prefix:"token-"}),a=[];for(const b of l.blobs||[]){try{const r=await s.get(b.key,{type:"json"});if(r)a.push(r)}catch{}}return a}
export async function save(r){await store().setJSON(`token-${r.account_id}`,r)}
export async function linked(){return (await records()).filter(x=>x.status==="linked").sort((a,b)=>String(b.updated_at||b.created_at).localeCompare(String(a.updated_at||a.created_at)))[0]||null}
export async function fresh(){let r=await linked();if(!r)return null;if(!r.expires_at||Date.now()>r.expires_at-300000){r=await refresh(r);await save(r)}return r}
export const mask=e=>{const [n="u",d="famicura.local"]=String(e||"user@famicura.local").split("@");return `${n[0]||"u"}***${n.length>1?n[n.length-1]:""}@${d}`};
