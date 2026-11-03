import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { favoriteKey, type FavoriteInput, type FavoriteLibrary, type FavoriteOrder } from '../models/favorites';
import type { Reply } from '../models/schema';

export function useFavorites(notify: (message: string) => void) {
  const [library, setLibrary] = useState<FavoriteLibrary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const run = useCallback(async (operation: () => Promise<Reply<FavoriteLibrary>>, message?: string) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const reply = await operation();
      if (!reply.ok) { setError(reply.error.message); notify(reply.error.message); return; }
      setLibrary(reply.value); if (message) notify(message);
    } catch { const text = '无法连接收藏服务，请重试。'; setError(text); notify(text); }
    finally { pending.current = false; setBusy(false); }
  }, [notify]);
  const reload = useCallback(() => run(() => window.desktop.listFavorites()), [run]);
  useEffect(() => { void reload(); }, [reload]);
  const ids = useMemo(() => new Map(library?.items.map(item => [favoriteKey(item), item.id])), [library]);
  const remove = (id: string) => run(() => window.desktop.removeFavorite(id), '已取消收藏');
  return { library, busy, error, reload, remove,
    has: (input: FavoriteInput) => ids.has(favoriteKey(input)),
    toggle: (input: FavoriteInput) => {
      const id = ids.get(favoriteKey(input));
      return id ? remove(id) : run(() => window.desktop.addFavorite(input), '已收藏反馈');
    },
    reorder: (order: FavoriteOrder) => run(() => window.desktop.reorderFavorites(order)) };
}
