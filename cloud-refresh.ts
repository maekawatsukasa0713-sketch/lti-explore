export type RecordRow={kind:string;id:string;owner_id:string;data:any;version:number};
export type RefreshScope={type:'full'}|{type:'kinds';kinds:readonly string[]};
export type RefreshOutcome={status:'applied'}|{status:'invalidated'}|{status:'failed';error:unknown};
export type RefreshJob={scope:RefreshScope;epoch:number;revision:number;isCurrent:()=>boolean};
type Waiter=(result:RefreshOutcome)=>void;
type Batch={scope:RefreshScope;epoch:number;revision:number;waiters:Waiter[]};
const full:RefreshScope={type:'full'};
const union=(a:RefreshScope,b:RefreshScope):RefreshScope=>a.type==='full'||b.type==='full'?full:{type:'kinds',kinds:[...new Set([...a.kinds,...b.kinds])].sort()};
const covers=(a:RefreshScope,b:RefreshScope)=>a.type==='full'||b.type==='kinds'&&b.kinds.every(k=>a.kinds.includes(k));

// One active read and one unioned trailing read per identity. A read started
// before a write acknowledgement cannot satisfy that write's refresh barrier.
export function createRefreshCoordinator(run:(job:RefreshJob)=>Promise<'applied'|'invalidated'>) {
 let epoch=0,revision=0,active:Batch|null=null,pending:Batch|null=null;
 const settle=(batch:Batch,result:RefreshOutcome)=>{for(const waiter of batch.waiters.splice(0))waiter(result);};
 const start=(batch:Batch)=>{
  batch.revision=revision;active=batch;
  const job:RefreshJob={scope:batch.scope,epoch:batch.epoch,revision:batch.revision,isCurrent:()=>epoch===batch.epoch&&revision===batch.revision&&active===batch};
  void (async()=>{
   let outcome:RefreshOutcome;
   try{const result=await run(job);outcome=job.isCurrent()?{status:result}:{status:'invalidated'};}
   catch(error){outcome=job.isCurrent()?{status:'failed',error}:{status:'invalidated'};}
   settle(batch,outcome);
   if(active!==batch)return;
   active=null;
   if(pending){const next=pending;pending=null;start(next);}
  })();
 };
 return {
  get epoch(){return epoch;},
  isCurrent:(expected:number)=>expected===epoch,
  invalidate(){
   epoch++;revision=0;
   if(active)settle(active,{status:'invalidated'});
   if(pending)settle(pending,{status:'invalidated'});
   // Old HTTP reads finish naturally; their job guard prevents any late apply.
   active=null;pending=null;
   return epoch;
  },
  committed(expected:number){if(expected!==epoch)return null;return ++revision;},
  request(scope:RefreshScope,options:{epoch?:number;minimumRevision?:number;fresh?:boolean}={}):Promise<RefreshOutcome>{
   const expected=options.epoch??epoch,minimum=options.minimumRevision??revision;
   if(expected!==epoch)return Promise.resolve({status:'invalidated'});
   return new Promise(resolve=>{
    if(active&&!options.fresh&&active.epoch===expected&&active.revision>=minimum&&covers(active.scope,scope)){active.waiters.push(resolve);return;}
    if(active){
     if(pending){pending.scope=union(pending.scope,scope);pending.waiters.push(resolve);}
     else pending={scope,epoch:expected,revision:minimum,waiters:[resolve]};
    }else start({scope,epoch:expected,revision:minimum,waiters:[resolve]});
   });
  }
 };
}

export function savedRecordScope(ops:readonly {kind:string}[]):RefreshScope {
 const kinds=new Set<string>();
 for(const op of ops){
  const family=['assignments','submissions','feedback'].includes(op.kind)?['assignments','submissions','feedback']:['papers','paper_threads'].includes(op.kind)?['papers','paper_threads']:[op.kind];
  for(const kind of family)kinds.add(kind);
 }
 return {type:'kinds',kinds:[...kinds].sort()};
}

// A full snapshot and paper reads include globally visible records. Only add
// the generated-column predicate when every requested family is school-bound;
// RLS still decides which rows the caller may read inside that school.
const schoolBoundKinds=new Set(['assignments','submissions','feedback','materials','paper_threads']);
export function recordSchoolFilter(scope:RefreshScope,profile:{role:string;school_id:string|null}):string|null {
 return scope.type==='kinds'&&scope.kinds.length>0&&profile.role!=='admin'&&profile.school_id&&scope.kinds.every(kind=>schoolBoundKinds.has(kind))?profile.school_id:null;
}

export function mergeRecordRows(previous:readonly RecordRow[],fresh:RecordRow[],scope:RefreshScope):RecordRow[] {
 if(scope.type==='full')return fresh;
 const replaced=new Set(scope.kinds);
 return [...previous.filter(r=>!replaced.has(r.kind)),...fresh].sort((a,b)=>a.kind<b.kind?-1:a.kind>b.kind?1:a.id<b.id?-1:a.id>b.id?1:0);
}

// These fields affect RLS or the account/feature gates. Metadata-only changes
// such as a display name do not require downloading every unrelated record.
export function recordPermissionKey(profile:{id:string;role:string;school_id:string|null;active:boolean;must_change_password?:boolean;initial_password_expires_at?:string|null;session_valid_after?:string;deleted_at?:string|null},schools:readonly {id:string;deleted_at?:string|null;feature_settings?:unknown}[],aal:string|null,nextAal:string|null) {
 const school=schools.find(s=>s.id===profile.school_id);
 return JSON.stringify([profile.id,profile.role,profile.school_id,profile.active,profile.must_change_password,profile.initial_password_expires_at,profile.session_valid_after,profile.deleted_at,school?{id:school.id,deleted_at:school.deleted_at,feature_settings:school.feature_settings}:null,aal,nextAal]);
}
