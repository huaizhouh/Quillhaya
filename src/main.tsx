import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import type { WritingDocument } from './models/schema';
import './styles/app.css';

class ErrorBoundary extends React.Component<Record<string, never>, { failed: boolean; recovery: string }> {
  state = { failed: false, recovery: '正在保存最近的草稿…' };
  private snapshot?: WritingDocument;
  private onSnapshot = (document: WritingDocument) => { this.snapshot = document; };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() {
    void window.desktop.rendererFailed(this.snapshot).then(reply => {
      this.setState({ recovery: reply.ok ? '最近的草稿已保留。可重新载入，或使用 ⌘Q 退出。' : '草稿保存失败。请先复制下方正文，再重新载入。' });
    }, () => this.setState({ recovery: '无法连接桌面服务。请先复制下方正文。' }));
  }
  render() { return this.state.failed ? <div className="boot-screen"><h1>界面遇到了问题</h1><p>{this.state.recovery}</p><button onClick={() => window.location.reload()}>重新载入</button>{this.snapshot && <textarea aria-label="恢复正文" readOnly value={this.snapshot.text} />}</div> : <App onSnapshot={this.onSnapshot} />; }
}
createRoot(document.getElementById('root')!).render(<ErrorBoundary />);
