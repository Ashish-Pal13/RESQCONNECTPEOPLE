import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import {z,ZodError} from 'zod';
import {pool,query,transaction,isConnectionError,describeConnectionError} from './db.js';
import {notifyUsers,notifyRoles,registerNotificationRoutes} from './notifications.js';
import {validatePhone,formatPhone} from './phone.js';
import {parseTrustProxy} from './config.js';
import {ASSIGNMENT_STATUSES,INACTIVE_ASSIGNMENT_STATUSES,OPEN_ASSIGNMENT_STATUSES,checkAssignmentTransition} from './assignment-policy.js';
if(!process.env.JWT_SECRET || process.env.JWT_SECRET.length<32 || !process.env.DATABASE_URL){throw new Error('Configure DATABASE_URL and a JWT_SECRET of at least 32 characters')}
const app=express();
app.set('trust proxy',parseTrustProxy(process.env.TRUST_PROXY));
app.use(helmet({contentSecurityPolicy:{directives:{'style-src':["'self'","'unsafe-inline'",'https://fonts.googleapis.com'],'font-src':["'self'",'https://fonts.gstatic.com','data:']}}}));
const allowedOrigins=(process.env.CLIENT_ORIGIN||'http://localhost:5173').split(',').map(o=>o.trim()).filter(Boolean);
app.use(cors({origin:(origin,callback)=>callback(null,!origin||allowedOrigins.includes(origin)),methods:['GET','POST','PATCH'],allowedHeaders:['Content-Type','Authorization'],exposedHeaders:['X-Result-Truncated']}));
app.use(express.json({limit:'50kb'}));
const limiter=(limit,message)=>rateLimit({windowMs:15*60*1000,limit,standardHeaders:'draft-7',legacyHeaders:false,message:{error:message}});
const authLimiter=limiter(30,'Too many sign-in attempts. Try again in 15 minutes.');
const contactLimiter=limiter(10,'Too many messages. Try again in 15 minutes.');
class HttpError extends Error{constructor(status,message){super(message);this.status=status;this.expose=true}}
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const text=(max=255)=>z.string().trim().min(1).max(max);
const optionalText=(max)=>z.string().trim().max(max).default('');
const email=z.string().trim().email().max(255).transform(v=>v.toLowerCase());
const password=z.string().min(8).max(128).refine(v=>Buffer.byteLength(v,'utf8')<=72,'Password must be at most 72 bytes');
const id=z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const choice=items=>z.enum(items);
const phone=z.string().trim().min(6).max(30).regex(/^[0-9+()\-\s]+$/,'Phone may contain digits, spaces, +, - and brackets only');
const URGENCY=['Low','Medium','High','Critical'];
const INCIDENT_STATUS=['Under Review','In Progress','Resolved'];
const TICKET_STATUS=['Open','In Progress','Resolved','Closed'];
const TICKET_CATEGORIES=['Account','Emergency Report','Volunteer','Technical Issue','Other'];
const RESOURCE_PRIORITY=['Normal','High','Urgent'];
const VOLUNTEER_VERIFICATION=['Not Required','Pending Verification','Active - Verified','Rejected'];
const COORDINATOR='coordinator',VERIFIER='verifier',USER='user';
const STAFF=[COORDINATOR,VERIFIER];
const JWT_OPTIONS={algorithm:'HS256',expiresIn:'8h',issuer:'resqconnect'};
const tokenFor=u=>jwt.sign({sub:String(u.id),role:u.role},process.env.JWT_SECRET,JWT_OPTIONS);
const safeUser=u=>({id:u.id,name:u.name,email:u.email,username:u.username??null,role:u.role});
const is=(req,...roles)=>roles.includes(req.user.role);
const auth=wrap(async(req,res,next)=>{
 const bearer=req.headers.authorization||'';
 if(!bearer.startsWith('Bearer '))return res.status(401).json({error:'Authentication required'});
 let payload;
 try{payload=jwt.verify(bearer.slice(7),process.env.JWT_SECRET,{algorithms:['HS256'],issuer:'resqconnect'})}catch(e){return res.status(401).json({error:e.name==='TokenExpiredError'?'Your session has expired. Please sign in again.':'Invalid or expired token'})}
 if(!/^\d+$/.test(String(payload.sub)))return res.status(401).json({error:'Invalid or expired token'});
 const result=await query('SELECT id,name,email,username,role,is_active FROM users WHERE id=$1',[payload.sub]);
 if(!result.rows[0])return res.status(401).json({error:'Account not found'});
 if(!result.rows[0].is_active)return res.status(401).json({error:'This account has been disabled.'});
 req.user=result.rows[0];next();
});
const allow=(...roles)=>(req,res,next)=>is(req,...roles)?next():res.status(403).json({error:'You do not have permission to perform this action.'});

