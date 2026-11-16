// Image questions can use native vision without starting the file-editing sandbox.
export function isImageQuestion(message,files=[]){
 return files.length>0&&files.every(f=>f.isImage)&&!/(?:生成|制作|导出|下载|另存|转为|转换|合并|删除|替换|填写|填入|修改|整理成|做成|输出.{0,4}(?:文件|文档|表格))/.test(message);
}
