/**
 * Chart PNG Export Utility (`dashboard-ui/src/utils/chartExport.ts`)
 *
 * Clones a Recharts `<svg>` inside the given container, draws it onto a 2× Retina `<canvas>`
 * with a theme-aware background and title header, copies the PNG to the system clipboard,
 * and falls back to downloading a `.png` file if the Clipboard API is unavailable.
 */
export async function copyChartContainerAsPng(
  container: HTMLElement | null,
  title: string,
  theme: 'dark' | 'light' = 'dark'
): Promise<'copied' | 'downloaded' | 'failed'> {
  if (!container) return 'failed';
  const svg = container.querySelector('svg.recharts-surface') || container.querySelector('svg');
  if (!svg) return 'failed';

  const rect = svg.getBoundingClientRect();
  const w = Math.max(Math.round(rect.width), 520);
  const h = Math.max(Math.round(rect.height), 240);
  const padTop = 34;
  const padX = 14;
  const scale = 2;

  const cloned = svg.cloneNode(true) as SVGSVGElement;
  cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  cloned.setAttribute('width', String(w));
  cloned.setAttribute('height', String(h));

  const svgData = new XMLSerializer().serializeToString(cloned);
  const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = (w + padX * 2) * scale;
        canvas.height = (h + padTop + 12) * scale;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          resolve('failed');
          return;
        }
        ctx.scale(scale, scale);
        ctx.fillStyle = theme === 'light' ? '#FFFFFF' : '#0B0F19';
        ctx.fillRect(0, 0, w + padX * 2, h + padTop + 12);
        ctx.fillStyle = theme === 'light' ? '#0F172A' : '#F9FAFB';
        ctx.font = 'bold 12px Inter, system-ui, sans-serif';
        ctx.fillText(title, padX, 22);
        ctx.drawImage(img, padX, padTop, w, h);
        URL.revokeObjectURL(url);

        canvas.toBlob(async (pngBlob) => {
          if (!pngBlob) {
            resolve('failed');
            return;
          }
          if (navigator.clipboard && 'ClipboardItem' in window) {
            try {
              await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': pngBlob }),
              ]);
              resolve('copied');
              return;
            } catch {
              // Fall back to download
            }
          }
          const dlUrl = URL.createObjectURL(pngBlob);
          const a = document.createElement('a');
          a.href = dlUrl;
          a.download = `${title.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toLowerCase()}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(dlUrl), 1000);
          resolve('downloaded');
        }, 'image/png');
      } catch {
        URL.revokeObjectURL(url);
        resolve('failed');
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve('failed');
    };
    img.src = url;
  });
}