const PAGE_SIZES=[5,10,20,50,100];
const LEGACY_LIST_LIMIT=500;
const escapeLike=value=>value.replace(/[\\%_]/g,'\\$&');
const listParams=extra=>z.object({
 page:z.coerce.number().int().min(1).max(100000).optional(),
 pageSize:z.coerce.number().int().refine(v=>PAGE_SIZES.includes(v),`pageSize must be one of ${PAGE_SIZES.join(', ')}`).optional(),
 search:z.string().trim().max(100).default(''),
 ...extra
});
function sqlParams(){
 const values=[];
 return {values,add:value=>{values.push(value);return `$${values.length}`}};
}
function codeNumber(search,prefix){
 const match=new RegExp(`^(?:${prefix})?-?0*(\\d{1,15})$`,'i').exec(search.replace(/\s+/g,''));
 return match?Number(match[1]):null;
}
async function sendList(res,{q,select,from,where,params,order}){
 const clause=where.length?` WHERE ${where.join(' AND ')}`:'';
 if(q.page===undefined&&q.pageSize===undefined){
  const rows=(await query(`${select} ${from}${clause} ORDER BY ${order} LIMIT ${LEGACY_LIST_LIMIT+1}`,params.values)).rows;
  if(rows.length>LEGACY_LIST_LIMIT){rows.length=LEGACY_LIST_LIMIT;res.set('X-Result-Truncated','true')}
  return res.json(rows);
 }
 const pageSize=q.pageSize??20;
 const total=(await query(`SELECT COUNT(*)::int AS total ${from}${clause}`,params.values)).rows[0].total;
 const totalPages=Math.max(1,Math.ceil(total/pageSize));
 const page=Math.min(q.page??1,totalPages);
 const rows=(await query(`${select} ${from}${clause} ORDER BY ${order} LIMIT ${params.add(pageSize)} OFFSET ${params.add((page-1)*pageSize)}`,params.values)).rows;
 res.json({data:rows,pagination:{page,pageSize,total,totalPages}});
}

app.get('/api/health',async(req,res)=>{try{await query('SELECT 1');res.json({ok:true,database:'connected'})}catch{res.status(503).json({ok:false,database:'unavailable'})}});

app.post('/api/auth/register',authLimiter,wrap(async(req,res)=>{
 const data=z.object({name:text(120),email,password}).parse(req.body);
 const hash=await bcrypt.hash(data.password,12);
 const result=await query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING RETURNING id,name,email,username,role',[data.name,data.email,hash,USER]);
 if(!result.rows[0])return res.status(409).json({error:'Email already registered'});
 res.status(201).json({user:safeUser(result.rows[0]),token:tokenFor(result.rows[0])});
}));
app.post('/api/auth/login',authLimiter,wrap(async(req,res)=>{
 const data=z.object({email,password:z.string().min(1).max(128)}).parse(req.body);
 const result=await query('SELECT * FROM users WHERE email=$1',[data.email]);
 const u=result.rows[0];
 if(!u || !(await bcrypt.compare(data.password,u.password_hash)))return res.status(401).json({error:'Invalid email or password'});
 if(!u.is_active)return res.status(403).json({error:'This account has been disabled. Please contact support.'});
 res.json({user:safeUser(u),token:tokenFor(u)});
}));
app.post('/api/auth/admin-login',authLimiter,wrap(async(req,res)=>{
 const invalid=()=>res.status(401).json({error:'Invalid username or password for the selected role.'});
 const parsed=z.object({role:choice(STAFF),username:z.string().trim().min(1).max(60).transform(v=>v.toLowerCase()),password:z.string().min(1).max(128)}).safeParse(req.body);
 if(!parsed.success)return invalid();
 const d=parsed.data;
 const u=(await query('SELECT * FROM users WHERE username=$1 AND role=$2',[d.username,d.role])).rows[0];
 if(!u || !u.is_active || !(await bcrypt.compare(d.password,u.password_hash)))return invalid();
 res.json({user:safeUser(u),token:tokenFor(u)});
}));
app.get('/api/auth/me',auth,(req,res)=>res.json(safeUser(req.user)));

const contactSchema=z.object({
 name:text(120),
 email,
 subject:text(180),
 message:text(5000),
 phone_country:z.string().trim().max(5).optional(),
 phone:z.string().trim().max(32).optional()
}).transform((d,ctx)=>{
 if(!d.phone)return {...d,phone:null,phone_country:null};
 const result=validatePhone(d.phone_country||'IN',d.phone);
 if(result.error){ctx.addIssue({code:z.ZodIssueCode.custom,path:['phone'],message:result.error});return z.NEVER}
 return {...d,phone:result.e164,phone_country:result.country};
});
app.post('/api/contact',contactLimiter,wrap(async(req,res)=>{
 const d=contactSchema.parse(req.body);
 const row=await transaction(async client=>{
  const m=(await client.query('INSERT INTO contact_messages(name,email,subject,message,phone,phone_country) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,name,email,subject,message,phone,phone_country,created_at',[d.name,d.email,d.subject,d.message,d.phone,d.phone_country])).rows[0];
  await notifyRoles(client,[COORDINATOR],{type:'contact_message',title:'New contact message',message:`${m.name}${m.phone?` (${formatPhone(m.phone,m.phone_country)})`:''}: ${m.subject}`,link:`/admin/messages?highlight=${m.id}`});
  return m;
 });
 res.status(201).json(row);
}));
app.get('/api/contact',auth,allow(COORDINATOR),wrap(async(req,res)=>res.json((await query('SELECT * FROM contact_messages ORDER BY created_at DESC')).rows)));

