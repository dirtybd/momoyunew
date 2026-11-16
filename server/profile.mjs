import {randomBytes} from 'node:crypto';
import {mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {receiveFile} from './media-files.mjs';

const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
const AVATAR_MAX_BYTES=5*1024*1024;
const avatarPath=/^\/api\/avatars\/([a-f0-9-]{36}-[a-f0-9]{8}\.webp)$/;

export function profileService({dataDir,get,run,json,points,userView}){
  const root=resolve(dataDir,'avatars');
  const parseProfile=user=>{try{return JSON.parse(user.profile);}catch{return {};}};
  const avatarName=value=>avatarPath.exec(typeof value==='string'?value:'')?.[1]||null;
  const updateAvatar=async(user,avatar)=>{
    const profile={...parseProfile(user)};
    if(avatar)profile.avatar=avatar;
    else delete profile.avatar;
    run('UPDATE users SET profile=? WHERE id=?',JSON.stringify(profile),user.id);
    return userView(get('SELECT * FROM users WHERE id=?',user.id));
  };
  async function removeStoredAvatar(name){
    if(!name)return;
    try{await rm(resolve(root,name),{force:true});}catch{}
  }

  async function handle(req,res,url,user){
    const {pathname:path}=url,method=req.method;

    if(path==='/api/me/profile-overview'&&method==='GET'){
      if(!user)fail(401,'UNAUTHORIZED','请先登录');
      return json(res,200,{user:userView(user),...points.overview(user.id)}),true;
    }

    if(path==='/api/me/points'&&method==='GET'){
      if(!user)fail(401,'UNAUTHORIZED','请先登录');
      const limit=Math.min(500,Math.max(1,Number(url.searchParams.get('limit'))||200));
      const offset=Math.max(0,Number(url.searchParams.get('offset'))||0);
      return json(res,200,points.history(user.id,{limit,offset})),true;
    }

    if(path==='/api/profile/avatar'&&method==='POST'){
      if(!user)fail(401,'UNAUTHORIZED','请先登录');
      const file=await receiveFile(req,{root,maxBytes:AVATAR_MAX_BYTES});
      try{
        let bytes;
        try{
          bytes=await sharp(await readFile(file.path),{limitInputPixels:40000000,animated:false})
            .rotate()
            .resize(512,512,{fit:'cover',position:'attention'})
            .webp({quality:88})
            .toBuffer();
        }catch{
          fail(415,'INVALID_AVATAR','头像图片无法读取，请使用 PNG、JPG、WebP 或 GIF。');
        }
        await mkdir(root,{recursive:true});
        const name=`${user.id}-${randomBytes(4).toString('hex')}.webp`;
        await writeFile(resolve(root,name),bytes,{flag:'wx'});
        const old=avatarName(parseProfile(user).avatar);
        const next=await updateAvatar(user,`/api/avatars/${name}`);
        if(old&&old!==name)await removeStoredAvatar(old);
        return json(res,200,{user:next}),true;
      }finally{
        await rm(file.path,{force:true});
      }
    }

    if(path==='/api/profile/avatar'&&method==='DELETE'){
      if(!user)fail(401,'UNAUTHORIZED','请先登录');
      const old=avatarName(parseProfile(user).avatar);
      const next=await updateAvatar(user,null);
      await removeStoredAvatar(old);
      return json(res,200,{user:next}),true;
    }

    if(avatarPath.test(path)&&(method==='GET'||method==='HEAD')){
      const name=avatarName(path);
      let bytes;
      try{bytes=await readFile(resolve(root,name));}
      catch{return json(res,404,{error:{code:'NOT_FOUND',message:'头像不存在'}}),true;}
      res.writeHead(200,{
        'Content-Type':'image/webp',
        'Content-Length':bytes.length,
        'Cache-Control':'private, max-age=86400',
        'X-Content-Type-Options':'nosniff',
        'Content-Security-Policy':"default-src 'none'; sandbox",
      });
      res.end(method==='HEAD'?undefined:bytes);
      return true;
    }

    return false;
  }

  return {handle};
}
