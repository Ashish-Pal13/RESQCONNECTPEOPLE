import {useCallback,useEffect,useRef,useState} from 'react';
import {api} from '../api';
export const NOTIFICATION_POLL_MS=15000;
export function useNotifications(open){
 const [unread,setUnread]=useState(0);
 const [items,setItems]=useState([]);
 const [loading,setLoading]=useState(false);
 const [loaded,setLoaded]=useState(false);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const lastCount=useRef(null);
 const openRef=useRef(open);
 openRef.current=open;
 const loadList=useCallback(async()=>{
  setLoading(true);setError('');
  try{const d=await api('/notifications?limit=20');setItems(d.data);setUnread(d.unread_count);lastCount.current=d.unread_count;setLoaded(true)}
  catch(e){setError(e.message)}
  finally{setLoading(false)}
 },[]);
 const refreshCount=useCallback(async()=>{
  try{
   const d=await api('/notifications/unread-count');
   const changed=lastCount.current!==null&&d.unread_count!==lastCount.current;
   lastCount.current=d.unread_count;
   setUnread(d.unread_count);
   if(changed&&openRef.current)loadList();
   else if(changed)setLoaded(false);
  }catch{}
 },[loadList]);
 useEffect(()=>{
  refreshCount();
  const timer=setInterval(()=>{if(!document.hidden)refreshCount()},NOTIFICATION_POLL_MS);
  const onVisible=()=>{if(!document.hidden)refreshCount()};
  document.addEventListener('visibilitychange',onVisible);
  window.addEventListener('focus',onVisible);
  return ()=>{clearInterval(timer);document.removeEventListener('visibilitychange',onVisible);window.removeEventListener('focus',onVisible)};
 },[refreshCount]);
 useEffect(()=>{if(open&&!loading)loadList()},[open]);
 const markRead=useCallback(async id=>{
  const d=await api(`/notifications/${id}/read`,{method:'PATCH'});
  setItems(list=>list.map(n=>n.id===id?d.data:n));
  setUnread(d.unread_count);lastCount.current=d.unread_count;
 },[]);
 const markAllRead=useCallback(async()=>{
  setBusy(true);setError('');
  try{await api('/notifications/read-all',{method:'PATCH'});setItems(list=>list.map(n=>n.is_read?n:{...n,is_read:true,read_at:new Date().toISOString()}));setUnread(0);lastCount.current=0}
  catch(e){setError(e.message)}
  finally{setBusy(false)}
 },[]);
 return {unread,items,loading,loaded,error,busy,loadList,markRead,markAllRead};
}