app.get('/api/admin/summary',auth,allow(...STAFF),wrap(async(req,res)=>{
 const r=await query(`SELECT
  (SELECT COUNT(*) FROM incidents)::int AS total_incidents,
  (SELECT COUNT(*) FROM incidents WHERE status<>'Resolved')::int AS open_incidents,
  (SELECT COUNT(*) FROM incidents WHERE status='Resolved')::int AS resolved_incidents,
  (SELECT COUNT(*) FROM volunteers)::int AS volunteers,
  (SELECT COUNT(*) FROM volunteers WHERE category='General')::int AS general_volunteers,
  (SELECT COUNT(*) FROM volunteers WHERE category='Trained')::int AS trained_volunteers,
  (SELECT COUNT(*) FROM volunteers WHERE category='Trained' AND verification='Pending Verification')::int AS pending_verification,
  (SELECT COUNT(*) FROM volunteers WHERE verification='Active - Verified')::int AS verified_trained,
  (SELECT COUNT(*) FROM assignments)::int AS assignments,
  (SELECT COUNT(*) FROM assignments WHERE status=ANY($1::text[]))::int AS active_assignments,
  (SELECT COUNT(*) FROM assignments WHERE status='Completed')::int AS completed_assignments,
  (SELECT COUNT(*) FROM resources)::int AS resources,
  (SELECT COUNT(*) FROM users WHERE role='user')::int AS users,
  (SELECT COUNT(*) FROM tickets)::int AS tickets,
  (SELECT COUNT(*) FROM tickets WHERE status='Open')::int AS open_tickets,
  (SELECT COUNT(*) FROM contact_messages)::int AS contact_messages`,[OPEN_ASSIGNMENT_STATUSES]);
 res.json(r.rows[0]);
}));
app.get('/api/admin/analytics',auth,allow(COORDINATOR),wrap(async(req,res)=>{
 const [incidents,assignments,volunteers]=await Promise.all([
  query('SELECT status,COUNT(*)::int AS count FROM incidents GROUP BY status'),
  query('SELECT status,COUNT(*)::int AS count FROM assignments GROUP BY status'),
  query(`SELECT COUNT(*)::int AS total,
   COUNT(*) FILTER (WHERE category='General')::int AS general,
   COUNT(*) FILTER (WHERE category='Trained')::int AS trained,
   COUNT(*) FILTER (WHERE verification='Active - Verified')::int AS verified,
   COUNT(*) FILTER (WHERE verification='Pending Verification')::int AS pending
   FROM volunteers`)
 ]);
 const byStatus=(rows,statuses)=>Object.fromEntries(statuses.map(s=>[s,rows.find(r=>r.status===s)?.count??0]));
 const incidentCounts=byStatus(incidents.rows,INCIDENT_STATUS);
 const assignmentCounts=byStatus(assignments.rows,ASSIGNMENT_STATUSES);
 res.json({
  incidents:{total:Object.values(incidentCounts).reduce((a,b)=>a+b,0),by_status:incidentCounts},
  assignments:{total:Object.values(assignmentCounts).reduce((a,b)=>a+b,0),by_status:assignmentCounts},
  volunteers:volunteers.rows[0]
 });
}));

app.get('/api/admin/users/stats',auth,allow(COORDINATOR),wrap(async(req,res)=>{
 const r=await query(`SELECT COUNT(*)::int AS total_users,
  COUNT(*) FILTER (WHERE u.is_active)::int AS active_users,
  COUNT(*) FILTER (WHERE u.created_at>=NOW()-INTERVAL '7 days')::int AS registered_last_7_days,
  COUNT(*) FILTER (WHERE u.created_at>=NOW()-INTERVAL '30 days')::int AS registered_last_30_days,
  COUNT(v.id)::int AS with_volunteer_profile
  FROM users u LEFT JOIN volunteers v ON v.user_id=u.id WHERE u.role='user'`);
 res.json(r.rows[0]);
}));
app.get('/api/admin/users',auth,allow(COORDINATOR),wrap(async(req,res)=>{
 const q=z.object({
  page:z.coerce.number().int().min(1).max(100000).default(1),
  pageSize:z.coerce.number().int().refine(v=>PAGE_SIZES.includes(v),`pageSize must be one of ${PAGE_SIZES.join(', ')}`).default(20),
  search:z.string().trim().max(100).default(''),
  role:choice(['user','coordinator','verifier','all']).default('user'),
  volunteer:choice(['all','yes','no']).default('all'),
  status:choice(['all','active','disabled']).default('all')
 }).parse(req.query);
 const where=[];const params=[];
 const add=value=>{params.push(value);return `$${params.length}`};
 if(q.role!=='all')where.push(`u.role=${add(q.role)}`);
 if(q.status!=='all')where.push(`u.is_active=${add(q.status==='active')}`);
 if(q.volunteer==='yes')where.push('v.id IS NOT NULL');
 if(q.volunteer==='no')where.push('v.id IS NULL');
 if(q.search){const p=add(`%${escapeLike(q.search)}%`);where.push(`(u.name ILIKE ${p} ESCAPE '\\' OR u.email ILIKE ${p} ESCAPE '\\')`)}
 const from=`FROM users u LEFT JOIN volunteers v ON v.user_id=u.id${where.length?` WHERE ${where.join(' AND ')}`:''}`;
 const total=(await query(`SELECT COUNT(*)::int AS total ${from}`,params)).rows[0].total;
 const totalPages=Math.max(1,Math.ceil(total/q.pageSize));
 const page=Math.min(q.page,totalPages);
 const rows=(await query(`SELECT u.id,u.name,u.email,u.role,u.is_active,u.created_at,v.phone,v.verification AS volunteer_status ${from} ORDER BY u.created_at DESC,u.id DESC LIMIT ${add(q.pageSize)} OFFSET ${add((page-1)*q.pageSize)}`,params)).rows;
 res.json({data:rows,pagination:{page,pageSize:q.pageSize,total,totalPages}});
}));

