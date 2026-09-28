from pathlib import Path
import re, subprocess

# Machine-facing declarations remain literal in both locales; retain current translated prose.
def parts(text):
 matches=list(re.finditer(r'^## `([^`]+)`\s*$',text,re.M))
 if not matches: raise ValueError('No package sections')
 return text[:matches[0].start()], {m.group(1):text[m.start():matches[i+1].start() if i+1<len(matches) else len(text)] for i,m in enumerate(matches)}
def code(text):return re.findall(r'^```[^\n]*\n.*?^```',text,re.M|re.S)
for name in ['config-catalog','tool-catalog']:
 en=Path(f'docs/{name}.md');zh=Path(f'docs/{name}.zh.md')
 eh,es=parts(en.read_text());zhh,zs=parts(zh.read_text());_,old=parts(subprocess.check_output(['git','show',f'HEAD:{en}'],text=True))
 body=[]
 for key,section in es.items():
  prior=zs.get(key)
  if prior is not None and old.get(key)==section and code(section)==code(prior) and len(re.findall(r'^### ',section,re.M))==len(re.findall(r'^### ',prior,re.M)):
   body.append(prior)
  else:
   # Parameter descriptions are the English strings actually offered to the model.
   body.append(section)
 if name=='tool-catalog':
  eh_lines=eh.splitlines();zhlines=zhh.splitlines()
  erows=[l for l in eh_lines if l.startswith('|')];zrows={l.split('|')[1].strip():l for l in zhlines if l.startswith('|') and len(l.split('|'))>2}
  oldrows={l.split('|')[1].strip():l for l in subprocess.check_output(['git','show',f'HEAD:{en}'],text=True).splitlines() if l.startswith('|') and len(l.split('|'))>2}
  table=[]
  for row in erows:
   key=row.split('|')[1].strip()
   table.append(zrows.get(key,row) if oldrows.get(key)==row else row)
  first=next(i for i,l in enumerate(zhlines) if l.startswith('|'))
  last=max(i for i,l in enumerate(zhlines) if l.startswith('|'))
  zhh='\n'.join(zhlines[:first]+table+zhlines[last+1:]).rstrip()+'\n\n'
 marker='接口声明、模型实际接收的工具描述、JSON Schema 和示例按源码保留英文；各包的中文说明见对应 README。\n\n'
 if marker not in zhh: zhh+=marker
 zh.write_text(zhh+''.join(body))
