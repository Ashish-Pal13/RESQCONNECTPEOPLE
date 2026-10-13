import 'dotenv/config';
import bcrypt from 'bcryptjs';
import {query,pool,describeConnectionError} from './db.js';
const resetPasswords=process.argv.includes('--reset-passwords');
const accounts=[
 {role:'coordinator',name:'Emergency Coordinator',prefix:'COORDINATOR'},
 {role:'verifier',name:'Volunteer Verification Admin',prefix:'VERIFIER'}
].map(a=>{
 const username=(process.env[`${a.prefix}_USERNAME`]||'').trim().toLowerCase();
 return {...a,username,password:process.env[`${a.prefix}_PASSWORD`]||'',email:(process.env[`${a.prefix}_EMAIL`]||`${username}@resqconnect.local`).trim().toLowerCase()};
});
const passwordProblem=a=>{
 if(a.password.length<12)return `${a.prefix}_PASSWORD must be at least 12 characters`;
 if(Buffer.byteLength(a.password,'utf8')>72)return `${a.prefix}_PASSWORD must be at most 72 bytes`;
 return null;
};
const problems=[];
if(!process.env.DATABASE_URL)problems.push('DATABASE_URL is required');
for(const a of accounts){
 if(!/^[a-z0-9._-]{3,60}$/.test(a.username))problems.push(`${a.prefix}_USERNAME must be 3-60 characters (letters, digits, . _ -)`);
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email))problems.push(`${a.prefix}_EMAIL must be a valid email address`);
}
if(accounts[0].username&&accounts[0].username===accounts[1].username)problems.push('COORDINATOR_USERNAME and VERIFIER_USERNAME must be different');
if(problems.length){console.error('Fix your backend/.env:\n- '+problems.join('\n- '));process.exit(1)}
try{
 for(const a of accounts){
  const existing=(await query('SELECT id,role FROM users WHERE username=$1',[a.username])).rows[0];
  if(existing){
   if(existing.role!==a.role){console.warn(`Skipped ${a.username}: an account with this username already exists with the role "${existing.role}". It was not changed.`);continue}
   if(!resetPasswords){console.log(`${a.name} account already exists (username: ${a.username}). Password unchanged.`);continue}
   const problem=passwordProblem(a);
   if(problem){console.error(`Cannot reset ${a.username}: ${problem}`);process.exitCode=1;continue}
   await query('UPDATE users SET password_hash=$1 WHERE id=$2',[await bcrypt.hash(a.password,12),existing.id]);
   console.log(`${a.name} password reset (username: ${a.username}).`);
   continue;
  }
  const problem=passwordProblem(a);
  if(problem){console.error(`Cannot create ${a.username}: ${problem}`);process.exitCode=1;continue}
  const hash=await bcrypt.hash(a.password,12);
  try{
   const created=await query('INSERT INTO users(name,email,username,password_hash,role,is_active) VALUES($1,$2,$3,$4,$5,TRUE) ON CONFLICT(username) DO NOTHING RETURNING id',[a.name,a.email,a.username,hash,a.role]);
   console.log(created.rowCount?`${a.name} account created (username: ${a.username}).`:`${a.name} account already exists (username: ${a.username}). Password unchanged.`);
  }catch(e){
   if(e.code==='23505'){console.error(`Cannot create ${a.username}: the email ${a.email} is already used by another account. Set ${a.prefix}_EMAIL to an unused address.`);process.exitCode=1;continue}
   throw e;
  }
 }
}catch(e){
 console.error(e.code&&/^(08|28|3D|57)|^E/.test(e.code)?`Cannot connect to PostgreSQL: ${describeConnectionError(e)}`:e.code==='42703'||e.code==='42P01'?'The database schema is out of date. Run "npm run migrate" first.':e.message);
 process.exitCode=1;
}finally{await pool.end()}
