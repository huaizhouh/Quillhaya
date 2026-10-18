import { Check, ChevronDown, Copy, CornerDownLeft, LocateFixed, RotateCw, X } from 'lucide-react';
import { useState } from 'react';
import type { FeedbackEntry } from '../core/coordinator';
import type { Issue } from '../models/schema';

const labels: Record<Issue['type'], string> = { grammar: '语法', spelling: '拼写', word_choice: '用词', collocation: '搭配', clarity: '清晰度', conciseness: '简洁度', tone: '语气', coherence: '连贯性', task_relevance: '切题度' };
export function FeedbackCard({ entry, index, onAccept, onIgnore, onRetry, onLocate, notify, scope = 'sentence' }: {
  entry: FeedbackEntry; index: number; onAccept?: () => void; onIgnore: () => void; onRetry: () => void; onLocate: () => void; notify: (message: string) => void; scope?: 'sentence' | 'document';
}) {
  const [expanded, setExpanded] = useState(false);
  const r = entry.ignored ? undefined : entry.result;
  const status = entry.ignored ? 'ignored' : entry.state === 'error' ? 'error' : entry.state === 'analyzing' ? 'analyzing' : entry.state === 'queued' ? 'queued' : r?.status ?? 'pending';
  const title = entry.state === 'pending' && entry.textChanged && r ? '保留上次意见' : ({ ignored: '已忽略', good: '表达良好', needs_revision: '建议修改', incomplete: '等待句子完成', error: '分析失败', analyzing: '分析中', queued: '排队中', pending: entry.complete ? '待分析' : '继续写作' })[status];
  const strength = r?.issues.some(i => i.severity === 'error') ? '客观错误' : '可选优化';
  return <article className={`feedback-card ${status}`} data-testid="feedback-card">
    <div className="card-heading"><span className="card-status">{status === 'good' ? <Check size={14} /> : status === 'analyzing' ? <span className="spinner" /> : <span className="status-glyph">{status === 'needs_revision' ? '↗' : status === 'error' ? '!' : '·'}</span>}{title}</span><span className="sentence-index">{String(index + 1).padStart(2, '0')}</span></div>
    <button className="original-text" onClick={onLocate} title="定位到原句，不移动光标">{entry.text}<LocateFixed size={13} /></button>
    {!entry.ignored && entry.textChanged && <p className="context-notice">原句已修改 · 保留此前意见，{entry.requestId ? '正在重新评估' : '等待重新评估'}；旧建议不能直接应用。</p>}
    {!entry.ignored && entry.contextChanged && <p className="context-notice">{scope === 'document' ? '全文或分析设置已变化 · 保留此前反馈，点击“分析全文”更新。' : '上下文已变化 · 保留此前反馈，可重新评估。'}</p>}
    {status === 'pending' && <p className="muted card-description">{entry.complete ? '完成句子后，反馈将在这里出现。' : '这一句尚未结束，不会被当作语法错误。'}</p>}
    {status === 'analyzing' && <p className="muted card-description">继续写，反馈正在路上。</p>}
    {status === 'queued' && <p className="muted card-description">等待可用的模型请求位置，尚未开始计算请求超时。</p>}
    {r && <>
      {entry.textChanged && <p className="muted card-description" lang="en">此前原句：{r.original_text}</p>}
      {r.issues.length > 0 && <div className="issue-tags"><span>{labels[r.issues[0].type]}</span><span>{strength}</span></div>}
      {r.suggested_revision && <div className="suggestion"><span className="eyebrow">推荐表达</span><p lang="en">{r.suggested_revision}</p></div>}
      <p className="card-description">{r.overall_explanation_zh}</p>
      {expanded && <div className="issue-details">{r.issues.map((issue, i) => <div key={i}><strong>{labels[issue.type]} · {issue.severity === 'error' ? '客观错误' : '可选优化'}</strong><p lang="en">{issue.original_span} {issue.suggested_text && <>→ <span>{issue.suggested_text}</span></>}</p><p>{issue.explanation_zh}</p></div>)}<p className="muted">模型自报信心：{Math.round(r.confidence * 100)}% · 不代表准确率</p></div>}
      <div className="card-actions">
        {r.suggested_revision && onAccept && <button className="accept-button" disabled={entry.textChanged} onClick={onAccept}><CornerDownLeft size={13} />接受修改</button>}
        {r.suggested_revision && <button className="icon-button" aria-label="复制推荐句" onClick={() => { void window.desktop.copy(r.suggested_revision!).then(reply => notify(reply.ok ? '已复制推荐句' : reply.error.message), () => notify('复制失败，请手动选择推荐句复制')); }}><Copy size={14} /></button>}
        <button className="text-button" onClick={onIgnore} title={scope === 'document' ? '隐藏本次篇章反馈' : '保留原句，忽略评价并移除正文标记'}><X size={13} />忽略</button>
        <button className={`detail-button ${expanded ? 'expanded' : ''}`} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>详情<ChevronDown size={13} /></button>
      </div>
    </>}
    {!entry.ignored && entry.error && <p className="card-description error-text">{entry.error.message}</p>}
    <button className="text-button reevaluate-button" disabled={Boolean(entry.requestId) || !entry.complete} onClick={onRetry}><RotateCw size={13} />{!entry.ignored && entry.error ? '重试分析' : '重新评估'}</button>
  </article>;
}
