import {useCallback,useEffect,useState} from 'react';
import {api} from '../api';
export const EMPTY_PAGE={data:[],pagination:{page:1,pageSize:20,total:0,totalPages:1}};
export function useData(path,initial=[]){
 const [data,setData]=useState(initial);
 const [loading,setLoading]=useState(Boolean(path));
 const [error,setError]=useState('');
 const [version,setVersion]=useState(0);
 useEffect(()=>{
  if(!path){setLoading(false);return}
  let active=true;
  setLoading(true);
  api(path)
   .then(d=>{if(active){setData(d);setError('')}})
   .catch(e=>{if(active)setError(e.message)})
   .finally(()=>{if(active)setLoading(false)});
  return ()=>{active=false};
 },[path,version]);
 const reload=useCallback(()=>setVersion(v=>v+1),[]);
 return {data,loading,error,reload};
}
export function usePagedData(basePath,filters={},pageSize=20){
 const params=new URLSearchParams();
 for(const [key,value] of Object.entries(filters))if(value!==undefined&&value!==null&&value!=='')params.set(key,String(value));
 params.set('pageSize',String(pageSize));
 const key=`${basePath}?${params}`;
 const [state,setState]=useState({key,page:1});
 const page=state.key===key?state.page:1;
 params.set('page',String(page));
 const result=useData(basePath?`${basePath}?${params}`:null,{...EMPTY_PAGE,pagination:{...EMPTY_PAGE.pagination,pageSize}});
 const rows=Array.isArray(result.data?.data)?result.data.data:[];
 const pagination=result.data?.pagination||{...EMPTY_PAGE.pagination,pageSize};
 const setPage=useCallback(next=>setState(current=>{
  const base=current.key===key?current.page:1;
  return {key,page:Math.max(1,typeof next==='function'?next(base):next)};
 }),[key]);
 return {...result,rows,pagination,page,setPage};
}