app.get('/api/incidents',auth,allow(COORDINATOR,USER),wrap(async(req,res)=>{
 const q=listParams({status:choice([...INCIDENT_STATUS,'open']).optional(),urgency:choice(URGENCY).optional()}).parse(req.query);
 const params=sqlParams();const where=[];
 if(!is(req,COORDINATOR))where.push(`i.user_id=${params.add(req.user.id)}`);
 if(q.status==='open')where.push(`i.status<>'Resolved'`);
 else if(q.status)where.push(`i.status=${params.add(q.status)}`);
 if(q.urgency)where.push(`i.urgency=${params.add(q.urgency)}`);
 if(q.search){
  const p=params.add(`%${escapeLike(q.search)}%`);
  const parts=[`i.type ILIKE ${p} ESCAPE '\\'`,`i.location ILIKE ${p} ESCAPE '\\'`,`i.description ILIKE ${p} ESCAPE '\\'`];
  const number=codeNumber(q.search,'inc');
  if(number!==null)parts.push(`i.id=${params.add(number)}`);
  where.push(`(${parts.join(' OR ')})`);
 }
 await sendList(res,{q,select:'SELECT i.*,u.name AS reporter',from:'FROM incidents i LEFT JOIN users u ON u.id=i.user_id',where,params,order:'i.created_at DESC,i.id DESC'});
}));
app.post('/api/incidents',auth,allow(COORDINATOR,USER),wrap(async(req,res)=>{
 const d=z.object({type:text(80),location:text(255),urgency:choice(URGENCY),description:text(5000)}).parse(req.body);
 const row=await transaction(async client=>{
  const incident=(await client.query('INSERT INTO incidents(user_id,type,location,urgency,description) VALUES($1,$2,$3,$4,$5) RETURNING *',[req.user.id,d.type,d.location,d.urgency,d.description])).rows[0];
  await notifyRoles(client,[COORDINATOR],{type:'incident_created',title:`New ${incident.urgency.toLowerCase()} emergency report`,message:`INC-${incident.id} · ${incident.type} at ${incident.location}, reported by ${req.user.name}`,link:`/admin/incidents?highlight=${incident.id}`},{excludeUserId:req.user.id});
  return incident;
 });
 res.status(201).json(row);
}));
app.patch('/api/incidents/:id',auth,allow(COORDINATOR),wrap(async(req,res)=>{
 const d=z.object({status:choice(INCIDENT_STATUS)}).parse(req.body);
 const incidentId=id.parse(req.params.id);
 const row=await transaction(async client=>{
  const before=(await client.query('SELECT status,user_id FROM incidents WHERE id=$1 FOR UPDATE',[incidentId])).rows[0];
  if(!before)throw new HttpError(404,'Report not found');
  const updated=(await client.query('UPDATE incidents SET status=$1 WHERE id=$2 RETURNING *',[d.status,incidentId])).rows[0];
  let cancelled=[];
  if(d.status==='Resolved'&&before.status!=='Resolved'){
   cancelled=(await client.query(`UPDATE assignments a SET status='Cancelled',status_reason=$2,updated_at=NOW()
    FROM volunteers v WHERE v.id=a.volunteer_id AND a.incident_id=$1 AND a.status=ANY($3::text[])
    RETURNING a.id,a.task,v.user_id`,[incidentId,`Incident INC-${incidentId} was resolved`,OPEN_ASSIGNMENT_STATUSES])).rows;
   const byVolunteer=new Map();
   for(const a of cancelled){if(!byVolunteer.has(String(a.user_id)))byVolunteer.set(String(a.user_id),[]);byVolunteer.get(String(a.user_id)).push(a)}
   for(const [userId,list] of byVolunteer){
    await notifyUsers(client,[userId],{type:'assignment_cancelled',title:list.length>1?'Assignments cancelled':'Assignment cancelled',message:`${list.map(a=>`ASN-${a.id} (${a.task})`).join(', ')} ${list.length>1?'were':'was'} cancelled because INC-${incidentId} · ${updated.type} at ${updated.location} has been resolved. No further action is needed.`,link:`/dashboard/assignments?highlight=${list[0].id}`});
   }
  }
  if(before.status!==d.status&&before.user_id&&String(before.user_id)!==String(req.user.id)){
   await notifyUsers(client,[before.user_id],{type:'incident_status',title:'Emergency report status updated',message:`INC-${updated.id} · ${updated.type} at ${updated.location} is now ${updated.status}.`,link:`/dashboard/incidents?highlight=${updated.id}`});
  }
  return {...updated,cancelled_assignments:cancelled.length};
 });
 res.json(row);
}));

