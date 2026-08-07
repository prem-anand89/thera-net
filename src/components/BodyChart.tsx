import { useEffect, useRef, useState } from 'react';
import bodyChartUrl from '@/assets/body-chart.png';
import type { BodyChartMark } from '@/domain/coreAssessment';

const MARK_COLORS: Record<BodyChartMark['type'], string> = {
  pain: '#E24B4A',
  numbness: '#534AB7',
  stiffness: '#BA7517',
  referred: '#1D9E75',
};

const MARK_LABELS: Record<BodyChartMark['type'], string> = {
  pain: 'Pain',
  numbness: 'Numbness / tingling',
  stiffness: 'Stiffness',
  referred: 'Referred',
};

const MARK_TYPES: BodyChartMark['type'][] = ['pain', 'numbness', 'stiffness', 'referred'];

/** Loaded once per module — every BodyChart instance shares the same decoded
 *  image rather than re-fetching/re-decoding on each mount. */
const bodyImg = new Image();
bodyImg.src = bodyChartUrl;

/** Tap-to-mark body chart (front/back/left-lateral) — ported from the
 *  reference HTML's canvas-based rBody/initCanvas/drawBody/setBMT. Marks are
 *  stored as normalized (0..1) fractions so they stay aligned across any
 *  canvas size (phone/iPad/laptop). */
export function BodyChart({
  marks,
  onChange,
  disabled,
}: {
  marks: BodyChartMark[];
  onChange: (marks: BodyChartMark[]) => void;
  disabled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [activeType, setActiveType] = useState<BodyChartMark['type']>('pain');

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (bodyImg.complete && bodyImg.naturalWidth) {
      ctx.drawImage(bodyImg, 0, 0, w, h);
    } else {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
    }
    for (const m of marks) {
      const mx = m.nx * w;
      const my = m.ny * h;
      const col = MARK_COLORS[m.type];
      ctx.fillStyle = `${col}bb`;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(mx, my, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(mx - 3, my - 3);
      ctx.lineTo(mx + 3, my + 3);
      ctx.moveTo(mx + 3, my - 3);
      ctx.lineTo(mx - 3, my + 3);
      ctx.stroke();
    }
  }

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marks]);

  useEffect(() => {
    if (bodyImg.complete) return;
    bodyImg.onload = () => draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once; draw reads current marks via closure at load time
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!host) return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(host);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- observer set up once per mount
  }, []);

  function handleTap(e: React.MouseEvent<HTMLCanvasElement>) {
    if (disabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    let found = -1;
    for (let i = 0; i < marks.length; i++) {
      const dx = (marks[i].nx - nx) * rect.width;
      const dy = (marks[i].ny - ny) * rect.height;
      if (Math.sqrt(dx * dx + dy * dy) < 16) {
        found = i;
        break;
      }
    }
    if (found >= 0) {
      onChange(marks.filter((_, i) => i !== found));
    } else {
      onChange([...marks, { id: crypto.randomUUID(), nx, ny, type: activeType }]);
    }
  }

  return (
    <div>
      <div className="bc-mkbtns">
        {MARK_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            className={`mkb${activeType === t ? ' active' : ''}`}
            style={activeType === t ? { background: MARK_COLORS[t], borderColor: MARK_COLORS[t] } : undefined}
            disabled={disabled}
            onClick={() => setActiveType(t)}
          >
            {MARK_LABELS[t]}
          </button>
        ))}
        <button type="button" className="mkb" style={{ marginLeft: 'auto' }} disabled={disabled || marks.length === 0} onClick={() => onChange([])}>
          Clear
        </button>
      </div>
      <div className="bc-canvas-wrap">
        <canvas ref={canvasRef} className="bc-canvas" onClick={handleTap} />
      </div>
      <div className="bc-legend">
        {MARK_TYPES.map((t) => (
          <div className="bc-legend-item" key={t}>
            <span className="bc-legend-dot" style={{ background: MARK_COLORS[t] }} />
            {MARK_LABELS[t]}
          </div>
        ))}
      </div>
    </div>
  );
}
