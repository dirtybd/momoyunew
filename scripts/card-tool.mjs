import {createServer} from 'node:http';
import {makeCardArtifact} from '../server/card-design.mjs';
import {createAgentCatalog} from '../server/agent-catalog.mjs';

const key=process.env.CARD_TOOL_SECRET;
if(!key||key.length<32){console.error('CARD_TOOL_SECRET 需要至少32字符，卡片制作工具未启动。');process.exit(1);}
const catalog=createAgentCatalog({dataDir:process.env.DATA_DIR||'./data'});
catalog.start();
const server=createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  try{
    if(req.method==='GET'&&req.url==='/health')return res.end(JSON.stringify({ok:true,tool:'design_card',agents:catalog.status()}));
    if(req.method!=='POST'||!['/design-card','/match-preview','/recommend-agents'].includes(req.url)){res.statusCode=404;return res.end('{}');}
    if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw Object.assign(new Error('需要 JSON 请求'),{status:415});
    let raw='',size=0;for await(const chunk of req){size+=chunk.length;if(size>64000)throw Object.assign(new Error('设计内容过长'),{status:413});raw+=chunk;}
    const body=JSON.parse(raw);
    if(req.url==='/recommend-agents'){
      const query=typeof body.query==='string'?body.query.trim():'';
      if(!query||query.length>2000)throw Object.assign(new Error('请提供要检索的需求描述'),{status:400});
      if(!catalog.status().count)await catalog.refresh().catch(()=>{});
      const limit=Number.isInteger(body.limit)?Math.max(1,Math.min(5,body.limit)):3;
      const agents=catalog.recommend(query,{limit});
      const markdown=agents.length?agents.map((item,index)=>`${index+1}. [${item.name}](${item.url}) — ${item.description}`).join('\n'):'';
      return res.end(JSON.stringify({query,count:agents.length,agents,markdown}));
    }
    if(req.url==='/match-preview'){
      const r=await fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/internal/match-preview',{method:'POST',redirect:'error',signal:AbortSignal.timeout(180000),headers:{'Content-Type':'application/json'},body:JSON.stringify({match_token:body.match_token,card_json:body.card_json})});
      res.statusCode=r.status;return res.end(await r.text());
    }
    const design=typeof body.design_json==='string'?JSON.parse(body.design_json):body.design_json;
    res.end(JSON.stringify(makeCardArtifact(design,body.job_token,key)));
  }catch(e){res.statusCode=e.status||400;res.end(JSON.stringify({error:e.message}));}
});
server.requestTimeout=15000;
server.listen(Number(process.env.CARD_TOOL_PORT||8792),process.env.CARD_TOOL_HOST||'0.0.0.0',()=>console.log('momoyu card tool listening on '+JSON.stringify(server.address())));
