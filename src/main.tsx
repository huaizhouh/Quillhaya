import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/app.css';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div className="boot-screen"><h1>界面遇到了问题</h1><p>请重新启动应用，最近的自动草稿会在启动时恢复。</p></div> : this.props.children; }
}
createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>);
