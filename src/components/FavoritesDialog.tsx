import { ArrowDown, ArrowUp, Heart, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { orderedFavorites, type FavoriteLibrary, type FavoriteOrder } from '../models/favorites';
import { FeedbackCard } from './FeedbackCard';

export function FavoritesDialog({ library, busy, error, onClose, onReload, onRemove, onReorder, notify }: {
  library?: FavoriteLibrary; busy: boolean; error: string; onClose: () => void; onReload: () => void;
  onRemove: (id: string) => void; onReorder: (order: FavoriteOrder) => void; notify: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const items = library ? orderedFavorites(library) : [];
  const move = (index: number, offset: number) => {
    const ids = items.map(item => item.id);
    [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    onReorder({ sort: 'manual', ids });
  };
  return <dialog className="favorites-dialog" ref={dialog} onCancel={event => { event.preventDefault(); onClose(); }} aria-labelledby="favorites-title">
    <header className="favorites-heading"><div><h2 id="favorites-title"><Heart size={21} />收藏夹</h2><p>留住值得回看的表达与修改建议。</p></div><button className="icon-button" aria-label="关闭收藏夹" onClick={onClose}><X size={20} /></button></header>
    <div className="favorites-toolbar"><span>{items.length} 条收藏</span><label>排序<select aria-label="收藏排序" disabled={busy || !library} value={library?.sort ?? 'newest'} onChange={event => onReorder({ sort: event.target.value as FavoriteOrder['sort'], ids: items.map(item => item.id) })}><option value="newest">最新收藏优先</option><option value="manual">自定义顺序</option></select></label></div>
    <div className="favorites-content" aria-busy={busy}>
      {error && <div className="favorites-error" role="alert"><p>{error}</p><button className="secondary-button" disabled={busy} onClick={onReload}>重新加载收藏</button></div>}
      {!library && !error && <p role="status" className="muted">正在读取收藏…</p>}
      {library && !items.length && <div className="favorites-empty"><Heart size={32} /><h3>还没有收藏</h3><p>点击反馈卡片上复制按钮旁的爱心，保存完整反馈。</p></div>}
      {items.map((item, index) => <section className="favorite-item" data-testid="favorite-item" key={item.id}>
        <div className="favorite-meta"><span>{item.scope === 'document' ? '全文反馈' : '单句反馈'} · <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false })}</time></span><div><button className="icon-button" aria-label="上移收藏" title="上移并使用自定义顺序" disabled={busy || index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} /></button><button className="icon-button" aria-label="下移收藏" title="下移并使用自定义顺序" disabled={busy || index === items.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} /></button></div></div>
        <FeedbackCard entry={{ id: item.id, from: 0, to: item.result.original_text.length, text: item.result.original_text, complete: true, signature: '', state: 'done', result: item.result }} index={index} scope={item.scope} readOnly favorite favoriteBusy={busy} onFavorite={() => onRemove(item.id)} notify={notify} />
      </section>)}
    </div>
  </dialog>;
}
