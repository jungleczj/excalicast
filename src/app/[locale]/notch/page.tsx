'use client';

/**
 * /notch —— 供桌面伴侣（Electron 刘海窗口）加载的最小透明页：只渲染提词器（embedded 模式，
 * 铺满窗口、停靠态常驻）。原生壳负责把这个页装进一个无边框 / 透明 / 永远置顶（screen-saver 级）/
 * 定位在屏幕顶部居中（盖住菜单栏 + 刘海、浮在一切 app 之上）的窗口 —— 这是 Textream 那种「窗口态常驻
 * 刘海」能力在网页里的真正实现路径（纯浏览器标签页做不到）。
 *
 * 窗口拖动：`-webkit-app-region: drag` 让整条可拖动 OS 窗口，按钮/输入框 `no-drag` 保持可点。
 */

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Teleprompter } from '@/components/Teleprompter';
import { DESKTOP_IPC_CHANNELS } from '@/desktop/productContract';
import type { DesktopTeleprompterState } from '@/desktop/teleprompterSession';

export default function NotchPage(): JSX.Element {
  const en = useLocale() === 'en';
  const [state, setState] = useState<DesktopTeleprompterState | null>(null);

  useEffect(() => {
    const bridge = window.excalicastDesktop;
    if (!bridge) return;
    let active = true;
    void bridge.invoke(DESKTOP_IPC_CHANNELS.teleprompterGetState).then((value) => {
      if (active) setState(value as DesktopTeleprompterState);
    });
    const unsubscribe = bridge.subscribe(
      DESKTOP_IPC_CHANNELS.teleprompterStateChanged,
      (value) => setState(value as DesktopTeleprompterState),
    );
    return () => { active = false; unsubscribe(); };
  }, []);

  // 透明页底，便于原生壳透出圆角 / 刘海形状。
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = { h: html.style.background, b: body.style.background, bc: body.className };
    html.style.background = 'transparent';
    body.style.background = 'transparent';
    body.classList.add('notch-host');
    return () => { html.style.background = prev.h; body.style.background = prev.b; body.className = prev.bc; };
  }, []);

  return (
    <>
      {/* Electron 无边框窗口拖动：整条可拖，交互元素除外 */}
      <style dangerouslySetInnerHTML={{ __html: `
        html, body { background: transparent !important; overflow: hidden; }
        .notch-host .rb-no-record { -webkit-app-region: drag; }
        .notch-host .rb-no-record button,
        .notch-host .rb-no-record input,
        .notch-host .rb-no-record textarea,
        .notch-host .rb-no-record [data-w] { -webkit-app-region: no-drag; }
      ` }} />
      <Teleprompter
        open={state?.visible ?? false}
        embedded
        en={en}
        externalState={state}
        onClose={() => { /* 原生壳负责关闭 */ }}
      />
    </>
  );
}
