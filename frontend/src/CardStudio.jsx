import React, {useState} from 'react';
import {visualStyle} from './CardCanvas.jsx';
import {FilePicker, bytesLabel} from './Attachments.jsx';
import {detailLayoutOptions} from './DemandDetailLayouts.jsx';
import {CARD_BACKGROUND_OPTIONS} from '../../shared/card-backgrounds.mjs';
import './CardStudio.css';

const themes = [['orange', '暖橙', '#e56516'], ['ink', '深墨', '#263d53'], ['mint', '薄荷', '#4d7a63'], ['sand', '沙色', '#c2a26a'], ['rose', '玫瑰', '#b57878'], ['sky', '晴空', '#5b7f92']];
const shapes = [['standard', '标准'], ['ticket', '票根'], ['polaroid', '拍立得'], ['bubble', '气泡']];
const layouts = [['standard', '标准'], ['poster', '海报'], ['note', '便笺']];
const backgrounds = CARD_BACKGROUND_OPTIONS;
const focusOptions = [['center', '居中'], ['top', '靠上'], ['bottom', '靠下'], ['left', '靠左'], ['right', '靠右']];
const templates = [
  ['translation', '翻译求助', {title: '项目文本翻译', problem: '项目文本需要译成目标语言，已有译文保持不变。', desiredOutcome: '得到可直接使用的译文', deliverables: '译文文件副本', acceptanceCriteria: '术语与变量标记保持一致', skills: '专业翻译'}],
  ['review', '资料审阅', {title: '资料审阅', problem: '需要同事帮忙看一遍材料，指出遗漏和风险。', desiredOutcome: '得到审阅意见', deliverables: '逐条修改建议', acceptanceCriteria: '覆盖主要章节并标注出处', skills: '文档审阅'}],
  ['data', '数据整理', {title: '数据整理', problem: '手头有两份表格，需要合并并核对差异。', desiredOutcome: '得到一份干净的汇总表', deliverables: '汇总 XLSX', acceptanceCriteria: '保留全部来源行并标注差异', skills: 'Excel / 数据处理'}],
  ['blank', '空白', null],
];

const lineCount = value => String(value || '').split('\n').map(item => item.trim()).filter(Boolean);

