import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowDownToLine, ArrowRight, BookOpen, Check, ChevronDown, Clock3, FilePlus2, FileText, FolderOpen, Leaf, PanelRightClose, PanelRightOpen, Pause, Play, Plus, Settings2, Sparkles, TextCursorInput, X } from 'lucide-react';
import { WritingEditor, type EditorHandle } from './editor/WritingEditor';
import { FeedbackCard } from './components/FeedbackCard';
import { SettingsDialog } from './components/SettingsDialog';
import { AnalysisCoordinator, type FeedbackEntry } from './core/coordinator';
import { wordCount } from './core/sentences';
import { defaultSettings, modeLabels, type AnalysisRequest, type MenuCommand, type Settings, type WritingDocument, type WritingMode } from './models/schema';

const example = 'I think online courses are quite efficiency and convenience.\n\nStudents can study at their own pace and review difficult material whenever they need to. This flexibility is especially valuable for people who balance education with a full-time job.\n\nHowever, learning online also requires self-discipline. I believe a combination of online resources and classroom discussions offers the best of both worlds.';
const exampleTask = 'Some students prefer taking online courses, while others prefer studying in a traditional classroom. Which approach do you think is more effective, and why?';
const freshDocument = (): WritingDocument => ({ id: crypto.randomUUID(), name: '未命名.md', text: '', task: '', mode: 'discussion', dirty: false });

