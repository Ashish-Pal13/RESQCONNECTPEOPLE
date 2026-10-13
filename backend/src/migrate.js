import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {pool,describeConnectionError} from './db.js';
const MIGRATION_LOCK_KEY=727274190;
const dir=process.env.MIGRATIONS_DIR?path.resolve(process.env.MIGRATIONS_DIR):path.join(path.dirname(fileURLToPath(import.meta.url)),'..','sql','migrations');
const statusOnly=process.argv.includes('--status');
const version=file=>Number(file.match(/^(\d+)_/)[1]);
const checksum=sql=>crypto.createHash('sha256').update(sql.replace(/\r\n/g,'\n')).digest('hex');
if(!process.env.DATABASE_URL){console.error('Set DATABASE_URL in backend/.env before running migrations.');process.exit(1)}
let client;
try{client=await pool.connect()}catch(e){console.error(`Cannot connect to PostgreSQL: ${describeConnectionError(e)}`);await pool.end();process.exit(1)}
let locked=false;
try{
 const files=fs.readdirSync(dir).filter(f=>/^\d+_.+\.sql$/.test(f)).sort((a,b)=>version(a)-version(b)||a.localeCompare(b));
 const versions=files.map(version);
 if(new Set(versions).size!==versions.length)throw new Error('Two migration files share the same version number. Rename one so every number is unique.');
 await client.query('SELECT pg_advisory_lock($1)',[MIGRATION_LOCK_KEY]);
 locked=true;
 await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(200) PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
 await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum VARCHAR(64)');
 const applied=new Map((await client.query('SELECT name,checksum FROM schema_migrations')).rows.map(r=>[r.name,r.checksum]));
 const pending=[];
 for(const file of files){
  const sql=fs.readFileSync(path.join(dir,file),'utf8');
  const sum=checksum(sql);
  if(applied.has(file)){
   const stored=applied.get(file);
   if(!stored)await client.query('UPDATE schema_migrations SET checksum=$2 WHERE name=$1',[file,sum]);
   else if(stored!==sum)console.warn(`Warning: ${file} was changed after it was applied. It will not run again; create a new migration for further changes.`);
   if(statusOnly)console.log(`applied   ${file}`);
   continue;
  }
  pending.push({file,sql,sum});
  if(statusOnly)console.log(`pending   ${file}`);
 }
 if(statusOnly){console.log(`${pending.length} pending migration(s)`)}
 else{
  for(const {file,sql,sum} of pending){
   try{
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',[file,sum]);
    await client.query('COMMIT');
    console.log(`Applied ${file}`);
   }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    throw new Error(`Migration ${file} failed and was rolled back: ${e.message}`);
   }
  }
  console.log(pending.length?`${pending.length} migration(s) applied`:'Database is already up to date');
 }
}catch(e){
 console.error(e.message);
 process.exitCode=1;
}finally{
 if(locked)await client.query('SELECT pg_advisory_unlock($1)',[MIGRATION_LOCK_KEY]).catch(()=>{});
 client.release();
 await pool.end();
}
