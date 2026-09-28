from pathlib import Path
import subprocess,re
root=Path('/Volumes/projects-mac/deepseek-harness');base=root/'.tmp/team-audit-baseline'
owned_roots=['packages/core/team-link','packages/team/team-agent-client','packages/team/team-scheduler-dag','packages/team/tool-team-task','packages/team/tool-team','packages/team/team-link-websocket','packages/team/team-workspace-shared','examples/headless-agent']
files=subprocess.check_output(['git','diff','--name-only','--',*owned_roots],cwd=root,text=True).splitlines()
# Copy implementation and tests; audit only the shared files through selected original-line hunks.
for rel in files:
 if Path(rel).suffix not in ['.ts','.yml','.json']:continue
 if rel.endswith('.i18n.yaml'):continue
 source=root/rel;dest=base/rel;dest.parent.mkdir(parents=True,exist_ok=True)
 if source.exists():dest.write_bytes(source.read_bytes())
for rel in ['packages/team/tool-team-task/src/workflow-schema.ts','packages/team/team-run/src/error.ts','examples/headless-agent/tests/snapshots/review-projection/rework-reassigned.expected.json']:
 dest=base/rel;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes((root/rel).read_bytes())

def apply_selected(rel,predicate):
 original=subprocess.check_output(['git','show',f'HEAD:{rel}'],cwd=root,text=True).splitlines()
 diff=subprocess.check_output(['git','diff','--unified=0','--',rel],cwd=root,text=True)
 hunks=[]
 for block in re.split(r'(?m)(?=^@@ )',diff)[1:]:
  header,*ls=block.splitlines();m=re.match(r'@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@',header)
  start=int(m[1]);count=int(m[2] or '1')
  removed=[l[1:] for l in ls if l.startswith('-')];added=[l[1:] for l in ls if l.startswith('+')]
  if predicate(start,block):hunks.append((start,count,removed,added))
 for start,count,removed,added in reversed(hunks):
  at=start if count==0 else start-1
  assert original[at:at+count]==removed,(rel,start)
  original[at:at+count]=added
 (base/rel).write_text('\n'.join(original)+'\n')
 print(rel,len(hunks))
apply_selected('packages/team/team-hub/src/index.ts',lambda line,block: line==26 or 8060<=line<=8140)
apply_selected('packages/team/team-run/src/index.ts',lambda line,block: not any(word in block for word in ['maxChildTeams', 'maxLiveActivations', 'team-placement-default', 'needsActivation', 'prepareRoles']))
apply_selected('packages/team/tool-team-task/src/index.ts',lambda line,block: line!=430)
for rel in ['packages/bundle/headless/cordis.patch.yml','packages/bundle/web-app/cordis.patch.yml']:
 apply_selected(rel,lambda line,block:'observationExcludedRoots' in block)
rel='packages/team/team-run/tests/team-run.spec.ts';s=subprocess.check_output(['git','show',f'HEAD:{rel}'],cwd=root,text=True)
s=s.replace('await ctx.plugin(TeamAgentClient, { reconnectDelayMs: 1, disposalTimeoutMs: 100 })','await ctx.plugin(TeamAgentClient, { reconnectDelayMs: 1, disposalTimeoutMs: 100, maxTaskReportReminders: 0 })')
(base/rel).write_text(s)