export default function App() {
  const [doc, setDoc] = useState<WritingDocument>(freshDocument);
  const docRef = useRef(doc); docRef.current = doc;
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [keyStatus, setKeyStatus] = useState<Record<string, boolean>>({});
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [entries, setEntries] = useState<FeedbackEntry[]>([]);
  const [full, setFull] = useState<FeedbackEntry | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(35);
  const [toast, setToast] = useState('');
  const [restored, setRestored] = useState(false);
  const [draftState, setDraftState] = useState('草稿已就绪');
  const [fileBusy, setFileBusy] = useState(false);
  const fileBusyRef = useRef(false);
  const [configVersion, setConfigVersion] = useState(0);
  const [composing, setComposing] = useState(false);
  const revision = useRef(0);
  const editor = useRef<EditorHandle>(null);
  const coordinator = useRef<AnalysisCoordinator | null>(null);
  const fullRequest = useRef<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const startTime = useRef<number | null>(null);
  const profile = settings.profiles.find(p => p.id === settings.defaultProfileId)!;
  const notify = useCallback((message: string) => setToast(message), []);
  const words = useMemo(() => wordCount(doc.text), [doc.text]);
  const visible = entries.filter(e => !e.ignored);
  const goodCount = visible.filter(e => e.result?.status === 'good').length;
  const revisionCount = visible.filter(e => e.result?.status === 'needs_revision').length;
  const activeCount = visible.filter(e => e.state === 'analyzing').length;
  const marks = useMemo(() => entries.filter(e => !e.ignored && e.result?.status === 'needs_revision').map(({ from, to }) => ({ from, to })), [entries]);

  useEffect(() => {
    if (!window.desktop) { setBootError('请使用 npm run dev 启动 Electron 桌面应用。'); return; }
    const engine = new AnalysisCoordinator(window.desktop, setEntries); coordinator.current = engine;
    void window.desktop.bootstrap().then(reply => {
      if (!reply.ok) { setBootError(reply.error.message); return; }
      setSettings(reply.value.settings); setKeyStatus(reply.value.keyStatus);
      if (reply.value.document) { setDoc(reply.value.document); setRestored(reply.value.restored); }
      if (reply.value.storageNotice) notify(reply.value.storageNotice);
      setReady(true);
    }).catch(() => setBootError('无法连接桌面服务，请重新启动应用。'));
    return () => { engine.dispose(); };
  }, [notify]);
  useEffect(() => { document.documentElement.dataset.theme = settings.theme; }, [settings.theme]);
  useEffect(() => {
    if (!ready) return;
    coordinator.current?.configure(settings.autoAnalyze, settings.debounceMs);
    coordinator.current?.update(doc.text, { documentId: doc.id, revision: revision.current, mode: doc.mode, task: doc.task, profileId: settings.defaultProfileId, configVersion }, composing);
  }, [ready, doc.id, doc.text, doc.mode, doc.task, settings.autoAnalyze, settings.debounceMs, settings.defaultProfileId, configVersion, composing]);
  useEffect(() => {
    if (fullRequest.current) { void window.desktop.cancel(fullRequest.current); fullRequest.current = null; }
    setFull(null);
  }, [doc.id, doc.text, doc.task, doc.mode, configVersion, settings.defaultProfileId]);
  useEffect(() => {
    if (!ready) return;
    setDraftState('正在保存草稿…');
    const timer = setTimeout(() => {
      void window.desktop.draft(doc).then(reply => setDraftState(reply.ok ? '草稿已自动保存' : `草稿保存失败：${reply.error.message}`), () => setDraftState('草稿保存失败，请手动保存文档'));
    }, 650);
    return () => clearTimeout(timer);
  }, [ready, doc]);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(''), 6000); return () => clearTimeout(timer); } }, [toast]);
  useEffect(() => {
    const timer = setInterval(() => { if (startTime.current) setElapsed(Math.floor((Date.now() - startTime.current) / 1000)); }, 1000);
    return () => clearInterval(timer);
  }, []);

  const changeText = useCallback((text: string, isComposing: boolean) => {
    if (text.length > 500_000) { notify('文档超过建议长度，请分成多个文件。'); }
    revision.current++;
    if (!startTime.current) startTime.current = Date.now();
    setComposing(isComposing);
    setDoc(d => ({ ...d, text, dirty: true }));
  }, [notify]);
  const saved = async (saveAs = false) => {
    const snapshot = docRef.current;
    const reply = await window.desktop.save(snapshot, saveAs);
    if (!reply.ok) { notify(reply.error.message); return false; }
    if (!reply.value) return false;
    const name = reply.value.name;
    setDoc(current => current.id === snapshot.id ? { ...current, name, dirty: current.text !== snapshot.text } : current);
    if (docRef.current.id === snapshot.id && docRef.current.text !== snapshot.text) {
      notify('已保存先前版本；保存期间的新输入仍在编辑器中，请再次保存。'); return false;
    }
    notify('Markdown 文档已保存'); return true;
  };
  const canLeave = async () => {
    if (!docRef.current.dirty) return true;
    const reply = await window.desktop.confirmDiscard();
    if (!reply.ok) { notify(reply.error.message); return false; }
    return reply.value === 'save' ? saved() : reply.value === 'discard';
  };
  const reset = (next: WritingDocument) => {
    revision.current = 0; startTime.current = null; setElapsed(0);
    setComposing(false); setDoc(next); setRestored(false); setTaskOpen(Boolean(next.task));
  };
  const action = async (command: MenuCommand | 'example') => {
    if (!ready || fileBusyRef.current) { if (command === 'close') void window.desktop.cancelClose(); return; }
    if (command === 'settings') { setSettingsOpen(true); return; }
    fileBusyRef.current = true; setFileBusy(true);
    try {
      if (command === 'save' || command === 'saveAs') { await saved(command === 'saveAs'); return; }
      if (!await canLeave()) { if (command === 'close') await window.desktop.cancelClose(); return; }
      if (command === 'new') reset(freshDocument());
      if (command === 'example') reset({ ...freshDocument(), name: 'Online learning.md', text: example, task: exampleTask, dirty: true });
      if (command === 'open') { const reply = await window.desktop.open(); if (reply.ok && reply.value) reset(reply.value); else if (!reply.ok) notify(reply.error.message); }
      if (command === 'close') { const reply = await window.desktop.close(docRef.current); if (!reply.ok) notify(reply.error.message); }
    } catch { if (command === 'close') void window.desktop.cancelClose(); notify('文件操作失败，请检查权限后重试。'); }
    finally { fileBusyRef.current = false; setFileBusy(false); }
  };
  const actionRef = useRef(action); actionRef.current = action;
  useEffect(() => { if (window.desktop) return window.desktop.onMenu(cmd => { void actionRef.current(cmd); }); }, []);

  const accept = (id: string) => {
    const entry = coordinator.current?.get(id);
    if (!entry?.result?.suggested_revision || entry.result.original_text !== entry.text || !editor.current?.apply(entry.from, entry.to, entry.text, entry.result.suggested_revision)) {
      notify(composing ? '请先完成当前输入，再接受修改。' : '原句已发生变化，请重新分析'); return;
    }
    notify('已接受修改 · 可使用 ⌘Z 撤销');
  };
  const saveSettings = (next: Settings, status = keyStatus) => { setSettings(next); setKeyStatus(status); setConfigVersion(v => v + 1); };
  const toggleAuto = async () => {
    const next = { ...settings, autoAnalyze: !settings.autoAnalyze };
    const reply = await window.desktop.saveSettings(next, {});
    if (reply.ok) { setSettings(reply.value.settings); setKeyStatus(reply.value.keyStatus); }
    else notify(reply.error.message);
  };
  const switchModel = async (id: string) => {
    const reply = await window.desktop.saveSettings({ ...settings, defaultProfileId: id }, {});
    if (reply.ok) saveSettings(reply.value.settings, reply.value.keyStatus); else notify(reply.error.message);
  };
  const analyzeSelection = () => {
    const selection = editor.current?.selection();
    if (!selection || selection.from === selection.to) { notify('先在正文中选择需要分析的内容。'); return; }
    coordinator.current?.analyze(selection); setCollapsed(false);
  };
  const analyzeFull = async () => {
    const snapshot = docRef.current;
    if (!snapshot.text.trim()) { notify('先写下一些内容，再分析全文。'); return; }
    if (snapshot.text.length > 50_000) { notify('全文分析支持最多 50,000 字符，请分段分析。'); return; }
    if (fullRequest.current) void window.desktop.cancel(fullRequest.current);
    const id = crypto.randomUUID(); fullRequest.current = id;
    const request: AnalysisRequest = { request_id: id, document_id: snapshot.id, revision_id: revision.current, sentence_id: 'document-review', original_text: snapshot.text, from: 0, to: snapshot.text.length, scope: 'document', mode: snapshot.mode, context: { before: [], after: [], task: snapshot.task }, profile_id: profile.id };
    const entry: FeedbackEntry = { id: 'document-review', text: '全文 · 结构、连贯性与任务回应', from: 0, to: snapshot.text.length, complete: true, signature: id, state: 'analyzing' };
    setFull(entry); setCollapsed(false);
    try {
      const reply = await window.desktop.analyze(request);
      if (fullRequest.current !== id || docRef.current.id !== snapshot.id || docRef.current.text !== snapshot.text) return;
      setFull(reply.ok ? { ...entry, state: 'done', result: reply.value } : { ...entry, state: 'error', error: reply.error });
    } catch { if (fullRequest.current === id) setFull({ ...entry, state: 'error', error: { code: 'ipc', message: '全文分析失败，请重试。', retryable: true } }); }
    finally { if (fullRequest.current === id) fullRequest.current = null; }
  };

  if (bootError) return <div className="boot-screen"><Leaf size={34} /><h1>TOEFL Writing Assistant</h1><p>{bootError}</p></div>;
  if (!ready) return <div className="boot-screen"><Leaf size={34} /><p>正在打开你的写作空间…</p></div>;
  return <div className="app-shell" style={{ '--editor-font-size': `${settings.fontSize}px`, '--sidebar-width': `${sidebarWidth}%` } as CSSProperties}>
    <header className="titlebar"><div className="app-brand"><span className="brand-mark"><Leaf size={16} /></span><span>TOEFL <b>Writing Assistant</b></span></div><div className="titlebar-actions"><span className="local-indicator"><span />本地写作空间</span><button className="icon-button" aria-label="打开设置" title="设置 ⌘," onClick={() => setSettingsOpen(true)}><Settings2 size={17} /></button></div></header>
    <div className="workspace-toolbar"><div className="document-info"><FileText size={18} /><span className="document-name">{doc.name}</span><span className={`save-pill ${doc.dirty ? 'unsaved' : ''}`}>{doc.dirty ? '未保存至文件' : '已保存'}</span></div><div className="file-actions"><button className="icon-button" aria-label="新建文档" title="新建 ⌘N" disabled={fileBusy} onClick={() => void action('new')}><FilePlus2 size={17} /></button><button className="icon-button" aria-label="打开文档" title="打开 ⌘O" disabled={fileBusy} onClick={() => void action('open')}><FolderOpen size={18} /></button><button className="secondary-button compact" disabled={fileBusy} onClick={() => void action('save')}><ArrowDownToLine size={15} />保存<span className="shortcut">⌘S</span></button><span className="toolbar-divider" /><button className="icon-button" aria-label={collapsed ? '展开反馈' : '折叠反馈'} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelRightOpen size={19} /> : <PanelRightClose size={19} />}</button></div></div>
    {restored && <div className="restore-banner"><Check size={14} />已恢复上次会话。自动草稿不会覆盖原始 Markdown 文件。<button aria-label="关闭恢复提示" className="icon-button" onClick={() => setRestored(false)}><X size={14} /></button></div>}
    <main className={`workspace ${collapsed ? 'feedback-collapsed' : ''}`}>
      <section className="writing-pane" aria-label="写作区">
        <div className="writing-controls"><div className="mode-control"><BookOpen size={16} /><select aria-label="写作模式" value={doc.mode} onChange={e => { revision.current++; setDoc({ ...doc, mode: e.target.value as WritingMode }); }}>{Object.entries(modeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><span className="markdown-label">MARKDOWN</span></div>
        <div className={`task-box ${taskOpen ? 'open' : ''}`}><button className="task-toggle" onClick={() => setTaskOpen(!taskOpen)} aria-expanded={taskOpen}><span><span className="task-icon"><TextCursorInput size={15} /></span><span>写作题目与情境<small>{doc.task ? ' 已添加上下文' : ' 给反馈一点方向（选填）'}</small></span></span><ChevronDown size={15} /></button>{taskOpen && <textarea aria-label="写作题目与情境" value={doc.task} maxLength={6000} rows={3} placeholder="粘贴教授的问题、同学观点或邮件情境。这些内容不计入作文字数。" onChange={e => { revision.current++; setDoc({ ...doc, task: e.target.value }); }} />}</div>
        <div className="page-heading"><span className="eyebrow">YOUR WORDS, YOUR VOICE</span><div><h1>{doc.mode === 'email' ? 'A little clarity goes a long way.' : doc.mode === 'general' ? 'Every thought begins somewhere.' : 'Good writing starts with you.'}</h1><p>让想法先落在纸上，表达可以慢慢打磨。</p></div></div>
        <WritingEditor ref={editor} documentId={doc.id} initialText={doc.text} onChange={changeText} onComposition={setComposing} marks={marks} />
        {!doc.text && <div className="example-link"><button onClick={() => void action('example')}>没有头绪？用一段示例探索<ArrowRight size={14} /></button></div>}
        <footer className="editor-footer"><span><b>{words}</b> words <span className="footer-dot">·</span> <Clock3 size={13} />{String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}</span><span className="draft-status" role="status"><Check size={12} />{draftState}</span></footer>
      </section>
      {!collapsed && <>
        <div className="splitter" role="separator" aria-label="调整反馈栏宽度" aria-orientation="vertical" aria-valuenow={sidebarWidth} aria-valuemin={27} aria-valuemax={48} tabIndex={0} onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setSidebarWidth(v => Math.min(48, Math.max(27, v + (e.key === 'ArrowLeft' ? 2 : -2)))); } }} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) setSidebarWidth(Math.min(48, Math.max(27, (1 - e.clientX / window.innerWidth) * 100))); }} onPointerUp={e => e.currentTarget.releasePointerCapture(e.pointerId)} />
        <aside className="feedback-pane" aria-label="AI Writing Feedback">
          <div className="feedback-header"><span className="eyebrow">A SECOND PAIR OF EYES</span><div><h2><Sparkles size={20} />写作反馈</h2><button className="icon-button" aria-label={settings.autoAnalyze ? '暂停自动分析' : '恢复自动分析'} title={settings.autoAnalyze ? '暂停自动分析' : '恢复自动分析'} onClick={() => void toggleAuto()}>{settings.autoAnalyze ? <Pause size={16} /> : <Play size={16} />}</button></div><p>只在有必要时，给你一点建议。</p><div className="model-status"><span className={settings.autoAnalyze ? 'live-dot' : 'paused-dot'} /><select aria-label="当前模型" value={settings.defaultProfileId} onChange={e => void switchModel(e.target.value)}>{settings.profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>{profile.kind === 'mock' && <span className="demo-badge">演示</span>}<span className="analysis-state">{!settings.autoAnalyze ? '已暂停' : activeCount ? `${activeCount} 句分析中` : '自动分析已开启'}</span></div></div>
          <div className="feedback-summary"><span><i className="summary-dot amber" />{revisionCount} 条建议</span><span><i className="summary-dot green" />{goodCount} 句表达良好</span><button className="text-button" title="只发送选中内容所在的句子与必要上下文" onClick={analyzeSelection}>分析选中内容</button></div>
          <div className="feedback-scroll">
            {full && <FeedbackCard entry={full} index={0} onIgnore={() => setFull(null)} onRetry={() => void analyzeFull()} onLocate={() => editor.current?.locate(0, 0)} notify={notify} />}
            {visible.length ? visible.map((entry, index) => <FeedbackCard key={entry.id} entry={entry} index={index} onAccept={() => accept(entry.id)} onIgnore={() => coordinator.current?.ignore(entry.id)} onRetry={() => coordinator.current?.analyze(undefined, entry.id)} onLocate={() => editor.current?.locate(entry.from, entry.to)} notify={notify} />) : <div className="feedback-empty"><div className="empty-illustration"><div className="mini-page"><span /><span /><span /><div><Check size={15} /></div></div><span className="mini-spark">✧</span></div><h3>给思考留出空间。</h3><p>写下第一句英语，<br />中文反馈就会在这里等你。</p><div className="empty-principles"><span><Check size={14} />保留你的原意与语气</span><span><Check size={14} />自然的表达，无需修改</span><span><Check size={14} />是否接受，由你决定</span></div>{profile.kind === 'mock' && <button className="secondary-button" onClick={() => void action('example')}><Plus size={14} />体验示例反馈</button>}</div>}
            {profile.kind === 'mock' && visible.length > 0 && <p className="demo-footnote">MOCK 演示 · 固定规则，仅展示交互。<br />在设置中连接真实模型，获取实际写作反馈。</p>}
          </div>
          <footer className="feedback-footer"><button className="analyze-button" disabled={full?.state === 'analyzing'} onClick={() => void analyzeFull()}><Sparkles size={16} />分析全文<ArrowRight size={15} /></button><p>主动发送全文 · 关注结构与连贯性</p></footer>
        </aside>
      </>}
    </main>
    {toast && <div className="toast" role="status">{toast}<button className="icon-button" aria-label="关闭提示" onClick={() => setToast('')}><X size={14} /></button></div>}
    {settingsOpen && <SettingsDialog settings={settings} keyStatus={keyStatus} onSaved={saveSettings} onClose={() => setSettingsOpen(false)} />}
  </div>;
}
