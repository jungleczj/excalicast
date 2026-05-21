'use client';

/**
 * Reusable help card shown when we suspect macOS hasn't granted Chrome the
 * "Screen Recording" permission — either because we detected black frames
 * after getDisplayMedia, or the user has been stuck on the picker for 30s.
 */
export function MacOSPermissionHelp({ variant = 'card' }: { variant?: 'card' | 'inline' }): JSX.Element {
  const path = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

  if (variant === 'inline') {
    return (
      <div className="mt-2 rounded-md border border-amber-400/40 bg-amber-50 p-2 text-[11.5px] leading-relaxed text-amber-900">
        <div className="font-semibold">等了 30 秒还没动静？</div>
        <ul className="ml-4 mt-1 list-disc space-y-0.5">
          <li>选完源后请记得点选择器右下角的【分享】按钮</li>
          <li>
            macOS 用户：
            打开 <span className="font-semibold">系统设置 → 隐私与安全性 → 屏幕录制</span>，
            把 Chrome 勾上后**完全退出 Chrome 再重启**。
          </li>
        </ul>
        <div className="mt-1 text-amber-800/80">
          路径（拷贝到浏览器地址栏）：<code className="rounded bg-amber-100 px-1">{path}</code>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-400/50 bg-amber-50 p-4 text-[13px] leading-relaxed text-amber-900">
      <div className="font-semibold">屏幕录制权限可能未生效</div>
      <p className="mt-1">
        刚才录制返回了全黑帧，通常意味着 macOS 还没有给 Chrome <span className="font-semibold">屏幕录制</span> 权限。
      </p>
      <ol className="ml-4 mt-2 list-decimal space-y-1">
        <li>打开 <span className="font-semibold">系统设置 → 隐私与安全性 → 屏幕录制</span></li>
        <li>把 <span className="font-semibold">Google Chrome</span> 的开关勾上</li>
        <li>
          <span className="font-semibold">完全退出 Chrome</span>（菜单栏 Chrome → 退出，或 ⌘Q），重新打开本页面后再试
        </li>
      </ol>
      <div className="mt-3 text-[11.5px] text-amber-800/80">
        路径（直接拷贝到地址栏，回车）：
        <code className="ml-1 rounded bg-amber-100 px-1">{path}</code>
      </div>
    </div>
  );
}