const volunteerReviewReason='(SELECT h.reason FROM verification_history h WHERE h.volunteer_id=v.id ORDER BY h.created_at DESC,h.id DESC LIMIT 1) AS last_review_reason';
app.get('/api/volunteers',auth,wrap(async(req,res)=>{
 const q=listParams({
  category:choice(['General','Trained']).optional(),
  availability:choice(['Available','Unavailable']).optional(),
  verification:choice(VOLUNTEER_VERIFICATION).optional(),
  eligible:choice(['true']).optional()
 }).parse(req.query);
 const params=sqlParams();const where=[];
 if(!is(req,...STAFF))where.push(`v.user_id=${params.add(req.user.id)}`);
 if(q.category)where.push(`v.category=${params.add(q.category)}`);
 if(q.availability)where.push(`v.availability=${params.add(q.availability)}`);
 if(q.verification)where.push(`v.verification=${params.add(q.verification)}`);
 if(q.eligible)where.push(`v.availability='Available' AND (v.category='General' OR v.verification='Active - Verified')`);
 if(q.search){
  const p=params.add(`%${escapeLike(q.search)}%`);
  const parts=[`u.name ILIKE ${p} ESCAPE '\\'`,`v.location ILIKE ${p} ESCAPE '\\'`,`v.skills ILIKE ${p} ESCAPE '\\'`];
  const number=codeNumber(q.search,'rc-?[tg]');
  if(number!==null)parts.push(`v.id=${params.add(number)}`);
  where.push(`(${parts.join(' OR ')})`);
 }
 await sendList(res,{q,select:`SELECT v.*,u.name,u.email,${volunteerReviewReason}`,from:'FROM volunteers v JOIN users u ON u.id=v.user_id',where,params,order:'v.created_at DESC,v.id DESC'});
}));
const volunteerApplication=z.object({
 category:choice(['General','Trained']),
 location:text(255),
 skills:text(1000),
 phone,
 training:optionalText(1000),
 certificate:optionalText(1000),
 availability:choice(['Available','Unavailable']).default('Available')
}).superRefine((d,ctx)=>{
 if(d.category!=='Trained')return;
 if(!d.training)ctx.addIssue({code:z.ZodIssueCode.custom,path:['training'],message:'Training details are required for trained volunteers'});
 if(!d.certificate)ctx.addIssue({code:z.ZodIssueCode.custom,path:['certificate'],message:'Certificate reference is required for trained volunteers'});
});
app.post('/api/volunteers',auth,allow(USER),wrap(async(req,res)=>{
 const d=volunteerApplication.parse(req.body);
 const status=d.category==='Trained'?'Pending Verification':'Not Required';
 const volunteer=await transaction(async client=>{
  const result=await client.query(`INSERT INTO volunteers(user_id,category,location,skills,phone,training,certificate,availability,verification) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
   ON CONFLICT(user_id) DO UPDATE SET category=EXCLUDED.category,location=EXCLUDED.location,skills=EXCLUDED.skills,phone=EXCLUDED.phone,training=EXCLUDED.training,certificate=EXCLUDED.certificate,availability=EXCLUDED.availability,verification=EXCLUDED.verification
   WHERE volunteers.verification='Rejected' RETURNING *`,[req.user.id,d.category,d.location,d.skills,d.phone,d.training,d.certificate,d.availability,status]);
  if(!result.rows[0])throw new HttpError(409,'Volunteer profile already exists');
  const row=result.rows[0];
  if(row.category==='Trained'){
   await notifyRoles(client,[COORDINATOR,VERIFIER],{type:'volunteer_application',title:'New trained volunteer application',message:`${req.user.name} applied as a trained volunteer in ${row.location}.`,link:`/admin/verification?highlight=${row.id}`});
  }
  return row;
 });
 res.status(201).json(volunteer);
}));
app.patch('/api/volunteers/me',auth,allow(USER),wrap(async(req,res)=>{
 const d=z.object({availability:choice(['Available','Unavailable']).optional(),location:text(255).optional(),skills:text(1000).optional(),phone:phone.optional()}).parse(req.body);
 const r=await query('UPDATE volunteers SET availability=COALESCE($1,availability),location=COALESCE($2,location),skills=COALESCE($3,skills),phone=COALESCE($4,phone) WHERE user_id=$5 RETURNING *',[d.availability??null,d.location??null,d.skills??null,d.phone??null,req.user.id]);
 if(!r.rows[0])return res.status(404).json({error:'Volunteer profile not found'});
 res.json(r.rows[0]);
}));
app.patch('/api/volunteers/:id/verify',auth,allow(...STAFF),wrap(async(req,res)=>{
 const d=z.object({decision:choice(['Approved','Rejected']),reason:z.string().trim().max(2000).default('')}).parse(req.body);
 if(d.decision==='Rejected'&&!d.reason)return res.status(400).json({error:'Please enter a reason for rejection.'});
 const volunteerId=id.parse(req.params.id);
 const row=await transaction(async client=>{
  const r=await client.query('UPDATE volunteers SET verification=$1 WHERE id=$2 AND category=$3 AND verification=$4 RETURNING *',[d.decision==='Approved'?'Active - Verified':'Rejected',volunteerId,'Trained','Pending Verification']);
  if(!r.rows[0])throw new HttpError(404,'Pending application not found');
  await client.query('INSERT INTO verification_history(volunteer_id,reviewer_id,decision,reason) VALUES($1,$2,$3,$4)',[r.rows[0].id,req.user.id,d.decision,d.reason||'Approved']);
  await notifyUsers(client,[r.rows[0].user_id],d.decision==='Approved'
   ?{type:'verification_approved',title:'Volunteer application approved',message:'Your trained volunteer application was approved. You can now receive trained-responder assignments.',link:'/dashboard/volunteer'}
   :{type:'verification_rejected',title:'Volunteer application not approved',message:`Reason: ${d.reason}`,link:'/dashboard/volunteer'});
  return r.rows[0];
 });
 res.json(row);
}));
app.get('/api/verification-history',auth,allow(...STAFF),wrap(async(req,res)=>{
 const q=listParams({}).parse(req.query);
 await sendList(res,{q,select:'SELECT h.*,r.name AS reviewer,vu.name AS volunteer_name,v.category AS volunteer_category',from:'FROM verification_history h LEFT JOIN users r ON r.id=h.reviewer_id LEFT JOIN volunteers v ON v.id=h.volunteer_id LEFT JOIN users vu ON vu.id=v.user_id',where:[],params:sqlParams(),order:'h.created_at DESC,h.id DESC'});
}));