export function CardStudio({value, onChange, onImage, disabled = false, draft = null, chatBusy = false, files = [], onManageFiles, onClose, onSave, onPublish, onArchive}) {
  const [uploading, setUploading] = useState(false);
  const [imageError, setImageError] = useState('');
  const s = visualStyle(value.cardStyle);
  const cover = value.cardCover?.url;
  const artwork = value.cardArtwork;
  const rewardImage = value.rewardImage?.url || value.rewardUrl;
  const patch = (key, next) => onChange(current => ({...current, [key]: next}));
  const changeStyle = (key, next) => onChange(current => ({...current, cardStyle: {...visualStyle(current.cardStyle), [key]: next}}));

  const checks = [
    Boolean(String(value.title || '').trim()),
    Boolean(String(value.problem || '').trim()),
    Boolean(String(value.desiredOutcome || '').trim()),
    Boolean(String(value.deliverables || '').trim() || String(value.acceptanceCriteria || '').trim()),
    Boolean(String(value.deadline || '').trim()),
  ];
  const completed = checks.filter(Boolean).length;
  const missing = 5 - completed;
  const deliveryCount = [value.desiredOutcome, value.deliverables, value.acceptanceCriteria].filter(item => String(item || '').trim()).length;
  const isPrivate = value.visibility === 'private';
  const skills = Array.isArray(value.skills) ? value.skills.join(' / ') : (value.skills || '');
  const skillList = (Array.isArray(value.skills) ? value.skills : String(value.skills || '').split(/[，,]/)).map(item => String(item).trim()).filter(Boolean);
  const kindLabel = value.kind === 'bounty' ? '悬赏' : value.kind === 'announcement' ? '公告' : '求助';

  function mediaChange(media, purpose) {
    if (purpose === 'cover') {
      onChange(current => ({...current, coverAttachmentId: media?.id ?? null, cardCover: media ? {url: media.url} : null, selectedCoverId: media?.id ?? null}));
      return;
    }
    onChange(current => ({...current, rewardAttachmentId: media?.id ?? null, rewardImage: media ? {url: media.url} : null, selectedRewardId: media?.id ?? null}));
  }

  async function upload(filesToUpload, purpose) {
    if (!filesToUpload.length) return;
    setUploading(true);
    setImageError('');
    try {
      const media = await onImage(filesToUpload[0], purpose);
      mediaChange(media, purpose);
    } catch (error) {
      setImageError(error.message);
    } finally {
      setUploading(false);
    }
  }

  function applyTemplate(template) {
    onChange(current => {
      if (!template) {
        return {...current, title: '', problem: '', desiredOutcome: '', deliverables: '', acceptanceCriteria: '', materials: '', constraints: '', deadline: '', skills: ''};
      }
      const next = {...current};
      for (const [key, text] of Object.entries(template)) {
        if (!String(current[key] || '').trim()) next[key] = text;
      }
      return next;
    });
  }

  const classes = `live-card card-canvas cs-card ${cover || artwork ? 'card-artwork ' : ''}card-theme-${s.theme} card-layout-${s.layout} card-radius-${s.radius} card-emphasis-${s.emphasis} card-background-${s.background} card-shape-${s.shape}`;
  const cardStyle = {
    ...(cover ? {'--cover-image': `url("${cover}")`} : artwork ? {'--cover-image': `url("/api/requests/${encodeURIComponent(value.id)}/artwork.svg?v=${artwork.id}")`, '--card-bg': artwork.design.paper, '--card-ink': artwork.design.ink, '--card-muted': artwork.design.ink, '--card-accent': artwork.design.ink, '--card-border': artwork.design.ink + '26'} : {}),
    '--cover-position': s.coverPosition,
  };

  return <section className="card-studio" aria-label="互助卡工作室">
    <header className="cs-head">
      <div className="cs-title">
        <span className="cs-mark" aria-hidden="true">✦</span>
        <div>
          <h2>互助卡设计</h2>
          <small>{chatBusy ? 'AI 正在修改卡片…' : draft?.status === 'open' ? '已发布 · 修改后需保存' : '草稿 · 修改后需保存'}</small>
        </div>
      </div>
      <button type="button" className="cs-close" aria-label="收起工作室" onClick={onClose}>×</button>
    </header>

    <div className="cs-body">
      <div className="cs-templates">
        <span className="cs-templates-label">从模板开始</span>
        {templates.map(([key, label, template]) => <button key={key} type="button" className="cs-template" disabled={disabled} onClick={() => applyTemplate(template)}>{label}</button>)}
      </div>

      <article className={classes} style={cardStyle}>
        <div className="live-top cs-meta">
          <span className="cs-meta-left"><b className="cs-kind">{kindLabel}</b><i className="cs-dot" aria-hidden="true"/><span>{value.anonymous ? '匿名展示' : '公司公屏'}</span></span>
          <span>{value.deadline || '时间待商量'}</span>
        </div>
        <label className="cs-card-field cs-card-title"><span>标题</span><textarea rows="1" maxLength="200" disabled={disabled} value={value.title || ''} onChange={event => patch('title', event.target.value.replace(/\n/g, ' '))} placeholder="一句话说清需要什么帮助"/></label>
        <label className="cs-card-field"><span>遇到的困扰</span><textarea rows="2" maxLength="2000" disabled={disabled} value={value.problem || ''} onChange={event => patch('problem', event.target.value)} placeholder="现在卡在哪里，为什么需要同事帮忙"/></label>

        <details className="cs-card-details">
          <summary><span><b>交付与验收</b> · 已填 {deliveryCount} 项</span><span>展开修改 ›</span></summary>
          <div className="cs-card-details-body">
            <label className="cs-card-field"><span>希望达成</span><textarea rows="1" disabled={disabled} value={value.desiredOutcome || ''} onChange={event => patch('desiredOutcome', event.target.value)} placeholder="希望最后得到什么结果"/></label>
            <label className="cs-card-field"><span>交付物</span><textarea rows="1" disabled={disabled} value={value.deliverables || ''} onChange={event => patch('deliverables', event.target.value)} placeholder="每行一项，例如：英文版 XLSX 副本"/></label>
            <label className="cs-card-field"><span>完成标准</span><textarea rows="1" disabled={disabled} value={value.acceptanceCriteria || ''} onChange={event => patch('acceptanceCriteria', event.target.value)} placeholder="怎样算完成，每行一条"/></label>
          </div>
        </details>

        <div className="live-bottom cs-tags">{skillList.length > 0 ? skillList.slice(0, 3).map((skill, index) => <span key={skill + index} className={'cs-tag ' + (index % 2 ? 'mint' : 'accent')}>{skill}</span>) : <span className="cs-tag muted">技能待补充</span>}</div>
      </article>

      {files.length > 0 && <div className="cs-files">
        <span className="cs-files-label">对话材料</span>
        <div className="cs-file-list">
          {files.slice(0, 3).map(file => <button key={file.id} type="button" className="cs-file" disabled={disabled} onClick={onManageFiles} title={file.name}>
            <i aria-hidden="true"/><span><b>{file.name}</b><small>{bytesLabel(file.size)}{file.aiEnabled ? ' · AI阅读' : ' · 仅附件'}</small></span>
          </button>)}
        </div>
        {files.length > 3 && <button type="button" className="cs-files-more" disabled={disabled} onClick={onManageFiles}>全部 {files.length} 个 ›</button>}
      </div>}

      <div className="cs-complete">
        <span>完整度</span>
        <i aria-hidden="true"><b style={{width: `${completed * 20}%`}}/></i>
        <strong className={missing ? 'warn' : ''}>{missing ? `还差 ${missing} 项` : '可以发布了'}</strong>
      </div>

      <div className="cs-style-card">
        <div className="cs-style-row">
          <span className="cs-label">封面</span>
          <span className={'cs-cover-preview' + (cover ? ' has' : '')}>{cover ? <img src={cover} alt="背景预览"/> : <i aria-hidden="true"/>}</span>
          <div className="cs-cover-actions"><FilePicker imagesOnly multiple={false} disabled={disabled || uploading} onFiles={list => upload(list, 'cover')} label={uploading ? '上传中…' : cover ? '更换背景' : '上传背景'}/></div>
          {cover && <button type="button" className="cs-remove" disabled={disabled || uploading} onClick={() => mediaChange(null, 'cover')}>移除</button>}
        </div>
        {cover && <div className="cs-style-row">
          <span className="cs-label">焦点</span>
          <label className="cs-focus">图片对齐<select disabled={disabled || uploading} value={s.coverPosition} onChange={event => changeStyle('coverPosition', event.target.value)}>{focusOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        </div>}
        <div className="cs-style-row">
          <span className="cs-label">配色</span>
          <div className="cs-swatches">{themes.map(([key, label, color]) => <button key={key} type="button" title={label} aria-label={label} aria-pressed={s.theme === key} className={'cs-swatch' + (s.theme === key ? ' on' : '')} style={{'--swatch': color}} onClick={() => changeStyle('theme', key)}/>)}</div>
          <span className="cs-value">{themes.find(([key]) => key === s.theme)?.[1] || '暖橙'}</span>
        </div>
        <div className="cs-style-row">
          <span className="cs-label">形状</span>
          <div className="cs-shapes">{shapes.map(([key, label]) => <button key={key} type="button" title={label} aria-label={label} aria-pressed={s.shape === key} className={'cs-shape ' + key + (s.shape === key ? ' on' : '')} onClick={() => changeStyle('shape', key)}><i aria-hidden="true"/></button>)}</div>
          <span className="cs-value">{shapes.find(([key]) => key === s.shape)?.[1] || '标准'}</span>
        </div>
        {imageError && <p className="inline-error" role="alert">{imageError}</p>}
      </div>

      <details className="cs-more">
        <summary>更多设置</summary>
        <div className="cs-more-body">
          <div className="cs-more-group">
            <b>背景与版式</b>
            <div className="cs-style-row"><span className="cs-label">背景</span><div className="cs-chips">{backgrounds.map(([key, label]) => <button key={key} type="button" disabled={Boolean(cover)} className={s.background === key ? 'on' : ''} onClick={() => changeStyle('background', key)}>{label}</button>)}</div></div>
            <div className="cs-style-row"><span className="cs-label">版式</span><div className="cs-chips">{layouts.map(([key, label]) => <button key={key} type="button" className={s.layout === key ? 'on' : ''} onClick={() => changeStyle('layout', key)}>{label}</button>)}</div></div>
            <div className="cs-style-row"><span className="cs-label">圆角</span><div className="cs-chips"><button type="button" className={s.radius === 'soft' ? 'on' : ''} onClick={() => changeStyle('radius', 'soft')}>柔和</button><button type="button" className={s.radius === 'square' ? 'on' : ''} onClick={() => changeStyle('radius', 'square')}>方角</button></div><span className="cs-label">字重</span><div className="cs-chips"><button type="button" className={s.emphasis === 'normal' ? 'on' : ''} onClick={() => changeStyle('emphasis', 'normal')}>常规</button><button type="button" className={s.emphasis === 'bold' ? 'on' : ''} onClick={() => changeStyle('emphasis', 'bold')}>加重</button></div></div>
          </div>

          <div className="cs-more-group">
            <b>时间与技能</b>
            <label className="cs-field"><span>截止时间</span><textarea rows="1" disabled={disabled} value={value.deadline || ''} onChange={event => patch('deadline', event.target.value.replace(/\n/g, ' '))} placeholder="例如：11月15日，或写“时间待商量”"/></label>
            <label className="cs-field"><span>所需技能</span><textarea rows="1" disabled={disabled} value={skills} onChange={event => patch('skills', event.target.value.replace(/\n/g, '，'))} placeholder="用逗号分隔，例如：专业翻译，TIA / 博途"/></label>
          </div>

          <div className="cs-more-group">
            <b>材料与限制</b>
            <label className="cs-field"><span>材料描述</span><textarea rows="2" disabled={disabled} value={value.materials || ''} onChange={event => patch('materials', event.target.value)} placeholder="每行一项；附件在左侧输入框上传"/></label>
            <label className="cs-field"><span>限制条件</span><textarea rows="2" disabled={disabled} value={value.constraints || ''} onChange={event => patch('constraints', event.target.value)} placeholder="例如：不能改动原有标记、仅填写空单元格"/></label>
          </div>

          <div className="cs-more-group">
            <b>发布设置</b>
            <label className="cs-select">发布到<select disabled={disabled} value={value.visibility || 'company'} onChange={event => patch('visibility', event.target.value)}><option value="company">公司公屏</option><option value="private">仅自己可见（草稿）</option></select></label>
            <label className="cs-select">详情版式<select disabled={disabled} value={value.detailLayout || 'auto'} onChange={event => patch('detailLayout', event.target.value)}>{detailLayoutOptions.map(([option, label]) => <option key={option} value={option}>{label}</option>)}</select></label>
            <label className="cs-check"><input type="checkbox" disabled={disabled} checked={Boolean(value.anonymous)} onChange={event => patch('anonymous', event.target.checked)}/>公屏匿名展示姓名和部门</label>
            <label className="cs-check"><input type="checkbox" disabled={disabled} checked={Boolean(value.fallbackToBoard)} onChange={event => patch('fallbackToBoard', event.target.checked)}/>愿意后续转到公屏（意向，不代表自动发布）</label>
            {isPrivate && <p className="cs-hint">仅自己可见的草稿不能发布到公屏；发布前请先改为公司公屏。</p>}
          </div>

          <div className="cs-more-group">
            <b>发布人报酬（选填）</b>
            <textarea className="cs-reward" rows="2" maxLength="500" disabled={disabled || uploading} value={value.rewardText || ''} onChange={event => patch('rewardText', event.target.value)} placeholder="例如：请一杯咖啡，或说明一份小心意"/>
            {rewardImage && <img className="cs-reward-image" src={rewardImage} alt="报酬图片预览"/>}
            <div className="cs-cover-tools">
              <FilePicker imagesOnly multiple={false} disabled={disabled || uploading} onFiles={list => upload(list, 'reward')} label={rewardImage ? '替换报酬图片' : '添加报酬图片'}/>
              {rewardImage && <button type="button" className="text-button" disabled={disabled || uploading} onClick={() => mediaChange(null, 'reward')}>移除图片</button>}
            </div>
            <p className="cs-hint">文字与一张图片可同时展示；平台不收款或支付。</p>
          </div>

          {draft && <button type="button" className="text-button cs-archive" disabled={disabled} onClick={onArchive}>移除这张草稿</button>}
        </div>
      </details>

      <p className="cs-hint">卡片文字可直接点击修改；发布前会显示公屏可见范围。</p>
    </div>

    <footer className="cs-foot">
      <button type="button" className="secondary cs-save" disabled={disabled || chatBusy} onClick={onSave}>保存草稿</button>
      <button type="button" className="primary cs-publish" disabled={disabled || chatBusy || isPrivate} onClick={onPublish}>预览并发布 →</button>
    </footer>
  </section>;
}
