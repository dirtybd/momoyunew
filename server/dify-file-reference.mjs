const prefix='dify-file-ref:';
const encode=value=>{
  const text=Buffer.from(JSON.stringify(value)).toString('base64url');
  return prefix+text.padEnd(Math.ceil(text.length/4)*4,'=');
};
export const difyFileReference=recordId=>encode({record_id:recordId});

export function normalizeDifyFileReference(reference){
  if(typeof reference!=='string'||!reference.startsWith(prefix))return reference;
  try{
    const data=JSON.parse(Buffer.from(reference.slice(prefix.length),'base64url').toString('utf8'));
    if(!data||Array.isArray(data)||typeof data.record_id!=='string'||!data.record_id)return reference;
    return encode(data);
  }catch{return reference;}
}