const assignmentSelect='SELECT a.*,u.name AS volunteer_name,v.category AS volunteer_category,i.type AS incident_type,i.location AS incident_location,i.status AS incident_status';
const assignmentFrom='FROM assignments a JOIN volunteers v ON v.id=a.volunteer_id JOIN users u ON u.id=v.user_id JOIN incidents i ON i.id=a.incident_id';
app.get('/api/assignments',auth,allow(COORDINATOR,USER),wrap(async(req,res)=>{
 const q=listParams({status:choice([...ASSIGNMENT_STATUSES,'open']).optional(),incident_id:id.optional()}).parse(req.query);
 const params=sqlParams();const where=[];
 if(!is(req,COORDINATOR))where.push(`v.user_id=${params.add(req.user.id)}`);
 if(q.status==='open')where.push(`a.status=ANY(${params.add(OPEN_ASSIGNMENT_STATUSES)}::text[])`);
 else if(q.status)where.push(`a.status=${params.add(q.status)}`);
 if(q.incident_id)where.push(`a.incident_id=${params.add(q.incident_id)}`);
 if(q.search){
  const p=params.add(`%${escapeLike(q.search)}%`);
  const parts=[`a.task ILIKE ${p} ESCAPE '\\'`,`u.name ILIKE ${p} ESCAPE '\\'`,`i.type ILIKE ${p} ESCAPE '\\'`,`i.location ILIKE ${p} ESCAPE '\\'`];
  const number=codeNumber(q.search,'asn');
  if(number!==null)parts.push(`a.id=${params.add(number)}`);
  where.push(`(${parts.join(' OR ')})`);
 }
 await sendList(res,{q,select:assignmentSelect,from:assignmentFrom,where,params,order:'a.created_at DESC,a.id DESC'});
}));
app.post('/api/assignments',auth,allow(COORDINATOR),wrap(async(req,res)=>{
 const d=z.object({
  incident_id:id,
  volunteer_id:id,
  task:text(120),
  status:z.string().optional().refine(v=>v===undefined||v==='Notified','New assignments always start as Notified. The volunteer accepts and updates progress from their dashboard.'),
  instructions:optionalText(2000)
 }).parse(req.body);
 const row=await transaction(async client=>{
  const volunteer=(await client.query('SELECT user_id,category,verification,availability FROM volunteers WHERE id=$1 FOR SHARE',[d.volunteer_id])).rows[0];
  const incident=(await client.query('SELECT status,type,location FROM incidents WHERE id=$1 FOR SHARE',[d.incident_id])).rows[0];
  if(!volunteer||!incident)throw new HttpError(400,'Please select a valid incident and volunteer.');
  if(volunteer.category==='Trained'&&volunteer.verification!=='Active - Verified')throw new HttpError(400,'This trained volunteer has not been verified.');
  if(volunteer.availability!=='Available')throw new HttpError(400,'This volunteer is currently unavailable.');
  if(incident.status==='Resolved')throw new HttpError(400,'This emergency report has already been resolved.');
  const duplicate=await client.query('SELECT 1 FROM assignments WHERE incident_id=$1 AND volunteer_id=$2 AND duplicate_of IS NULL AND NOT (status=ANY($3::text[]))',[d.incident_id,d.volunteer_id,INACTIVE_ASSIGNMENT_STATUSES]);
  if(duplicate.rowCount)throw new HttpError(409,'This volunteer is already assigned to this incident.');
  const assignment=(await client.query('INSERT INTO assignments(incident_id,volunteer_id,task,instructions,status) VALUES($1,$2,$3,$4,$5) RETURNING *',[d.incident_id,d.volunteer_id,d.task,d.instructions,'Notified'])).rows[0];
  await notifyUsers(client,[volunteer.user_id],{type:'assignment_created',title:'New assignment',message:`ASN-${assignment.id} · ${assignment.task} for INC-${d.incident_id} (${incident.type}, ${incident.location}). Please accept or decline it.`,link:`/dashboard/assignments?highlight=${assignment.id}`});
  return assignment;
 });
 res.status(201).json(row);
}));
const VOLUNTEER_UPDATE_TITLES={Accepted:'Assignment accepted',Declined:'Assignment declined','In Progress':'Assignment in progress',Completed:'Assignment completed'};
app.patch('/api/assignments/:id',auth,allow(COORDINATOR,USER),wrap(async(req,res)=>{
 const assignmentId=id.parse(req.params.id);
 const d=z.object({status:choice(ASSIGNMENT_STATUSES),reason:z.string().trim().max(200).default('')}).parse(req.body);
 const actor=is(req,COORDINATOR)?'coordinator':'volunteer';
 const row=await transaction(async client=>{
  const current=(await client.query(`SELECT a.*,v.user_id AS volunteer_user_id,u.name AS volunteer_name,i.type AS incident_type,i.location AS incident_location
   FROM assignments a JOIN volunteers v ON v.id=a.volunteer_id JOIN users u ON u.id=v.user_id JOIN incidents i ON i.id=a.incident_id
   WHERE a.id=$1 FOR UPDATE OF a`,[assignmentId])).rows[0];
  if(!current||(actor==='volunteer'&&String(current.volunteer_user_id)!==String(req.user.id)))throw new HttpError(404,'Assignment not found');
  const problem=checkAssignmentTransition(actor,current.status,d.status);
  if(problem)throw new HttpError(problem.status,problem.error);
  let reason='';
  if(d.status==='Cancelled')reason=d.reason?`Cancelled by coordinator: ${d.reason}`:'Cancelled by coordinator';
  if(d.status==='Declined')reason=d.reason?`Declined by volunteer: ${d.reason}`:'Declined by volunteer';
  const updated=(await client.query('UPDATE assignments SET status=$1,status_reason=$2,updated_at=NOW() WHERE id=$3 RETURNING *',[d.status,reason,assignmentId])).rows[0];
  const label=`ASN-${updated.id} (${updated.task}) for INC-${updated.incident_id}`;
  if(actor==='coordinator'){
   await notifyUsers(client,[current.volunteer_user_id],{type:'assignment_cancelled',title:'Assignment cancelled',message:`${label} was cancelled by a coordinator.${d.reason?` Reason: ${d.reason}`:''} No further action is needed.`,link:`/dashboard/assignments?highlight=${updated.id}`});
  }else{
   const verb={Accepted:'accepted',Declined:'declined','In Progress':'started work on',Completed:'completed'}[d.status];
   await notifyRoles(client,[COORDINATOR],{type:`assignment_${d.status.toLowerCase().replace(/\s+/g,'_')}`,title:VOLUNTEER_UPDATE_TITLES[d.status],message:`${req.user.name} ${verb} ${label}.${d.status==='Declined'&&d.reason?` Reason: ${d.reason}`:''}`,link:`/admin/assignments?highlight=${updated.id}`});
  }
  return {...updated,volunteer_name:current.volunteer_name,incident_type:current.incident_type,incident_location:current.incident_location};
 });
 res.json(row);
}));

