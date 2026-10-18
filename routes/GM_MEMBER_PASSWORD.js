'use strict';
// GM_MEMBER_PASSWORD_V019: single hash/verify implementation for member authentication.
const crypto=require('crypto');
let argon2=null;try{argon2=require('argon2');}catch(_e){}
function pickPasswordPlain(b){
  // Accept only transient password fields from HTTPS request body.
  // Never store these values in raw_json, session storage, logs, or exports.
  const names = [
    'password_plain','plain_password','member_password','passwd','user_passwd','password',
    'new_passwd','new_password','newPassword'
  ];
  for(const n of names){
    if(b[n] !== undefined && b[n] !== null && String(b[n]).trim() !== '') return String(b[n]);
  }
  return '';
}
async function hashPasswordIfPresent(b){
  const plain = pickPasswordPlain(b);
  if(!plain) return null;
  if(!argon2 || !argon2.hash) {
    const crypto = require('crypto');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(plain, salt, 120000, 64, 'sha512').toString('hex');
    return { password_hash: `pbkdf2_sha512$120000$${salt}$${hash}`, password_algo: 'pbkdf2_sha512', password_updated_at: new Date(), password_migrated: 'Y' };
  }
  const hash = await argon2.hash(plain, { type: argon2.argon2id });
  return { password_hash: hash, password_algo: 'argon2id', password_updated_at: new Date(), password_migrated: 'Y' };
}

async function gmVerifyHash(plain, stored){
  if(!plain || !stored) return false;
  if(stored.startsWith('$argon2')) return !!(argon2 && await argon2.verify(stored,plain));
  const a=stored.split('$');
  if(a.length!==4 || a[0]!=='pbkdf2_sha512') return false;
  const rounds=Number(a[1]);
  if(!Number.isInteger(rounds)||rounds<100000||rounds>2000000||!/^[0-9a-f]{32}$/i.test(a[2])||!/^[0-9a-f]{128}$/i.test(a[3])) return false;
  // Earlier GM_MEMBER used the hex salt STRING as the KDF salt. Preserve that contract.
  const expected=Buffer.from(a[3],'hex');
  const derived=crypto.pbkdf2Sync(plain,a[2],rounds,expected.length,'sha512');
  return crypto.timingSafeEqual(expected,derived);
}

module.exports={pickPasswordPlain,hashPasswordIfPresent,gmVerifyHash};
