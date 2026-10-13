import React,{useEffect,useRef,useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {FiBell,FiCheck,FiInbox} from 'react-icons/fi';
import {useNotifications} from '../lib/useNotifications';
function timeAgo(value){
 const date=new Date(value);
 const seconds=Math.max(0,Math.round((Date.now()-date.getTime())/1000));
 if(seconds<45)return 'Just now';
 const minutes=Math.round(seconds/60);
 if(minutes<60)return `${minutes} min ago`;
 const hours=Math.round(minutes/60);
 if(hours<24)return `${hours} h ago`;
 const days=Math.round(hours/24);
 if(days<7)return `${days} d ago`;
 return date.toLocaleDateString('en-IN');
}
export default function NotificationBell(){
 const [open,setOpen]=useState(false);
 const [actionError,setActionError]=useState('');
 const wrapper=useRef(null);
 const button=useRef(null);
 const navigate=useNavigate();
 const {unread,items,loading,loaded,error,busy,loadList,markRead,markAllRead}=useNotifications(open);
 useEffect(()=>{
  if(!open)return undefined;
  const onKey=event=>{if(event.key==='Escape'){setOpen(false);button.current?.focus()}};
  const onPointer=event=>{if(wrapper.current&&!wrapper.current.contains(event.target))setOpen(false)};
  document.addEventListener('keydown',onKey);
  document.addEventListener('pointerdown',onPointer);
  return ()=>{document.removeEventListener('keydown',onKey);document.removeEventListener('pointerdown',onPointer)};
 },[open]);
 async function openNotification(n){
  setActionError('');
  if(!n.is_read){try{await markRead(n.id)}catch(e){setActionError(e.message)}}
  setOpen(false);
  if(n.link)navigate(n.link);
 }
 async function markOne(event,id){
  event.stopPropagation();
  setActionError('');
  try{await markRead(id)}catch(e){setActionError(e.message)}
 }
 const label=unread?`Notifications, ${unread} unread`:'Notifications';
 let body;
 if(loading&&!loaded)body=<div className="notif-state" role="status">Loading notifications...</div>;
 else if(error&&!items.length)body=<div className="notif-state" role="alert">{error}<button className="btn btn-secondary notif-retry" type="button" onClick={loadList}>Try Again</button></div>;
 else if(!items.length)body=<div className="notif-state"><FiInbox className="notif-empty-icon" aria-hidden="true"/>You have no notifications yet. Updates about reports, volunteers, assignments and tickets will appear here.</div>;
 else body=<ul className="notif-list">{items.map(n=><li key={n.id} className={n.is_read?'notif-item':'notif-item unread'}>
  <button type="button" className="notif-main" onClick={()=>openNotification(n)}>
   <span className="notif-dot" aria-hidden="true"></span>
   <span className="notif-title">{n.title}<span className="sr-only">{n.is_read?' (read)':' (unread)'}</span></span>
   <span className="notif-msg">{n.message}</span>
   <time className="notif-time" dateTime={n.created_at} title={new Date(n.created_at).toLocaleString('en-IN')}>{timeAgo(n.created_at)}</time>
  </button>
  {!n.is_read&&<button type="button" className="notif-mark" title="Mark as read" aria-label={`Mark "${n.title}" as read`} onClick={event=>markOne(event,n.id)}><FiCheck aria-hidden="true"/></button>}
 </li>)}</ul>;
 return <div className="notif" ref={wrapper}>
  <button ref={button} type="button" className="notif-bell" aria-label={label} aria-haspopup="true" aria-expanded={open} aria-controls="notification-panel" onClick={()=>setOpen(value=>!value)}>
   <FiBell aria-hidden="true"/>
   {unread>0&&<span className="notif-badge" aria-hidden="true">{unread>99?'99+':unread}</span>}
  </button>
  {open&&<div id="notification-panel" className="notif-panel" role="dialog" aria-label="Notifications">
   <div className="notif-head">
    <strong>Notifications</strong>
    <button type="button" className="notif-link" disabled={!unread||busy} onClick={markAllRead}>{busy?'Marking...':'Mark all as read'}</button>
   </div>
   {(actionError||(error&&items.length>0))&&<div className="notif-error" role="alert">{actionError||error}</div>}
   <div className="notif-body">{body}</div>
  </div>}
 </div>;
}