app.get('/api/resources',auth,allow(COORDINATOR),wrap(async(req,res)=>{
 const q=listParams({priority:choice(RESOURCE_PRIORITY).optional(),incident_id:id.optional()}).parse(req.query);
 const params=sqlParams();const where=[];
 if(q.priority)where.push(`r.priority=${params.add(q.priority)}`);
 if(q.incident_id)where.push(`r.incident_id=${params.add(q.incident_id)}`);
 if(q.search){
  const p=params.add(`%${escapeLike(q.search)}%`);
  const parts=[`r.resource ILIKE ${p} ESCAPE '\\'`,`r.notes ILIKE ${p} ESCAPE '\\'`,`i.type ILIKE ${p} ESCAPE '\\'`,`i.location ILIKE ${p} ESCAPE '\\'`];
  const number=codeNumber(q.search,'inc');
  if(number!==null)parts.push(`r.incident_id=${params.add(number)}`);
  where.push(`(${parts.join(' OR ')})`);
 }
 await sendList(res,{q,select:'SELECT r.*,i.type AS incident_type,i.location AS incident_location,i.status AS incident_status',from:'FROM resources r JOIN incidents i ON i.id=r.incident_id',where,params,order:'r.created_at DESC,r.id DESC'});
}));
app.post('/api/resources',auth,allow(COORDINATOR),wrap(async(req,res)=>{
 const d=z.object({incident_id:id,resource:text(120),quantity:z.coerce.number().int().positive().max(1000000000),priority:choice(RESOURCE_PRIORITY).default('Normal'),notes:optionalText(2000)}).parse(req.body);
 const row=await transaction(async client=>{
  const incident=(await client.query('SELECT status FROM incidents WHERE id=$1 FOR SHARE',[d.incident_id])).rows[0];
  if(!incident)throw new HttpError(400,'Please select a valid incident.');
  if(incident.status==='Resolved')throw new HttpError(400,'This emergency report has already been resolved.');
  return (await client.query('INSERT INTO resources(incident_id,resource,quantity,priority,notes) VALUES($1,$2,$3,$4,$5) RETURNING *',[d.incident_id,d.resource,d.quantity,d.priority,d.notes])).rows[0];
 });
 res.status(201).json(row);
}));

