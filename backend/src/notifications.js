import {z} from 'zod';
import {query} from './db.js';
const clip=(value,max)=>{const text=String(value??'').replace(/\s+/g,' ').trim();return text.length>max?`${text.slice(0,max-1)}…`:text};
export async function notifyUsers(db,userIds,{type,title,message='',link=''}){
 const ids=[...new Set((userIds||[]).filter(Boolean).map(String))];
 if(!ids.length)return 0;
 const r=await db.query(`INSERT INTO notifications(recipient_id,type,title,message,link)
  SELECT u.id,$2,$3,$4,$5 FROM users u WHERE u.id=ANY($1::bigint[]) AND u.is_active`,[ids,type,clip(title,160),clip(message,500),link]);
 return r.rowCount;
}
export async function notifyRoles(db,roles,payload,{excludeUserId}={}){
 const r=await db.query('SELECT id FROM users WHERE role=ANY($1::text[]) AND is_active AND ($2::bigint IS NULL OR id<>$2)',[roles,excludeUserId??null]);
 return notifyUsers(db,r.rows.map(row=>row.id),payload);
}
export function registerNotificationRoutes(app,{auth,wrap}){
 const idParam=z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
 const unreadCount=async userId=>(await query('SELECT COUNT(*)::int AS count FROM notifications WHERE recipient_id=$1 AND NOT is_read',[userId])).rows[0].count;
 app.get('/api/notifications',auth,wrap(async(req,res)=>{
  const q=z.object({limit:z.coerce.number().int().min(1).max(50).default(20)}).parse(req.query);
  const rows=(await query('SELECT id,type,title,message,link,is_read,read_at,created_at FROM notifications WHERE recipient_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2',[req.user.id,q.limit])).rows;
  res.json({data:rows,unread_count:await unreadCount(req.user.id)});
 }));
 app.get('/api/notifications/unread-count',auth,wrap(async(req,res)=>res.json({unread_count:await unreadCount(req.user.id)})));
 app.patch('/api/notifications/read-all',auth,wrap(async(req,res)=>{
  const r=await query('UPDATE notifications SET is_read=TRUE,read_at=NOW() WHERE recipient_id=$1 AND NOT is_read',[req.user.id]);
  res.json({updated:r.rowCount,unread_count:0});
 }));
 app.patch('/api/notifications/:id/read',auth,wrap(async(req,res)=>{
  const r=await query('UPDATE notifications SET is_read=TRUE,read_at=COALESCE(read_at,NOW()) WHERE id=$1 AND recipient_id=$2 RETURNING id,type,title,message,link,is_read,read_at,created_at',[idParam.parse(req.params.id),req.user.id]);
  if(!r.rowCount)return res.status(404).json({error:'Notification not found'});
  res.json({data:r.rows[0],unread_count:await unreadCount(req.user.id)});
 }));
}
