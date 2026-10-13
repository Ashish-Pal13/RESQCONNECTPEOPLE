import 'dotenv/config';
import pg from 'pg';
export const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,max:Number(process.env.DB_POOL_MAX||10),connectionTimeoutMillis:5000,idleTimeoutMillis:30000});
pool.on('error',err=>console.error('Unexpected database client error:',err.message));
export const query = (sql,params=[]) => pool.query(sql,params);
const CONNECTION_ERROR_CODES=new Set(['ECONNREFUSED','ECONNRESET','ENOTFOUND','ETIMEDOUT','EAI_AGAIN','57P01','57P02','57P03','53300','08000','08001','08003','08004','08006','28P01','28000','3D000']);
export const isConnectionError=err=>Boolean(err)&&(CONNECTION_ERROR_CODES.has(err.code)||err.syscall==='connect'||(Array.isArray(err.errors)&&err.errors.some(e=>e?.syscall==='connect'))||(!err.code&&/connect|timeout|terminat/i.test(err.message||'')));
export function describeConnectionError(err){
 if(err?.code==='3D000')return 'The database in DATABASE_URL does not exist. Create it first with backend/sql/create_database.sql.';
 if(err?.code==='28P01'||err?.code==='28000')return 'PostgreSQL rejected the username or password in DATABASE_URL.';
 if(err?.code==='ECONNREFUSED')return 'Could not reach PostgreSQL. Check that the PostgreSQL service is running and that the host and port in DATABASE_URL are correct.';
 if(err?.code==='ENOTFOUND'||err?.code==='EAI_AGAIN')return 'The database host in DATABASE_URL could not be found.';
 return err?.message||'Unknown database error';
}
export async function transaction(work){
 const client=await pool.connect();
 let brokenConnection;
 try{
  await client.query('BEGIN');
  const result=await work(client);
  await client.query('COMMIT');
  return result;
 }catch(e){
  try{await client.query('ROLLBACK')}catch(rollbackError){brokenConnection=rollbackError;console.error('Rollback failed:',rollbackError.message)}
  throw e;
 }finally{
  client.release(brokenConnection);
 }
}