app.get('/api/tickets',auth,allow(COORDINATOR,USER),wrap(async(req,res)=>{
 const q=listParams({status:choice(TICKET_STATUS).optional(),category:choice(TICKET_CATEGORIES).optional()}).parse(req.query);
 const params=sqlParams();const where=[];
 const coordinator=is(req,COORDINATOR);
 if(!coordinator)where.push(`t.user_id=${params.add(req.user.id)}`);
 if(q.status)where.push(`t.status=${params.add(q.status)}`);
 if(q.category)where.push(`t.category=${params.add(q.category)}`);
 if(q.search){
  const p=params.add(`%${escapeLike(q.search)}%`);
  const parts=[`t.subject ILIKE ${p} ESCAPE '\\'`,`t.message ILIKE ${p} ESCAPE '\\'`];
  if(coordinator)parts.push(`u.name ILIKE ${p} ESCAPE '\\'`,`u.email ILIKE ${p} ESCAPE '\\'`);
  const number=codeNumber(q.search,'#?');
  if(number!==null)parts.push(`t.id=${params.add(number)}`);
  where.push(`(${parts.join(' OR ')})`);
 }
 await sendList(res,{q,select:coordinator?'SELECT t.*,u.name,u.email':'SELECT t.*',from:'FROM tickets t JOIN users u ON u.id=t.user_id',where,params,order:'t.created_at DESC,t.id DESC'});
}));
app.post('/api/tickets',auth,allow(USER),wrap(async(req,res)=>{
 const d=z.object({subject:text(180),category:text(80),message:text(5000)}).parse(req.body);
 const row=await transaction(async client=>{
  const ticket=(await client.query('INSERT INTO tickets(user_id,subject,category,message) VALUES($1,$2,$3,$4) RETURNING *',[req.user.id,d.subject,d.category,d.message])).rows[0];
  await notifyRoles(client,[COORDINATOR],{type:'ticket_created',title:'New support ticket',message:`Ticket #${ticket.id} · ${ticket.category}: ${ticket.subject} (from ${req.user.name})`,link:`/admin/tickets?highlight=${ticket.id}`});
  return ticket;
 });
 res.status(201).json(row);
}));
app.patch('/api/tickets/:id',auth,allow(COORDINATOR),wrap(async(req,res)=>{
 const d=z.object({status:choice(TICKET_STATUS).optional(),admin_reply:z.string().trim().max(5000).optional()}).refine(v=>v.status!==undefined||v.admin_reply!==undefined,'Provide a status or a reply').parse(req.body);
 const ticketId=id.parse(req.params.id);
 const row=await transaction(async client=>{
  const before=(await client.query('SELECT status,admin_reply FROM tickets WHERE id=$1 FOR UPDATE',[ticketId])).rows[0];
  if(!before)throw new HttpError(404,'Ticket not found');
  const updated=(await client.query('UPDATE tickets SET status=COALESCE($1,status),admin_reply=COALESCE($2,admin_reply),updated_at=NOW() WHERE id=$3 RETURNING *',[d.status??null,d.admin_reply??null,ticketId])).rows[0];
  const replied=updated.admin_reply!==before.admin_reply&&updated.admin_reply!=='';
  const statusChanged=updated.status!==before.status;
  if(replied||statusChanged){
   const parts=[replied?'An administrator replied':'',statusChanged?`Status changed to ${updated.status}`:''].filter(Boolean);
   await notifyUsers(client,[updated.user_id],{type:'ticket_updated',title:`Support ticket #${updated.id} updated`,message:`${parts.join(' · ')} — ${updated.subject}`,link:`/dashboard/tickets?highlight=${updated.id}`});
  }
  return updated;
 });
 res.json(row);
}));

registerNotificationRoutes(app,{auth,wrap});

app.use('/api',(req,res)=>res.status(404).json({error:'Endpoint not found'}));
const frontendDist=process.env.FRONTEND_DIST||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..','frontend','dist');
if(fs.existsSync(path.join(frontendDist,'index.html'))){
 app.use(express.static(frontendDist,{index:false,maxAge:'1h'}));
 app.get('*',(req,res)=>res.sendFile(path.join(frontendDist,'index.html')));
}
app.use((req,res)=>res.status(404).json({error:'Endpoint not found'}));
app.use((err,req,res,next)=>{
 if(res.headersSent)return next(err);
 if(err instanceof ZodError){const details=err.issues.map(i=>({field:i.path.join('.'),message:i.message}));return res.status(400).json({error:'Invalid input: '+details.map(d=>d.field?`${d.field} - ${d.message}`:d.message).join('; '),details})}
 if(err instanceof HttpError)return res.status(err.status).json({error:err.message});
 if(err.type==='entity.parse.failed')return res.status(400).json({error:'Malformed JSON body'});
 if(err.type==='entity.too.large')return res.status(413).json({error:'Request body too large'});
 const status=err.status||err.statusCode;
 if(status>=400&&status<500)return res.status(status).json({error:err.expose&&err.message?err.message:'Bad request'});
 if(isConnectionError(err)){console.error('Database unavailable:',describeConnectionError(err));return res.status(503).json({error:'The database is temporarily unavailable. Please try again shortly.'})}
 if(err.code==='23503')return res.status(400).json({error:'Referenced record does not exist'});
 if(err.code==='23505')return res.status(409).json({error:'Record already exists'});
 if(err.code==='22003'||err.code==='22P02')return res.status(400).json({error:'Invalid value'});
 console.error(err);res.status(500).json({error:'Internal server error'});
});
const port=Number(process.env.PORT||5000);
const server=app.listen(port,()=>{
 console.log(`RESQCONNECT API listening on ${port}`);
 query('SELECT 1').then(()=>console.log('PostgreSQL connection OK')).catch(e=>console.error(`PostgreSQL is not reachable yet: ${describeConnectionError(e)}`));
});
const shutdown=signal=>{console.log(`${signal} received, shutting down`);server.close(()=>pool.end().finally(()=>process.exit(0)));setTimeout(()=>process.exit(1),10000).unref()};
process.on('SIGINT',()=>shutdown('SIGINT'));
process.on('SIGTERM',()=>shutdown('SIGTERM'));
