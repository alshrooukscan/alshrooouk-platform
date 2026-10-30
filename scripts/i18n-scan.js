const B=require('path').join(process.cwd(),'node_modules/next/dist/compiled/babel/');
const parser=require(B+'parser.js'); const traverse=require(B+'traverse.js').default||require(B+'traverse.js');
const fs=require('fs'),path=require('path');
const root=process.argv[2]; const out=process.argv[3];
function walk(d,a=[]){for(const f of fs.readdirSync(d)){const p=path.join(d,f);fs.statSync(p).isDirectory()?walk(p,a):p.endsWith('.js')&&a.push(p)}return a}
const files=['app','components','lib'].flatMap(d=>walk(path.join(root,d)));
const ATTR=new Set(['placeholder','title','label','alt','aria-label','helperText','confirmText','emptyText','hint','subtitle','heading']);
const PROPKEY=new Set(['label','title','placeholder','header','heading','text','hint','desc','description','subtitle','kicker','message','empty','emptyText','tooltip','name_en','caption','cta','help']);
const SETTERS=/^(set(Error|Err|Msg|Message|Notice|Toast|Status|Info|Warning|Success|Feedback|Result|Banner|Note|Flash|Saved|Alert|Problem|Hint)\w*|showToast|toast|notify|flash)$/;
const NONUI_CALLEE=new Set(['from','select','eq','neq','in','order','is','or','ilike','like','gte','lte','gt','lt','match','not','filter','contains','rpc','storage','bucket','channel','on','get','set','has','append','headers','getItem','setItem','removeItem','querySelector','getElementById','addEventListener','push','replace','includes','startsWith','endsWith','split','join','indexOf','test','padStart','toLocaleString','toLocaleDateString','toLocaleTimeString','toISOString','fetch','require','log','warn','error','info','debug','redirect','json','text','cookies','localeCompare','slice','match','matchAll','searchParams','createElement','setAttribute','Error','sort','writeFile','book_append_sheet','json_to_sheet','upsert','insert','update','delete','single','maybeSingle','limit','range','abortSignal','throwOnError']);
const isUI=s=>{s=s.trim(); if(!/[A-Za-z]/.test(s))return false; if(/^(https?:|\/|#|\.|[a-z0-9_.\-]+$)/.test(s))return false; if(/^[A-Z0-9_]+$/.test(s)&&s.length<4)return false; if(/^(\d|[a-z]+\()/.test(s))return false; if(/[{};]|^[a-z-]+:/.test(s))return false; return true;};
const res={};
for(const f of files){
  const rel=path.relative(root,f); const src=fs.readFileSync(f,'utf8');
  let ast; try{ast=parser.parse(src,{sourceType:'module',plugins:['jsx']})}catch(e){console.error('PARSE',rel,e.message);continue}
  const c={labelMap:0,jsxText:0,attr:0,jsxExprStr:0,propLabel:0,dialog:0,setter:0,apiError:0,throwErr:0,uniq:new Set()};
  const add=(k,s)=>{c[k]++; if(process.env.DUMPK===k && Math.random()<0.04) console.log(k,'|',s.trim().slice(0,70));c.uniq.add(s.trim().replace(/\s+/g,' '))};
  const isApi=rel.startsWith('app/api/');
  const strOf=n=>n.type==='StringLiteral'?n.value:n.type==='TemplateLiteral'?n.quasis.map(q=>q.value.cooked).join('{x}'):null;
  traverse(ast,{
    JSXText(p){const t=p.node.value; if(/[A-Za-z]{2,}/.test(t)) add('jsxText',t)},
    JSXAttribute(p){const n=p.node.name.name; const v=p.node.value; if(!v)return;
      let s=v.type==='StringLiteral'?v.value:(v.type==='JSXExpressionContainer'?strOf(v.expression):null);
      if(s&&ATTR.has(n)&&isUI(s)) add('attr',s)},
    'StringLiteral|TemplateLiteral'(p){
      const s=strOf(p.node); if(s==null||!isUI(s))return;
      if(p.parentPath.isJSXAttribute())return;
      // dialogs
      const call=p.parentPath.isCallExpression()?p.parentPath.node:null;
      if(call&&p.listKey==='arguments'){
        const cal=call.callee; const nm=cal.type==='Identifier'?cal.name:(cal.property&&cal.property.name);
        if(['alert','confirm','prompt'].includes(nm)){add('dialog',s);return}
        if(nm&&SETTERS.test(nm)){add('setter',s);return}
        if(nm&&NONUI_CALLEE.has(nm))return;
      }
      if(p.parentPath.isNewExpression()&&p.parentPath.node.callee.name==='Error'){add('throwErr',s);return}
      // object property value
      if(p.parentPath.isObjectProperty()&&p.key==='value'){
        const k=p.parentPath.node.key; const kn=k.name||k.value;
        if(kn==='error'||kn==='message'||kn==='warning'||kn==='hint'){ if(isApi){add('apiError',s);return} }
        if(PROPKEY.has(kn)){add('propLabel',s);return}
        if(kn==='style'||kn==='className')return;
        const decl=p.findParent(q=>q.isVariableDeclarator()); if(decl&&decl.node.id&&/LABEL|TEXT|NAME|TITLE|COPY|STATUS|METHOD|KIND|TYPE/i.test(decl.node.id.name||'')&&/^[A-Z]|\s/.test(s.trim())){add('labelMap',s);return}
      }
      // inside JSX expression container ( {x ? "A b" : "C"} )
      if(!isApi && p.findParent(q=>q.isJSXExpressionContainer()) && !p.findParent(q=>q.isJSXAttribute()&&['style','className','key','href','src','type','name','id','value','target','rel','method','accept','autoComplete','inputMode'].includes(q.node.name.name)) && /\s|^[A-Z]/.test(s.trim()) && !p.findParent(q=>q.isObjectProperty()&&['style'].includes(q.node.key.name))){add('jsxExprStr',s);return}
    }
  });
  res[rel]=Object.assign({},c,{uniq:c.uniq.size,list:[...c.uniq]}); if(process.env.DUMP===rel) console.log(JSON.stringify([...c.uniq].slice(0,400)));
}
fs.writeFileSync(out,JSON.stringify(res,null,1));
