from pathlib import Path
import json,sqlite3,base64,hashlib,sys,copy
root=Path(sys.argv[1]);backend=sys.argv[2];fault=sys.argv[3];source=json.loads((root/'original.json').read_text())['state'];hire=next(iter(source['world']['reservations'].values()));rep=next(iter(source['world']['external']['representatives'].values()));target=rep if fault.startswith('rep-') else hire;ids=target['identities'];entity=source['entities'][ids['entityId']];binding=ids['binding'];teamId=binding['teamId'];native=root/'simulation'/hashlib.sha256(source['spec']['runId'].encode()).hexdigest();changed=[]
def log(stream,nativeLog=False):
 if backend=='json':
  folder=native/'journal'/'logs' if nativeLog else root/'team-json'/'logs';p=folder/(base64.urlsafe_b64encode(stream.encode()).decode().rstrip('=')+'.json');d=json.loads(p.read_text());return p,d
 dbpath=native/'journal.sqlite' if nativeLog else root/'team.sqlite';db=sqlite3.connect(dbpath);rows=db.execute('SELECT sequence,value FROM log_entries WHERE stream=? ORDER BY sequence',(stream,)).fetchall();db.close();return dbpath,{'stream':{'name':stream},'entries':[{'sequence':n,'value':json.loads(v)} for n,v in rows]}
def save(p,d,nativeLog=False):
 stream=d['stream']['name']
 if backend=='json':
  d.pop('checkpoint',None);d['stream'].pop('summary',None);d['stream']['tailSequence']=d['entries'][-1]['sequence'];p.write_text(json.dumps(d,separators=(',',':'))+'\n')
 else:
  db=sqlite3.connect(p)
  with db:
   for e in d['entries']:db.execute('INSERT OR REPLACE INTO log_entries(stream,sequence,value) VALUES (?,?,?)',(stream,e['sequence'],json.dumps(e['value'],separators=(',',':'))))
   db.execute('UPDATE log_streams SET tail_sequence=? WHERE name=?',(d['entries'][-1]['sequence'],stream))
   tables={x[0] for x in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
   if 'log_checkpoints' in tables:db.execute('DELETE FROM log_checkpoints WHERE stream=?',(stream,))
   cols={x[1] for x in db.execute('PRAGMA table_info(log_streams)')}
   if 'summary' in cols:db.execute('UPDATE log_streams SET summary=NULL WHERE name=?',(stream,))
  db.close()
 changed.append({'path':str(p),'stream':stream})
if fault=='none':pass
elif fault.endswith('session-missing') or fault.endswith('session-binding'):
 p=next((root/'sessions').glob('*/'+binding['sessionId']+'/session.jsonl'))
 if fault.endswith('session-missing'):p.unlink()
 else:
  lines=p.read_text().splitlines();h=json.loads(lines[0]);h['participantId']=source['entities']['director']['binding']['participantId'];lines[0]=json.dumps(h,separators=(',',':'));p.write_text('\n'.join(lines)+'\n')
 changed.append({'path':str(p),'sessionId':binding['sessionId']})
elif fault.endswith('participant-missing') or fault.endswith('participant-descriptor'):
 p,d=log('team/'+teamId);count=0
 for e in d['entries']:
  v=e['value']
  if v.get('type')=='participant/changed' and v.get('participant',{}).get('id')==binding['participantId']:
   if fault.endswith('participant-descriptor'):v['participant']['displayName']='Forged durable descriptor'
   else:v['participant']['id']=binding['participantId']+'-missing'
   count+=1
 assert count>0;save(p,d)
elif fault.endswith('channel-endpoint'):
 channelId=ids['channels'][0]['channelId'];p,d=log('channel/'+channelId);count=0
 for e in d['entries']:
  inv=e['value'].get('invitation')
  if inv and inv['participantId']==binding['participantId']:
   inv['endpoint']['sessionId']=source['entities']['director']['binding']['sessionId'];count+=1
 assert count>0;save(p,d)
elif fault.endswith('channel-missing'):
 channelId=ids['channels'][0]['channelId'];p,d=log('channel/'+channelId)
 if backend=='json':p.unlink()
 else:
  db=sqlite3.connect(p)
  with db:
   for table,column in [('log_entries','stream'),('log_checkpoints','stream'),('log_streams','name')]:db.execute('DELETE FROM '+table+' WHERE '+column+'=?',('channel/'+channelId,))
  db.close()
 changed.append({'path':str(p),'stream':'channel/'+channelId})
elif fault.endswith('persona'):
 p,d=log('simulation',True);profile=copy.deepcopy(entity['profile']);profile['persona']['traits']=['Forged durable Persona']
 sequence=d['entries'][-1]['sequence']+1;d['entries'].append({'sequence':sequence,'value':{'kind':'run/change','runId':source['spec']['runId'],
  'expectedRevision':sequence-1,'command':{'kind':'entity/profile','id':entity['id'],'entityRevision':entity['revision'],'profile':profile}}});save(p,d,True)
elif fault=='implementation-generation':
 p,d=log('simulation',True);count=[0]
 def replace_pin(value):
  if isinstance(value,dict):
   if {'domain','operation','version','schemaRef','implementationRef','generation'}<=set(value) and value['domain']=='organization' and value['operation']=='generate-and-hire':
    value['generation']=2;count[0]+=1
   for child in value.values():replace_pin(child)
  elif isinstance(value,list):
   for child in value:replace_pin(child)
 replace_pin(d['entries']);assert count[0]>0;save(p,d,True)
elif fault=='receipt-envelope':
 op=next(v for v in source['operations'].values() if v.get('outbox',{}).get('receipt',{}).get('channelId')==hire['identities']['channels'][0]['channelId'])
 receipt=op['outbox']['receipt'];p,d=log('channel/'+receipt['channelId']);e=next(e for e in d['entries'] if e['sequence']==receipt['sequence']);assert e['value']['type']=='channel/envelope';e['value']['envelope']['payload']['content']=[{'type':'text','text':'Forged retained Envelope'}];save(p,d)
else:raise ValueError(fault)
(root/'fault-mutation.json').write_text(json.dumps({'fault':fault,'backend':backend,'binding':binding,'changes':changed,'initialCheckpoint':'complete-world-initial',
 'targetAbsentFromInitialSessions':not any(r['sessionId']==binding['sessionId'] for r in source['checkpoints']['complete-world-initial']['manifest']['sessions'])},indent=2)+'\n')
