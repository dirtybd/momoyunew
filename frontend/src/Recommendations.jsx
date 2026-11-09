import React, { useEffect, useState } from 'react';
import './Recommendations.css';

const httpUrl = value => typeof value === 'string' && /^https?:\/\//i.test(value) ? value : null;
const iconUrl = value => typeof value === 'string' && /^\/api\/agents\/product-[a-z0-9]+\/icon$/i.test(value) ? value : null;

function Card({ item }) {
  const url = httpUrl(item.url);
  if (!url) return null;
  return <a className="agent-reco-card" href={url} target="_blank" rel="noopener noreferrer" title={item.description || item.name}>
    <span className="agent-reco-icon" aria-hidden="true">
      {iconUrl(item.iconUrl) ? <img src={item.iconUrl} alt="" loading="lazy"/> : <b>{(item.name || '智').slice(0, 1)}</b>}
    </span>
    <span className="agent-reco-body">
      <span className="agent-reco-title">{item.name}{item.category && <em>{item.category}</em>}</span>
      {item.description && <span className="agent-reco-desc">{item.description}</span>}
    </span>
    <span className="agent-reco-open" aria-hidden="true">↗</span>
  </a>;
}

export function AgentRecommendations({ items = [], title = '这件事也许可以交给它们', note = true }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return <section className="agent-reco" aria-label="站内智能体推荐">
    <div className="agent-reco-head"><span>站内智能体</span><strong>{title}</strong></div>
    <div className="agent-reco-list">{items.map(item => <Card item={item} key={item.productId || item.name}/>)}</div>
    {note && <p className="agent-reco-note">来自站内智能体广场，点击会在新标签页打开；使用前需要登录。</p>}
  </section>;
}

export function AgentRecommendationFallback({ query, hidden = false }) {
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setItems([]); setLoaded(false); setLoading(false); setOpen(false); setError(''); }, [query]);
  if (hidden || !query?.trim()) return null;
  const toggle = async () => {
    if (open) return setOpen(false);
    setOpen(true);
    if (loaded || loading) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/agents/recommend', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit: 3 }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message || '暂时无法获取推荐');
      setItems(Array.isArray(data.recommendations) ? data.recommendations : []);
      setLoaded(true);
    } catch (reason) {
      setError(reason.message || '暂时无法获取推荐');
    } finally {
      setLoading(false);
    }
  };
  return <div className="agent-reco-fallback">
    <button type="button" className="agent-reco-trigger" onClick={toggle} aria-expanded={open}>
      {loading ? '正在查找合适的智能体…' : open ? '收起智能体推荐' : '没解决？看看站内智能体 ↗'}
    </button>
    {open && loaded && items.length === 0 && <span className="agent-reco-hint" role="status">暂时没有匹配的站内智能体。</span>}
    {error && <span className="agent-reco-hint" role="status">{error}</span>}
    {open && items.length > 0 && <AgentRecommendations items={items} title="也许这些智能体更合适"/>}
  </div>;
}
