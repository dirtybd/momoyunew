import {test} from 'node:test';import assert from 'node:assert/strict';
import {difyFileReference,normalizeDifyFileReference} from '../server/dify-file-reference.mjs';
test('Dify规范文件引用保留URL安全编码和Base64填充，旧引用可续用',()=>{
 const id='11111111-1111-4111-8111-111111111111',ref=difyFileReference(id);
 assert.equal(ref,'dify-file-ref:'+Buffer.from(JSON.stringify({record_id:id})).toString('base64'));
 assert.equal(ref.split(':')[1].length%4,0);assert.ok(ref.endsWith('=='));
 assert.equal(normalizeDifyFileReference(ref.replace(/=+$/,'')),ref);
 assert.equal(normalizeDifyFileReference(ref),ref);
 const value={record_id:id,storage_key:'旧文件/资料'};const old='dify-file-ref:'+Buffer.from(JSON.stringify(value)).toString('base64url');
 assert.deepEqual(JSON.parse(Buffer.from(normalizeDifyFileReference(old).split(':')[1],'base64url')),value);
 for(const bad of ['local-plain-text-translation','dify-file-ref:bad','dify-file-ref:W10=',null])assert.equal(normalizeDifyFileReference(bad),bad);
});
