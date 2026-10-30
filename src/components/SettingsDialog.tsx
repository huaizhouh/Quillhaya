import { Check, CheckCircle2, Plus, Power, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { makeProfile, presetInfo, ProfileSchema, SettingsSchema, type ModelProfile, type Settings } from '../models/schema';

export function SettingsDialog({ settings, keyStatus, onClose, onSaved, onStopModels }: { settings: Settings; keyStatus: Record<string, boolean>; onClose: () => void; onSaved: (settings: Settings, keyStatus: Record<string, boolean>, analysisChanged: boolean) => void; onStopModels: (profile: ModelProfile, key?: string) => Promise<string> }) {
  const [draft, setDraft] = useState<Settings>(() => structuredClone(settings));
  const [selected, setSelected] = useState(settings.defaultProfileId);
  const [keys, setKeys] = useState<Record<string, string | null>>({});
  // Read saved settings only on mount. New, unsaved profile IDs exist in draft alone.
  const [headerText, setHeaderText] = useState(() => JSON.stringify(settings.profiles.find(p => p.id === settings.defaultProfileId)!.headers, null, 2));
  const [message, setMessage] = useState('');
  const [detailsId, setDetailsId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const testId = useRef<string | null>(null);
  const closeAfterTest = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const profile = draft.profiles.find(p => p.id === selected)!;
  useEffect(() => { dialog.current?.showModal(); return () => { if (testId.current) void window.desktop.cancel(testId.current); }; }, []);
  const cancelTest = () => { if (testId.current) { void window.desktop.cancel(testId.current); setMessage('正在取消测试并清理模型…'); } };
  const close = () => { if (testId.current) { closeAfterTest.current = true; cancelTest(); } else if (!busy) onClose(); };
  const patch = (value: Partial<ModelProfile>) => setDraft(d => ({ ...d, profiles: d.profiles.map(p => p.id === selected ? { ...p, ...value } : p) }));
  const select = (p: ModelProfile) => { setSelected(p.id); setHeaderText(JSON.stringify(p.headers, null, 2)); setMessage(''); setDetailsId(undefined); };
  const withHeaders = () => {
    try {
      const next = { ...draft, profiles: draft.profiles.map(p => p.id === selected ? { ...p, headers: JSON.parse(headerText) } : p) };
      const parsed = SettingsSchema.safeParse(next);
      if (!parsed.success) { setMessage(`请检查设置：${parsed.error.issues[0].message}`); return null; }
      return parsed.data;
    } catch { setMessage('附加 Headers 必须是合法的 JSON 对象。'); return null; }
  };
  const selectedProfile = () => {
    try {
      const parsed = ProfileSchema.safeParse({ ...profile, headers: JSON.parse(headerText) });
      if (!parsed.success) { setMessage(`请检查当前模型：${parsed.error.issues[0].message}`); return null; }
      return parsed.data;
    } catch { setMessage('附加 Headers 必须是合法的 JSON 对象。'); return null; }
  };
  const save = async () => {
    setDetailsId(undefined);
    const next = withHeaders(); if (!next) return;
    setBusy(true);
    try { const reply = await window.desktop.saveSettings(next, keys); if (reply.ok) { setKeys({}); onSaved(reply.value.settings, reply.value.keyStatus, reply.value.analysisChanged); onClose(); } else setMessage(reply.error.message); }
    catch { setMessage('设置保存失败，请重试。'); } finally { setBusy(false); }
  };
  const test = async () => {
    setDetailsId(undefined);
    const target = selectedProfile(); if (!target) return;
    const id = crypto.randomUUID(); testId.current = id;
    setBusy(true); setTesting(true); setMessage(`仅测试 ${target.name} / ${target.model}，暂不运行写作分析…`);
    try { const reply = await window.desktop.testConnection(target, keys[selected] ?? undefined, id); setMessage(`${target.name} / ${target.model}：${reply.ok ? reply.value : reply.error.message}`); setDetailsId(reply.ok ? undefined : reply.error.detailsId); }
    catch { setMessage('连接测试失败，请检查配置。'); }
    finally { testId.current = null; setBusy(false); setTesting(false); if (closeAfterTest.current) onClose(); }
  };
  const showDetails = async () => {
    if (!detailsId) return;
    try { const reply = await window.desktop.showConnectionDetails(detailsId); if (!reply.ok) setMessage(reply.error.message); }
    catch { setMessage('无法打开测试详情，请重试。'); }
  };
  const stop = async () => {
    setDetailsId(undefined);
    const target = selectedProfile(); if (!target) return;
    setBusy(true); setMessage('正在停止请求并释放 Ollama 模型…');
    // Keep this open draft from restoring the previous automatic-analysis value.
    setDraft(current => ({ ...current, autoAnalyze: false }));
    try { setMessage(await onStopModels(target, keys[selected] ?? undefined)); }
    catch { setMessage('停止请求失败，请重试。'); } finally { setBusy(false); }
  };
  return <dialog className="settings-dialog" ref={dialog} onCancel={e => { e.preventDefault(); close(); }} aria-labelledby="settings-title">
    <div className="settings-heading"><div><span className="eyebrow">MAKE IT YOURS</span><h2 id="settings-title"><SlidersHorizontal size={21} />写作设置</h2></div><button className="icon-button" aria-label="关闭设置" disabled={busy && !testing} onClick={close}><X size={20} /></button></div>
    <div className="settings-content">
      <aside className="profile-list"><span className="eyebrow">模型配置</span>{draft.profiles.map(p => <button disabled={busy} className={p.id === selected ? 'selected' : ''} key={p.id} onClick={() => { const next = withHeaders(); if (next) { setDraft(next); select(next.profiles.find(n => n.id === p.id)!); } }}><span>{p.name}</span>{p.id === draft.defaultProfileId && <Check size={13} />}</button>)}
        <button className="add-profile" disabled={busy || draft.profiles.length >= 25} onClick={() => { const next = withHeaders(); if (!next) return; const p = makeProfile('custom', crypto.randomUUID()); setDraft({ ...next, profiles: [...next.profiles, p] }); select(p); }}><Plus size={15} />添加模型</button>
        <div className="local-note"><span className="small-leaf">⌘</span><p>你的写作空间，<br />由你选择模型。</p></div>
      </aside>
      <fieldset className="settings-fields" disabled={busy}>
        <div className="section-label">连接与模型 <button className="text-button danger" disabled={draft.profiles.length === 1 || busy} onClick={() => { const remaining = draft.profiles.filter(p => p.id !== selected); setDraft({ ...draft, profiles: remaining, defaultProfileId: draft.defaultProfileId === selected ? remaining[0].id : draft.defaultProfileId }); setKeys(k => Object.fromEntries(Object.entries(k).filter(([id]) => id !== selected))); select(remaining[0]); }}><Trash2 size={13} />删除配置</button></div>
        <div className="field-grid"><label>配置名称<input value={profile.name} onChange={e => patch({ name: e.target.value })} /></label><label>Provider<select aria-label="Provider" value={profile.kind} onChange={e => { const p = makeProfile(e.target.value as ModelProfile['kind'], selected); patch({ ...p, extraSystemPrompt: profile.extraSystemPrompt }); setHeaderText('{}'); }}>
          {Object.entries(presetInfo).map(([key, p]) => <option key={key} value={key}>{p.name}</option>)}</select></label></div>
        {profile.kind !== 'mock' ? <>
          <label>Base URL<input aria-label="Base URL" value={profile.baseUrl} onChange={e => patch({ baseUrl: e.target.value })} placeholder="https://api.example.com/v1" /></label>
          <label>Model<input aria-label="Model" value={profile.model} onChange={e => patch({ model: e.target.value })} /><small>填写服务端实际模型 ID，无需获取模型列表。</small></label>
          <label>额外系统提示词（可选）<textarea aria-label="额外系统提示词" value={profile.extraSystemPrompt} onChange={e => patch({ extraSystemPrompt: e.target.value })} maxLength={6000} rows={4} placeholder="例如：优先采用英式英语；解释简洁，侧重正式邮件中的语气。" /><small>仅用于当前模型配置，追加到内置要求后。保留中文说明和反馈格式；留空使用默认要求。{profile.extraSystemPrompt.length}/6000</small></label>
          <div className="field-grid"><label>认证方式<select aria-label="认证方式" value={profile.auth} onChange={e => patch({ auth: e.target.value as ModelProfile['auth'] })}><option value="bearer">Bearer API Key</option><option value="none">无需认证</option><option value="header">自定义认证 Header</option></select></label><label>Temperature（可选）<input type="number" min="0" max="2" step="0.1" placeholder="由模型决定" value={profile.temperature ?? ''} onChange={e => patch({ temperature: e.target.value === '' ? null : Number(e.target.value) })} /></label></div>
          {profile.auth === 'header' && <label>认证 Header 名称<input value={profile.authHeader} onChange={e => patch({ authHeader: e.target.value })} /></label>}
          {profile.auth !== 'none' && <>
            <label>API Key <span className="field-hint">{keys[selected] === null ? '保存后删除' : keyStatus[selected] ? '已保存密钥' : '尚未配置'}</span><input aria-label="API Key" type="password" autoComplete="off" value={keys[selected] ?? ''} placeholder="留空保留现有密钥" onChange={e => setKeys(k => { const next = { ...k }; if (e.target.value) next[selected] = e.target.value; else delete next[selected]; return next; })} /></label>
            <button className="text-button" onClick={() => setKeys(k => ({ ...k, [selected]: null }))}>删除已保存密钥</button>
            <label>或使用环境变量名称<input value={profile.envKey} placeholder="例如 OPENAI_API_KEY" onChange={e => patch({ envKey: e.target.value })} /><small>修改端点后须重新输入密钥；环境变量会发送到此处指定的端点。</small></label>
          </>}
          <details className="advanced"><summary>附加 Headers（非密钥）</summary><label>JSON 对象<textarea value={headerText} onChange={e => { setHeaderText(e.target.value); try { patch({ headers: JSON.parse(e.target.value) }); } catch { /* validated on save */ } }} spellCheck={false} rows={3} placeholder={'{"HTTP-Referer":"https://example.com"}'} /></label></details>
        </> : <div className="mock-settings"><strong>这是演示模式，不是真实 AI 评估</strong><p>仅用固定规则演示语法建议、良好表达和异步状态，不发送网络请求。</p><label>模拟响应<select aria-label="模拟响应" value={profile.mockBehavior} onChange={e => patch({ mockBehavior: e.target.value as ModelProfile['mockBehavior'] })}><option value="normal">正常响应</option><option value="slow">慢速响应（4 秒）</option><option value="error">模拟连接失败</option></select></label></div>}
        <div className="field-grid"><label>请求超时（秒）<input type="number" min="1" max="120" value={profile.timeoutMs / 1000} onChange={e => patch({ timeoutMs: Number(e.target.value) * 1000 })} /></label><label className="checkbox-field"><input type="checkbox" checked={draft.defaultProfileId === selected} onChange={() => setDraft({ ...draft, defaultProfileId: selected })} />设为当前及默认模型</label></div>
        <p className="field-hint">每次 HTTP 请求发出后开始计时，应用内排队不计入超时。{profile.kind === 'ollama' && '同一 Ollama 服务逐条分析；模型加载和生成时间计入请求超时。'}</p>
        <p className="field-hint">设置打开期间暂停写作分析；连接测试只调用当前页面的模型。Ollama 测试结束或取消后会释放测试模型，日常写作可用“停止并释放模型”结束运行。</p>
        <div className="section-label">编辑与外观</div>
        <label>修改后重新评估等待（毫秒）<input aria-label="修改后重新评估等待" type="number" min="1000" max="30000" step="100" value={draft.revisionDebounceMs} onChange={e => setDraft({ ...draft, revisionDebounceMs: Number(e.target.value) })} /><small>默认 3000 毫秒（3 秒），从最后一次修改起计时。等待和重新评估期间保留旧意见；全文反馈只在手动分析时更新。</small></label>
        <div className="field-grid"><label>主题<select value={draft.theme} onChange={e => setDraft({ ...draft, theme: e.target.value as Settings['theme'] })}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label><label>正文字号<input type="number" min="14" max="26" value={draft.fontSize} onChange={e => setDraft({ ...draft, fontSize: Number(e.target.value) })} /></label><label>停顿延迟（毫秒）<input aria-label="停顿延迟" type="number" min="300" max="10000" step="100" value={draft.debounceMs} onChange={e => setDraft({ ...draft, debounceMs: Number(e.target.value) })} /></label><label className="checkbox-field"><input type="checkbox" checked={draft.autoAnalyze} onChange={e => setDraft({ ...draft, autoAnalyze: e.target.checked })} />自动分析</label></div>
        <p className="privacy-note"><CheckCircle2 size={15} />文本只发送到你选定的服务。云端服务接收待分析句子和必要上下文；本地端点的数据处理由本地服务决定。“分析全文”会主动发送全文。密钥仅作为该端点的认证凭据使用，通过 Quillhaya 独立的系统安全存储加密保存，不写入日志。</p>
      </fieldset>
    </div>
    <footer className="settings-footer"><p role="status">{message}{detailsId && <button className="text-button test-details-button" disabled={busy} onClick={() => void showDetails()}>查看详情</button>}</p><div className="settings-footer-actions"><button className="text-button" disabled={busy} onClick={() => void stop()}><Power size={14} />停止并释放模型</button>{testing ? <button className="secondary-button" onClick={cancelTest}>取消测试</button> : <button className="secondary-button" disabled={busy} onClick={() => void test()}>测试连接</button>}<button className="primary-button" disabled={busy} onClick={() => void save()}>{busy ? '处理中…' : '保存设置'}</button></div></footer>
  </dialog>;
}
