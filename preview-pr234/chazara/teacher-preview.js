function enableTeacherPreview(){
  teacherPreview=true;
  const liveDb=db, records={}, audio=new Map();
  let nextId=0;
  const read=path=>path.split('/').reduce((value,key)=>value?.[key],records)??null;
  const write=(path,value)=>{
    const keys=path.split('/'),last=keys.pop();let parent=records;
    for(const key of keys)parent=parent[key]??={};
    if(value===null)delete parent[last];else parent[last]=value;
  };
  const ref=path=>({
    key:path.split('/').pop(),
    child:key=>ref(path+'/'+key),
    push:()=>ref(path+'/preview_'+(++nextId)),
    set:async value=>write(path,value),
    update:async values=>{for(const [key,value] of Object.entries(values))write(path+'/'+key,value);},
    remove:async()=>write(path,null),
    once:async()=>({val:()=>read(path),exists:()=>read(path)!==null}),
    transaction:async fn=>{write(path,fn(read(path)));},
    on:(event,cb)=>cb({val:()=>read(path),exists:()=>read(path)!==null})
  });
  db={ref:path=>{
    return ref(path);
    const live=liveDb.ref(path);
    return {once:(...args)=>live.once(...args),on:(...args)=>live.on(...args),
      set:async value=>write(path,value),update:async values=>ref(path).update(values),remove:async()=>write(path,null)};
  }};
  const audioRef=path=>({
    put:async blob=>{if(audio.has(path))URL.revokeObjectURL(audio.get(path));audio.set(path,URL.createObjectURL(blob));},
    getDownloadURL:async()=>audio.get(path),
    delete:async()=>{if(audio.has(path))URL.revokeObjectURL(audio.get(path));audio.delete(path);}
  });
  storage={ref:audioRef,refFromURL:url=>({delete:async()=>{
    for(const [path,value] of audio)if(value===url)await audioRef(path).delete();
  }})};
}

