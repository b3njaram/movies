import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const ROOT=path.dirname(process.env.DB_PATH||'/app/data/streamhub.db');
const SECRET_FILE=path.join(ROOT,'cast-signing-key');
let secret=null;
export function castSecret(){
  if(secret)return secret;
  fs.mkdirSync(ROOT,{recursive:true});
  try {fs.writeFileSync(SECRET_FILE,crypto.randomBytes(32),{flag:'wx',mode:0o600});}
  catch(e){if(e.code!=='EEXIST')throw e;}
  secret=fs.readFileSync(SECRET_FILE);
  if(secret.length!==32)throw new Error('Invalid casting key; refusing to issue signed URLs.');
  return secret;
}
const b64=x=>Buffer.from(x).toString('base64url');
export function signCastToken(key,claims,now=Date.now()){
  const {userId,profileId,kind,id}=claims;
  if(!Number.isSafeInteger(userId)||userId<1||!Number.isSafeInteger(profileId)||profileId<1||!['library','media'].includes(kind)||!Number.isSafeInteger(id)||id<1)throw new Error('Invalid cast media.');
  const payload=b64(JSON.stringify({v:1,u:userId,p:profileId,k:kind,i:id,e:now+6*3600*1000}));
  return `${payload}.${crypto.createHmac('sha256',key).update(payload).digest('base64url')}`;
}
export function verifyCastToken(key,token,kind,id,now=Date.now()){
  if(typeof token!=='string'||token.length>1000||!/^[-\w]+\.[-\w]+$/.test(token))return null;
  const [payload,mac]=token.split('.');
  const signed=crypto.createHmac('sha256',key).update(payload).digest();
  let sent;
  try{sent=Buffer.from(mac,'base64url');}catch{return null;}
  if(sent.length!==signed.length||!crypto.timingSafeEqual(sent,signed))return null;
  try {
    const obj=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
    if(obj.v!==1||obj.k!==kind||obj.i!==Number(id)||!Number.isSafeInteger(obj.u)||!Number.isSafeInteger(obj.p)||obj.u<1||obj.p<1||!Number.isFinite(obj.e)||obj.e<=now||obj.e>now+6*3600*1000)return null;
    return obj;
  }catch{return null;}
}
export const castSupportedPath=p=>/\.(mp4|m4v|webm)$/i.test(String(p||''));
