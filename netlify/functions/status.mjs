import {out,linked,records} from "./_ring.mjs";
export const handler=async()=>{const r=await linked(),all=await records();return out(200,{ok:true,linked:!!r,linked_at:r?.linked_at||null,unclaimed_tokens:all.filter(x=>x.status==="unclaimed").length})};
