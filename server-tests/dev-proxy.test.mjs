import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createServer} from 'vite';
import config from '../vite.config.mjs';

test('开发代理保留浏览器来源：IP 和 localhost 注册登录可用，外站仍被拒绝', async t => {
  const dir=mkdtempSync(join(tmpdir(),'momoyu-proxy-'));
  const child=spawn(process.execPath,['server/index.mjs'],{windowsHide:true,env:{...process.env,PORT:'0',HOST:'127.0.0.1',DATA_DIR:dir,DIFY_API_KEY:''},stdio:['ignore','pipe','pipe']});
  let vite;
  t.after(async()=>{await vite?.close();if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});});
  let output='',backend;
  for await(const chunk of child.stdout){output+=chunk;const m=output.match(/"port":(\d+)/);if(m){backend='http://127.0.0.1:'+m[1];break;}}
  assert.ok(backend,'backend must start');
  const proxy=config.server.proxy['/api'];
  vite=await createServer({...config,configFile:false,logLevel:'silent',server:{...config.server,port:0,strictPort:false,proxy:{'/api':typeof proxy==='string'?backend:{...proxy,target:backend}}}});
  await vite.listen();
  const port=vite.httpServer.address().port;
  for(const hostname of ['127.0.0.1','localhost']){
    const base=`http://${hostname}:${port}`;
    const body={username:'proxy-'+hostname,password:'password123',displayName:'代理测试',department:'测试'};
    const request=async(path,data,origin=base)=>fetch(base+'/api'+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(data)});
    const register=await request('/auth/register',body);
    const data=await register.json();
    assert.equal(register.status,201,JSON.stringify({hostname,error:data.error}));
    const login=await request('/auth/login',{username:body.username,password:body.password});
    assert.equal(login.status,200);
    const blocked=await request('/auth/register',{},'https://evil.example');
    assert.equal(blocked.status,403);
    assert.equal((await blocked.json()).error.code,'INVALID_ORIGIN');
  }
});
