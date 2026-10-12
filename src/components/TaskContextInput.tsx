import { useRef, useState } from 'react';

const MIN_HEIGHT = 80, MAX_HEIGHT = 220;
export function TaskContextInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [height, setHeight] = useState(96);
  const drag = useRef({ y: 0, height: 96 });
  const resize = (next: number) => setHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, next)));
  return <div className="task-input">
    <textarea aria-label="写作题目与情境" value={value} maxLength={6000} style={{ height }} placeholder="粘贴教授的问题、同学观点或邮件情境。这些内容不计入作文字数。" onChange={e => onChange(e.target.value)} />
    <div className="task-resize" role="separator" aria-label="调整题目区域高度" aria-orientation="horizontal" aria-valuemin={MIN_HEIGHT} aria-valuemax={MAX_HEIGHT} aria-valuenow={height} tabIndex={0} title="拖动调整高度，或使用上下方向键"
      onPointerDown={e => { e.preventDefault(); drag.current = { y: e.clientY, height }; e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) resize(drag.current.height + e.clientY - drag.current.y); }}
      onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
      onKeyDown={e => {
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault(); resize(e.key === 'Home' ? MIN_HEIGHT : e.key === 'End' ? MAX_HEIGHT : height + (e.key === 'ArrowDown' ? 16 : -16));
      }}><span /></div>
  </div>;
}
