// Chụp DOM hiện tại thành cây JSON (toạ độ tuyệt đối trên trang) để dựng lại trên Figma.
window.__ser = async function (opts = {}) {
  const sx = scrollX, sy = scrollY;
  const parseColor = (c) => {
    if (!c || c === 'transparent') return null;
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    const a = p.length > 3 ? p[3] : 1;
    if (a === 0) return null;
    return { r: p[0] / 255, g: p[1] / 255, b: p[2] / 255, a };
  };
  const splitTop = (s) => { const out = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { out.push(cur.trim()); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; };
  const parseShadows = (s) => {
    if (!s || s === 'none') return [];
    return splitTop(s).map((part) => {
      const inset = /\binset\b/.test(part);
      const cm = part.match(/rgba?\([^)]+\)/);
      const color = cm ? parseColor(cm[0]) : null;
      const nums = part.replace(/rgba?\([^)]+\)/, '').replace('inset', '').trim().split(/\s+/).map(parseFloat);
      return color ? { inset, color, x: nums[0] || 0, y: nums[1] || 0, blur: nums[2] || 0, spread: nums[3] || 0 } : null;
    }).filter(Boolean);
  };
  const parseGradient = (s) => {
    if (!s || !s.includes('linear-gradient')) return null;
    const inner = s.slice(s.indexOf('linear-gradient(') + 16, s.lastIndexOf(')'));
    const parts = splitTop(inner);
    let angle = 180;
    if (/deg$/.test(parts[0])) { angle = parseFloat(parts.shift()); }
    else if (/^to /.test(parts[0])) { const d = parts.shift(); angle = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270, 'to bottom right': 135, 'to top right': 45, 'to bottom left': 225, 'to top left': 315 }[d] ?? 180; }
    const stops = parts.map((p, i) => { const cm = p.match(/rgba?\([^)]+\)/); const pm = p.match(/([\d.]+)%\s*$/); return { color: cm ? parseColor(cm[0]) || { r: 0, g: 0, b: 0, a: 0 } : { r: 0, g: 0, b: 0, a: 0 }, pos: pm ? parseFloat(pm[1]) / 100 : i / Math.max(1, parts.length - 1) }; });
    return { angle, stops };
  };
  const box = (r) => ({ x: r.left + sx, y: r.top + sy, w: r.width, h: r.height });
  const visible = (cs) => cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0;
  const fontOf = (cs) => ({ ff: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(), fw: parseInt(cs.fontWeight, 10) || 400, fs: parseFloat(cs.fontSize), lh: cs.lineHeight === 'normal' ? null : parseFloat(cs.lineHeight), ls: cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing), color: parseColor(cs.color), align: cs.textAlign, tt: cs.textTransform, italic: cs.fontStyle === 'italic', deco: cs.textDecorationLine });
  const xform = (s, tt) => tt === 'uppercase' ? s.toUpperCase() : tt === 'lowercase' ? s.toLowerCase() : s;

  const textNode = (tn, cs) => {
    const raw = tn.textContent;
    const pre = /pre/.test(cs.whiteSpace);
    let s = pre ? raw : raw.replace(/\s+/g, ' ');
    if (!s.trim()) return null;
    const range = document.createRange(); range.selectNodeContents(tn);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    if (!rects.length) return null;
    const b = range.getBoundingClientRect();
    // gộp các dòng theo toạ độ y
    const lines = []; for (const r of rects) { const l = lines.find((q) => Math.abs(q.top - r.top) < 2); if (l) { l.left = Math.min(l.left, r.left); l.right = Math.max(l.right, r.right); } else lines.push({ top: r.top, left: r.left, right: r.right, h: r.height }); }
    // bỏ khoảng trắng đầu/cuối khi không pre
    if (!pre) {
      const w = (i) => { const rg = document.createRange(); rg.setStart(tn, i); rg.setEnd(tn, i + 1); const rr = rg.getBoundingClientRect(); return rr.width; };
      const lead = raw.length - raw.replace(/^\s+/, '').length, trail = raw.length - raw.replace(/\s+$/, '').length;
      if (lead && !(w(lead - 1) > 0)) s = s.replace(/^ /, '');
      if (trail && !(w(raw.length - 1) > 0)) s = s.replace(/ $/, '');
    }
    const f = fontOf(cs);
    if (lines.length > 1 && !pre) {
      // tách theo dòng hiển thị: đo từng ký tự
      const out = []; let cur = null;
      const rg = document.createRange();
      for (let i = 0; i < raw.length; i++) {
        rg.setStart(tn, i); rg.setEnd(tn, i + 1);
        const rr = rg.getClientRects()[0];
        if (!rr) { if (cur) cur.s += raw[i]; continue; }
        if (!cur || Math.abs(rr.top - cur.top) > 2) { if (cur) out.push(cur); cur = { top: rr.top, left: rr.left, right: rr.right, bottom: rr.bottom, s: '' }; }
        cur.s += raw[i]; if (rr.width > 0) cur.right = Math.max(cur.right, rr.right); cur.bottom = Math.max(cur.bottom, rr.bottom);
      }
      if (cur) out.push(cur);
      return out.map((l) => {
        let t = l.s.replace(/\s+/g, ' ');
        const lead = /^\s/.test(l.s);
        t = t.replace(/^ /, '').replace(/ $/, '');
        if (!t) return null;
        let left = l.left;
        if (lead) { const sp = document.createRange(); }
        return { t: 't', x: left + sx, y: l.top + sy, w: l.right - l.left, h: l.bottom - l.top, s: xform(t, f.tt), lines: 1, ...f };
      }).filter(Boolean);
    }
    return { t: 't', ...box(b), s: xform(s, f.tt), lines: lines.length, ...f };
  };

  async function svgNode(el, cs) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    const clone = el.cloneNode(true);
    clone.setAttribute('width', r.width); clone.setAttribute('height', r.height);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const col = cs.color;
    // gán màu tính toán cho từng phần tử (currentColor, fill/stroke từ CSS)
    const src = [el, ...el.querySelectorAll('*')], dst = [clone, ...clone.querySelectorAll('*')];
    src.forEach((s, i) => { const c = getComputedStyle(s); const d = dst[i]; if (!d.setAttribute) return; const fill = c.fill, stroke = c.stroke; if (fill && fill !== 'none') d.setAttribute('fill', fill); else if (s.getAttribute('fill') === 'none' || fill === 'none') d.setAttribute('fill', 'none'); if (stroke && stroke !== 'none') d.setAttribute('stroke', stroke); if (c.strokeWidth && s !== el) d.setAttribute('stroke-width', c.strokeWidth); if (c.opacity !== '1') d.setAttribute('opacity', c.opacity); });
    let html = new XMLSerializer().serializeToString(clone).replace(/currentColor/g, col);
    return { t: 'v', ...box(r), svg: html, op: parseFloat(cs.opacity) };
  }

  async function imgNode(el) {
    const r = el.getBoundingClientRect();
    try {
      const c = document.createElement('canvas'); c.width = el.naturalWidth || r.width; c.height = el.naturalHeight || r.height;
      c.getContext('2d').drawImage(el, 0, 0, c.width, c.height);
      return { t: 'i', ...box(r), data: c.toDataURL('image/png').split(',')[1] };
    } catch (e) { return { t: 'f', ...box(r), bg: { r: .9, g: .9, b: .9, a: 1 }, name: 'img' }; }
  }

  let ROOT = null;
  async function walk(el, out, zc = 0) {
    const cs = getComputedStyle(el);
    if (!visible(cs)) return;
    if (cs.position !== 'static') { const zi = parseInt(cs.zIndex, 10); zc = isNaN(zi) || zi === 0 ? zc + 0.01 : Math.max(zc, 0) + zi; if (cs.position === 'fixed' || (!isNaN(zi) && zi > 0)) out = ROOT; }
    const mark = out.length;
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template') return;
    if (tag === 'svg') { const n = await svgNode(el, cs); if (n) { n.z = zc; out.push(n); } return; }
    if (tag === 'img') { const n = await imgNode(el); n.z = zc; out.push(n); return; }
    const r = el.getBoundingClientRect();
    if (cs.display !== 'contents' && el.checkVisibility && !el.checkVisibility()) return;
    const clipEarly = (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') && tag !== 'body' && tag !== 'html';
    if (clipEarly && (r.width < 1 || r.height < 1)) return;
    const bg = parseColor(cs.backgroundColor);
    const grad = parseGradient(cs.backgroundImage);
    const bw = ['Top', 'Right', 'Bottom', 'Left'].map((s) => cs[`border${s}Style`] === 'none' ? 0 : parseFloat(cs[`border${s}Width`]) || 0);
    const bc = parseColor(cs.borderTopColor) || parseColor(cs.borderBottomColor) || parseColor(cs.borderLeftColor) || parseColor(cs.borderRightColor);
    const sh = parseShadows(cs.boxShadow);
    const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 ? { w: parseFloat(cs.outlineWidth), color: parseColor(cs.outlineColor) } : null;
    const clip = (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') && tag !== 'body' && tag !== 'html';
    const op = parseFloat(cs.opacity);
    const hasVis = bg || grad || (bc && bw.some((w) => w > 0)) || sh.length || outline;
    let node = null, kids = out;
    if ((hasVis || clip || op < 1) && r.width > 0 && r.height > 0) {
      const rad = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map((k) => Math.min(parseFloat(cs[`border${k}Radius`]) || 0, Math.min(r.width, r.height) / 2));
      node = { t: 'f', ...box(r), bg, grad, bw, bc, rad, sh, outline, clip, op, name: el.dataset?.testid || (tag + (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : '')), ch: [], z: zc };
      out.push(node); kids = node.ch;
    }
    if (tag === 'input' && (el.type === 'checkbox' || el.type === 'radio') && cs.appearance !== 'none' && r.width > 0) {
      const acc = parseColor(cs.accentColor) || { r: 0.94, g: 0.2, b: 0.03, a: 1 };
      const round = el.type === 'radio' ? r.width / 2 : Math.max(2, r.width / 6);
      const on = el.checked;
      const nodeC = { t: 'f', ...box(r), bg: on ? acc : { r: 1, g: 1, b: 1, a: 1 }, bw: on ? [0, 0, 0, 0] : [1.5, 1.5, 1.5, 1.5], bc: { r: 0.46, g: 0.46, b: 0.46, a: 1 }, rad: [round, round, round, round], sh: [], clip: false, op: el.disabled ? 0.5 : 1, name: el.type, ch: [], z: zc };
      if (on) {
        const W = r.width, H = r.height;
        const svg = el.type === 'radio'
          ? `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" fill="#fff"/></svg>`
          : `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
        nodeC.ch.push({ t: 'v', ...box(r), svg, op: 1, z: zc });
      }
      kids.push(nodeC);
      return;
    }
    if ((tag === 'input' || tag === 'textarea' || tag === 'select') && el.type !== 'checkbox' && el.type !== 'radio' && el.type !== 'hidden') {
      let val = tag === 'select' ? (el.selectedOptions[0]?.textContent || '') : el.value; let isPh = false;
      if (!val && el.placeholder) { val = el.placeholder; isPh = true; }
      if (el.type === 'password' && !isPh) val = '•'.repeat(val.length);
      if (val) {
        const f = fontOf(cs); if (isPh) { const pc = parseColor(getComputedStyle(el, '::placeholder').color); if (pc) f.color = pc; }
        const pl = parseFloat(cs.paddingLeft) + bw[3], pr = parseFloat(cs.paddingRight) + bw[1];
        const lh = f.lh || f.fs * 1.25;
        const y = tag === 'textarea' ? r.top + parseFloat(cs.paddingTop) + bw[0] : r.top + (r.height - lh) / 2;
        const w = r.width - pl - pr;
        kids.push({ z: zc, t: 't', x: r.left + pl + sx, y: y + sy, w, h: lh, s: val, lines: tag === 'textarea' ? 2 : 1, ...f, lh, fixedW: f.align !== 'left' && f.align !== 'start' ? w : (tag === 'textarea' ? w : null) });
      }
      return;
    }
    for (const c of el.childNodes) {
      if (c.nodeType === 3) { const t = textNode(c, cs); for (const x of (Array.isArray(t) ? t : t ? [t] : [])) { x.z = zc; kids.push(x); } }
      else if (c.nodeType === 1) await walk(c, kids, zc);
    }
  }

  const root = []; ROOT = root;
  await walk(document.body, root);
  const sortZ = (a) => { a.forEach((n, i) => n._i = i); a.sort((p, q) => (p.z || 0) - (q.z || 0) || p._i - q._i); a.forEach((n) => { delete n._i; if (n.ch) sortZ(n.ch); }); };
  sortZ(root);
  const bodyBg = parseColor(getComputedStyle(document.body).backgroundColor) || parseColor(getComputedStyle(document.documentElement).backgroundColor) || { r: 1, g: 1, b: 1, a: 1 };
  const H = opts.fullHeight ? Math.max(document.documentElement.scrollHeight, innerHeight) : innerHeight;
  return { w: innerWidth, h: H, bg: bodyBg, ch: root };
};

window.__push = async function (key, opts) {
  const data = await window.__ser(opts);
  const body = JSON.stringify(data);
  const r = await fetch('http://127.0.0.1:8799/' + key, { method: 'POST', body });
  return { key, ...(await r.json()), nodes: body.split('"t":').length - 1 };
};
'ser loaded';
