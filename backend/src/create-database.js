import 'dotenv/config';
import pg from 'pg';
import {describeConnectionError} from './db.js';
if(!process.env.DATABASE_URL){console.error('Set DATABASE_URL in backend/.env first.');process.exit(1)}
const target=new URL(process.env.DATABASE_URL);
const name=decodeURIComponent(target.pathname.replace(/^\//,''));
if(!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(name)){console.error(`The database name "${name}" in DATABASE_URL is not valid.`);process.exit(1)}
const admin=new URL(process.env.DATABASE_URL);
admin.pathname='/'+(process.env.MAINTENANCE_DB||'postgres');
const client=new pg.Client({connectionString:admin.toString(),connectionTimeoutMillis:5000});
try{
 await client.connect();
 const exists=(await client.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount>0;
 if(exists)console.log(`Database "${name}" already exists.`);
 else{await client.query(`CREATE DATABASE "${name}"`);console.log(`Database "${name}" created.`)}
}catch(e){
 console.error(e.code==='42501'?'This PostgreSQL user is not allowed to create databases. Create it in pgAdmin instead.':`Cannot connect to PostgreSQL: ${describeConnectionError(e)}`);
 process.exitCode=1;
}finally{await client.end().catch(()=>{})}
