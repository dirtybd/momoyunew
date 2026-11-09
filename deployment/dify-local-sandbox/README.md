# Dify文档渲染环境

本镜像仅为Dify 1.18.0本地Agent沙箱加入LibreOffice Writer、Poppler、Fontconfig、Noto CJK和Liberation字体。默认仍为dify用户，保持原网络隔离和既有/home/dify、/workspace数据卷；不包含员工文件、Agent私有venv、凭证或任何测试会话数据。

在项目目录构建：

```powershell
docker build -t momoyu/dify-agent-local-sandbox:1.18.0-docs deployment/dify-local-sandbox
```

先检查实际Compose项目名，切勿依赖目录名默认值。当前这台机器的已有项目为`dify`，镜像及build context已加入其原compose.override.yaml；原nginx和plugin端口设置保留。只重建这个服务，其他API/Worker无需重建：

```powershell
# 在实际Dify docker目录执行；先确认没有运行中的Agent任务。
docker compose -p dify up -d --no-deps local_sandbox
```

其他机器可把compose.documents.yaml作为额外覆盖文件，或把local_sandbox的image/build配置并入其既有覆盖文件；build context应指向此Dockerfile目录。复用原Compose项目名和数据卷，不另起同名空环境。迁移Dify版本时先调整基础镜像并在隔离环境复测，不直接跨版本替换。

本机安装/构建阶段均使用Debian官方软件源。首次在运行容器内安装时，通过已有agent_ssrf_proxy获取依赖；没有改变代理放行规则或网络隔离。正式镜像构建不携带代理凭证。仅在临时容器安装软件不能保证未来重建保留，因此最终已切换为可重建镜像。

验证要同时检查新建Agent任务中的命令与字体，而不只检查Docker默认shell：`soffice --version`、`pdftoppm -v`、`fc-match 'Noto Sans CJK SC'`。本轮已验证容器重建后仍可用，原办公venv与Skill保留。LibreOffice版本7.4.7.2、Poppler22.12.0；字体为Noto Sans CJK SC/Liberation Sans。

Skill的render_docx.py在当前任务目录运行，通过同包lok_export.py调用镜像已有的LibreOfficeKit稳定C ABI；每次独立子进程/profile，默认最多8页、110dpi、150秒，可调上限12页/150dpi/180秒，输入DOCX最多20MB。宏、嵌入对象和可自动加载的外部关系拒绝处理；文本超链接不主动访问。原件Hash复核不变，新目录防止混用旧预览。

必须验证真实任务，不能仅凭容器docker exec成功认定可用。Dify受限Shellctl禁止在公共/tmp创建IPC套接字，裸soffice因此bind(/tmp/OSL_PIPE_...)返回EACCES；设置TMPDIR也不能改变该默认路径。LibreOfficeKit不使用这个CLI套接字，已在相同受限任务内完成两页PDF和PNG。该环境还拒绝跨目录rename（EXDEV），脚本以新建预览目录并拷贝已验证的产物完成交付，失败清理本次新目录。没有扩大/tmp授权或修改沙箱网络/文件隔离策略。

实现依据是LibreOffice 7.4的[稳定C接口](https://github.com/LibreOffice/core/blob/libreoffice-7.4.7.2/include/LibreOfficeKit/LibreOfficeKit.h)和[初始化接口](https://github.com/LibreOffice/core/blob/libreoffice-7.4.7.2/include/LibreOfficeKit/LibreOfficeKitInit.h)。[IPC源码](https://github.com/LibreOffice/core/blob/libreoffice-7.4.7.2/sal/osl/unx/pipe.cxx)先选公共/tmp或/var/tmp，不能将TMPDIR覆盖当作修复。升级LibreOffice后重新验证ABI、字体和渲染结果。

渲染脚本只产生PDF、逐页PNG、提取文本和结构报告，始终visualVerified=false。真正视觉检查由document_visual_review逐页接收实际图片并返回辅助判断，不能把PDF页数或文字回读当作排版合格。LibreOffice、Word和WPS可能存在版面差异，重要文档仍应在目标软件核对。

本机验证命令及结果记录在docs/dify-config/document-quality-handoff.md和docs/VALIDATION.md。Python边界测试可在安装依赖的Linux环境运行：`python tests/test_render_docx.py`（测试目录与scripts同属document-quality-work目录），包含真实双页渲染、并发profile、页数上限、外部关系拒绝与原件不变。
