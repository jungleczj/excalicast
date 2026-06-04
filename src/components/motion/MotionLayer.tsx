'use client';

import { useEffect } from 'react';

/**
 * Sketchfolio-style motion layer, ported from the design's vanilla-JS
 * `animations.js` into a mounted React effect. Scans the DOM for `.reveal*`,
 * `.stagger`, `.draw-in`/`.brackets-draw`, `.magnetic`, `.parallax-host` and
 * wires them up; re-scans on DOM mutations so client navigations / lazy content
 * get picked up. CSS lives in `animations.css`.
 *
 * Omitted vs the prototype: custom cursor (`cursor:none`), pen-cursor,
 * split-chars and JS marquee (we pre-build marquee tracks + reveal in markup),
 * to keep it robust under React hydration.
 */
const REVEAL_CLASSES = ['reveal', 'reveal-up', 'reveal-left', 'reveal-right', 'reveal-pop', 'draw-in', 'brackets-draw'];

type Flagged = Element & Record<string, unknown>;

export function MotionLayer(): null {
  useEffect(() => {
    const root = document.documentElement;
    // Motion level: saved pref → else respect prefers-reduced-motion → else subtle.
    const saved = localStorage.getItem('excalicast-motion');
    if (saved != null) root.setAttribute('data-motion', saved);
    else if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) root.setAttribute('data-motion', '0');
    else root.setAttribute('data-motion', '1');

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            requestAnimationFrame(() => entry.target.classList.add('in'));
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
    );

    function prepDrawIn(host: Element): void {
      const h = host as Flagged;
      if (h.__drawPrepped) return;
      h.__drawPrepped = true;
      const strokables = host.querySelectorAll<SVGGeometryElement>('path, line, polyline, polygon, circle, ellipse, rect');
      let si = 0;
      strokables.forEach((el) => {
        let len = 400;
        try {
          if (typeof el.getTotalLength === 'function') len = Math.max(20, Math.round(el.getTotalLength()));
          else if (el.tagName === 'rect') {
            const w = parseFloat(el.getAttribute('width') || '0');
            const ht = parseFloat(el.getAttribute('height') || '0');
            len = Math.round((w + ht) * 2);
          } else if (el.tagName === 'circle') {
            const r = parseFloat(el.getAttribute('r') || '0');
            len = Math.round(2 * Math.PI * r);
          }
        } catch { /* keep default */ }
        el.style.setProperty('--len', String(len));
        el.style.setProperty('--si', String(si++));
      });
    }

    function prepStagger(host: Element): void {
      const h = host as Flagged;
      if (h.__stagPrepped) return;
      h.__stagPrepped = true;
      Array.from(host.children).forEach((c, i) => (c as HTMLElement).style.setProperty('--i', String(i)));
    }

    const cleanups: Array<() => void> = [];

    function attachMagnetic(el: Element): void {
      const e = el as Flagged;
      if (e.__magInit) return;
      e.__magInit = true;
      const node = el as HTMLElement;
      const strength = parseFloat(node.getAttribute('data-magnet-strength') || '0.35');
      const range = parseFloat(node.getAttribute('data-magnet-range') || '80');
      const onMove = (ev: PointerEvent) => {
        const r = node.getBoundingClientRect();
        const dx = ev.clientX - (r.left + r.width / 2);
        const dy = ev.clientY - (r.top + r.height / 2);
        if (Math.hypot(dx, dy) > range + Math.max(r.width, r.height) / 2) return;
        node.style.transform = `translate(${dx * strength}px, ${dy * strength}px)`;
      };
      const onLeave = () => { node.style.transform = ''; };
      const parent = node.parentElement || node;
      parent.addEventListener('pointermove', onMove);
      parent.addEventListener('pointerleave', onLeave);
      cleanups.push(() => { parent.removeEventListener('pointermove', onMove); parent.removeEventListener('pointerleave', onLeave); });
    }

    function attachParallax(host: Element): void {
      const h = host as Flagged;
      if (h.__pxInit) return;
      h.__pxInit = true;
      const node = host as HTMLElement;
      const targets = Array.from(node.querySelectorAll<HTMLElement>('[data-parallax]'));
      if (!targets.length) return;
      const onMove = (ev: PointerEvent) => {
        const r = node.getBoundingClientRect();
        const nx = (ev.clientX - (r.left + r.width / 2)) / r.width;
        const ny = (ev.clientY - (r.top + r.height / 2)) / r.height;
        targets.forEach((t) => {
          const [px, py] = (t.getAttribute('data-parallax') || '8,8').split(',').map(Number);
          t.style.transform = `translate(${nx * px}px, ${ny * py}px)`;
        });
      };
      const onLeave = () => targets.forEach((t) => { t.style.transform = ''; });
      node.addEventListener('pointermove', onMove);
      node.addEventListener('pointerleave', onLeave);
      cleanups.push(() => { node.removeEventListener('pointermove', onMove); node.removeEventListener('pointerleave', onLeave); });
    }

    function scan(): void {
      document.querySelectorAll('.stagger').forEach(prepStagger);
      document.querySelectorAll('.draw-in, .brackets-draw, .draw-loop').forEach(prepDrawIn);
      document.querySelectorAll('.magnetic').forEach(attachMagnetic);
      document.querySelectorAll('.parallax-host').forEach(attachParallax);
      const sel = REVEAL_CLASSES.map((c) => '.' + c).join(',');
      document.querySelectorAll(sel).forEach((el) => {
        const e = el as Flagged;
        if (e.__revealObserved) return;
        e.__revealObserved = true;
        io.observe(el);
      });
    }

    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; scan(); });
    };
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true });
    schedule();

    return () => {
      mo.disconnect();
      io.disconnect();
      cleanups.forEach((fn) => fn());
    };
  }, []);

  return null;
}
