import type { InputImage } from './llm';
export async function prepareImages(files: File[]): Promise<InputImage[]> {
  const output: InputImage[] = [];
  for (const [index, file] of files.entries()) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('仅支持 JPG、PNG 和 WebP 图片。');
    if (file.size > 15 * 1024 * 1024) throw new Error('单张图片请控制在15MB以内。');
    const bitmap = await createImageBitmap(file);
    try {
      const width = Math.min(1280, bitmap.width), scale = width / bitmap.width, height = Math.round(bitmap.height * scale);
      const sliceHeight = height > width * 1.6 ? Math.round(width * 1.6) : height;
      const step = Math.max(1, Math.round(sliceHeight * 0.9));
      for (let y = 0; y < height; y += step) {
        if (output.length >= 30) throw new Error('长图分片超过30张，请减少图片或分批检查。');
        const h = Math.min(sliceHeight, height - y);
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = h;
        const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('浏览器无法处理图片，请改用文字输入。');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, h);
        ctx.drawImage(bitmap, 0, y / scale, bitmap.width, h / scale, 0, 0, width, h);
        output.push({ data: canvas.toDataURL('image/jpeg', 0.86), sourceIndex: index + 1 });
        canvas.width = canvas.height = 1;
        if (y + h >= height) break;
      }
    } finally { bitmap.close(); }
  }
  return output;
}
