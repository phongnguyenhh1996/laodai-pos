// Dựng lại cây JSON (từ ser.js) vào một frame Figma có sẵn (xoá nội dung cũ, giữ id/tên/vị trí).
window.__build = async function (key, frameId, opts = {}) {
  const data = await fetch('http://127.0.0.1:8799/' + key).then((r) => { if (!r.ok) throw new Error('no data ' + key); return r.json(); });
  const frame = await figma.getNodeByIdAsync(frameId);
  if (!frame) throw new Error('no frame ' + frameId);
  const weights = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };
  const famMap = (ff) => (/vietnam/i.test(ff) ? 'Be Vietnam Pro' : /mono|menlo|courier/i.test(ff) ? 'Roboto Mono' : 'Be Vietnam Pro');
  const fontKey = (n) => ({ family: famMap(n.ff), style: (weights[Math.round(n.fw / 100) * 100] || 'Regular') + (n.italic ? ' Italic' : '') }).style.replace('Regular Italic', 'Italic');
  const fontName = (n) => { const family = famMap(n.ff); let style = weights[Math.round(n.fw / 100) * 100] || 'Regular'; if (n.italic) style = style === 'Regular' ? 'Italic' : style + ' Italic'; return { family, style }; };
  // nạp font
  const need = new Map(); (function scan(a) { for (const n of a) { if (n.t === 't') { const f = fontName(n); need.set(f.family + '|' + f.style, f); } if (n.ch) scan(n.ch); } })(data.ch);
  for (const f of need.values()) { try { await figma.loadFontAsync(f); } catch (e) { await figma.loadFontAsync({ family: f.family, style: f.style.replace(' Italic', '') || 'Regular' }); } }
  await figma.loadFontAsync({ family: 'Be Vietnam Pro', style: 'Regular' });
  const solid = (c) => ({ type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: c.a });
  const gradPaint = (g, w, h) => {
    const a = (g.angle - 90) * Math.PI / 180; const cos = Math.cos(a), sin = Math.sin(a);
    // ma trận gradientTransform theo hướng CSS (xấp xỉ)
    return { type: 'GRADIENT_LINEAR', gradientTransform: [[cos, sin, 0.5 - cos / 2 - sin / 2], [-sin, cos, 0.5 + sin / 2 - cos / 2]], gradientStops: g.stops.map((s) => ({ position: Math.max(0, Math.min(1, s.pos)), color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a } })) };
  };
  let count = 0;
  async function make(n, parent, ox, oy) {
    count++;
    if (n.t === 't') {
      const t = figma.createText();
      const fn = fontName(n);
      try { t.fontName = fn; } catch (e) { t.fontName = { family: fn.family, style: 'Regular' }; }
      t.characters = n.s;
      t.fontSize = n.fs;
      const lh = n.lh || Math.round(n.fs * 1.25);
      t.lineHeight = { value: lh, unit: 'PIXELS' };
      if (n.ls) t.letterSpacing = { value: n.ls, unit: 'PIXELS' };
      if (n.color) t.fills = [solid(n.color)];
      if (n.deco && n.deco.includes('line-through')) t.textDecoration = 'STRIKETHROUGH';
      if (n.deco && n.deco.includes('underline')) t.textDecoration = 'UNDERLINE';
      parent.appendChild(t);
      const lines = n.lines || 1;
      // hộp dòng: rect của Range là vùng glyph, căn giữa trong line-height
      const glyphH = n.h / lines;
      const top = n.y - (lh - glyphH) / 2;
      if (n.fixedW) { t.textAutoResize = 'HEIGHT'; t.resize(Math.max(1, n.fixedW), lh); t.textAlignHorizontal = n.align === 'center' ? 'CENTER' : n.align === 'right' || n.align === 'end' ? 'RIGHT' : 'LEFT'; }
      else if (lines > 1) { t.textAutoResize = 'HEIGHT'; t.resize(Math.ceil(n.w) + 2, lh * lines); t.textAlignHorizontal = n.align === 'center' ? 'CENTER' : n.align === 'right' || n.align === 'end' ? 'RIGHT' : 'LEFT'; }
      else { t.textAutoResize = 'WIDTH_AND_HEIGHT'; }
      t.x = n.x - ox - (lines > 1 && t.textAlignHorizontal === 'CENTER' ? 1 : 0); t.y = top - oy;
      t.name = n.s.slice(0, 40);
      return;
    }
    if (n.t === 'v') {
      let v;
      try { v = figma.createNodeFromSvg(n.svg); } catch (e) { v = figma.createFrame(); v.fills = []; }
      parent.appendChild(v);
      v.x = n.x - ox; v.y = n.y - oy; v.name = 'icon';
      if (n.op < 1) v.opacity = n.op;
      return;
    }
    if (n.t === 'i') {
      const r = figma.createRectangle();
      parent.appendChild(r);
      r.x = n.x - ox; r.y = n.y - oy; r.resize(Math.max(0.01, n.w), Math.max(0.01, n.h));
      const bytes = Uint8Array.from(atob(n.data), (c) => c.charCodeAt(0));
      const img = figma.createImage(bytes);
      r.fills = [{ type: 'IMAGE', imageHash: img.hash, scaleMode: 'FILL' }];
      r.name = 'image';
      return;
    }
    const f = figma.createFrame();
    parent.appendChild(f);
    f.name = n.name || 'box';
    f.x = n.x - ox; f.y = n.y - oy; f.resize(Math.max(0.01, n.w), Math.max(0.01, n.h));
    const fills = [];
    if (n.bg) fills.push(solid(n.bg));
    if (n.grad) fills.push(gradPaint(n.grad, n.w, n.h));
    f.fills = fills;
    f.clipsContent = !!n.clip;
    if (n.rad) { [f.topLeftRadius, f.topRightRadius, f.bottomRightRadius, f.bottomLeftRadius] = n.rad; }
    if (n.bc && n.bw && n.bw.some((w) => w > 0)) {
      f.strokes = [solid(n.bc)]; f.strokeAlign = 'INSIDE';
      const [t, r, b, l] = n.bw;
      if (t === r && r === b && b === l) f.strokeWeight = t; else { f.strokeTopWeight = t; f.strokeRightWeight = r; f.strokeBottomWeight = b; f.strokeLeftWeight = l; }
    } else if (n.outline && n.outline.color) { f.strokes = [solid(n.outline.color)]; f.strokeAlign = 'OUTSIDE'; f.strokeWeight = n.outline.w; }
    const eff = [];
    for (const s of n.sh || []) { const e = { type: s.inset ? 'INNER_SHADOW' : 'DROP_SHADOW', color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a }, offset: { x: s.x, y: s.y }, radius: s.blur, spread: s.spread, visible: true, blendMode: 'NORMAL' }; if (!s.inset) e.showShadowBehindNode = false; eff.push(e); }
    if (eff.length) f.effects = eff.reverse();
    if (n.op < 1) f.opacity = n.op;
    for (const c of n.ch || []) await make(c, f, n.x, n.y);
  }
  // xoá nội dung cũ
  for (const c of [...frame.children]) c.remove();
  frame.layoutMode = 'NONE';
  frame.resize(data.w, opts.height || data.h);
  frame.fills = [solid(data.bg)];
  frame.clipsContent = true;
  frame.effects = []; frame.strokes = [];
  [frame.topLeftRadius, frame.topRightRadius, frame.bottomRightRadius, frame.bottomLeftRadius] = [0, 0, 0, 0];
  for (const c of data.ch) await make(c, frame, 0, 0);
  return { frame: frame.name, nodes: count, w: data.w, h: frame.height };
};
'build loaded';
