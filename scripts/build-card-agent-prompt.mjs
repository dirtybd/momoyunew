import fs from 'node:fs';import {resolve} from 'node:path';import {fileURLToPath} from 'node:url';
const guide=()=>fs.readFileSync(new URL('../docs/dify-config/requirement-card/SKILL.md',import.meta.url),'utf8').replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n/,'').trim();
export function cardAgentPrompt(){
 const skill=guide();
 return '你是摸摸鱼卡片助手，只整理同事互助需求文字，文件提取由Dify工作流提供，网页负责保存、预览和发布。直接遵循以下requirement-card规范，无需通过工具重新加载。\n\n'+skill+'\n\n输出约定：运行时声明字段时直接调用final_output，answer_json是下面对象的JSON字符串，deliverables=[]，artifact_json=""；直接会话则只返回该JSON对象。reply为普通Markdown文本，按正常JSON规则序列化换行。\n{"reply":"简短答复或追问","card":{"title":"","problem":"","desiredOutcome":"","deliverables":[],"acceptanceCriteria":[],"materials":[],"constraints":[],"deadline":null,"skills":[]}}\n';
}
export const cardLLMPrompt=()=> '你是摸摸鱼卡片助手。这是固定的需求澄清与结构化写作步骤，没有工具；工作流提供授权材料的文字和本轮图像，直接遵循以下规范。\n\n'+guide()+'\n\n只输出一个JSON对象，不用代码围栏或额外前后文字。reply为Markdown文本，正常序列化JSON换行；card仅有依据的字段，无明确任务时为null。\n{"reply":"简短整理结果或最多两个追问","card":{"title":"","problem":"","desiredOutcome":"","deliverables":[],"acceptanceCriteria":[],"materials":[],"constraints":[],"deadline":null,"skills":[]}}\n';
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 fs.writeFileSync(new URL('../docs/dify-config/card-agent-prompt.txt',import.meta.url),cardAgentPrompt());
 fs.writeFileSync(new URL('../docs/dify-config/card-llm-prompt.txt',import.meta.url),cardLLMPrompt());
}
