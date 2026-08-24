import { expect, test } from '@playwright/test';

test('browser setup keeps every web recording source usable when no desktop bridge exists', async ({ page }) => {
  await page.route('**/api/me/tier', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ tier: 'free' }),
  }));
  await page.goto('/zh/app');
  const skipGuide = page.getByRole('button', { name: '跳过' });
  if (await skipGuide.isVisible()) await skipGuide.click();
  await page.getByRole('button', { name: '新建录制' }).click();

  await expect(page.getByTestId('desktop-teaching-capture-console')).toHaveCount(0);
  const start = page.getByRole('button', { name: '下一步：取景' });
  for (const source of [/当前标签页/, /应用窗口/, /整个桌面/, /框选区域/]) {
    await page.getByRole('button', { name: source }).click();
    await expect(start).toBeEnabled();
    await expect(page.getByTestId('desktop-capture-start-blocker')).toHaveCount(0);
  }
});

test('desktop recording setup exposes honest capture readiness instead of assuming devices are ready', async ({ page }) => {
  await page.route('**/api/me/tier', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ tier: 'free' }),
  }));
  await page.addInitScript(() => {
    (window as Window & { __capturePermissionRequests?: number }).__capturePermissionRequests = 0;
    Object.defineProperty(window, 'excalicastDesktop', {
      configurable: true,
      value: {
        invoke: async (channel: string) => {
          if (channel === 'capture.permissions.v1') {
            return {
              screen: 'granted',
              microphone: 'granted',
              camera: 'not-determined',
              inputMonitoring: 'granted',
            };
          }
          if (channel === 'capture.devices.v1') return { malformed: true };
          if (channel === 'capture.request-permissions.v1') {
            (window as Window & { __capturePermissionRequests?: number }).__capturePermissionRequests! += 1;
            return {
              screen: 'granted', microphone: 'granted', camera: 'granted', inputMonitoring: 'granted',
            };
          }
          if (channel === 'ink.get-settings.v1') {
            return {
              mode: 'ink', pointerPolicy: 'pass-through', backgroundOpacity: 0,
              inkOpacity: 1, visible: false,
            };
          }
          return undefined;
        },
        subscribe: () => () => undefined,
      },
    });
  });

  await page.goto('/zh/app');
  const skipGuide = page.getByRole('button', { name: '跳过' });
  if (await skipGuide.isVisible()) await skipGuide.click();
  await page.getByRole('button', { name: '新建录制' }).click();

  const readinessPanel = page.getByTestId('desktop-teaching-capture-console');
  const dialog = page.getByRole('dialog', { name: '新建录制' });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('button', { name: '关闭', exact: true })).toBeFocused();
  await expect(readinessPanel).toHaveCount(0);

  await page.getByRole('button', { name: /当前标签页/ }).click();
  await expect(readinessPanel).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __capturePermissionRequests?: number }
  ).__capturePermissionRequests)).toBe(0);

  await page.getByRole('button', { name: /整个桌面/ }).click();
  await expect(readinessPanel).toBeVisible();
  await expect(readinessPanel).toContainText('屏幕录制');
  await expect(readinessPanel).toContainText('已授权');
  await expect(readinessPanel).toContainText('麦克风');
  await expect(readinessPanel).toContainText('设备探测失败');
  await expect(readinessPanel).not.toContainText('无可用设备');
  await expect(readinessPanel).toContainText('未探测');
  await expect(readinessPanel).not.toContainText('准备就绪');

  const cameraChoice = page.getByRole('radio', { name: /打开摄像头/ });
  await cameraChoice.click();
  await expect(cameraChoice).toBeFocused();

  await page.getByRole('button', { name: '请求授权并重新检查' }).click();
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __capturePermissionRequests?: number }
  ).__capturePermissionRequests)).toBe(1);
  await expect(readinessPanel).toContainText('请在下方对应的隐私设置中修改');
  await expect(readinessPanel).not.toContainText('系统设置 > 隐私与安全性 > 输入监控');

  await expect(page.getByRole('button', { name: '下一步：取景' })).toBeDisabled();
  await expect(page.getByTestId('desktop-capture-start-blocker')).toContainText('先完成授权与设备检查');

  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await dialog.evaluate((element) => { element.scrollTop = 0; });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect.poll(() => dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({
      path: `test-results/desktop-teaching-ui-${width}.png`,
      animations: 'disabled',
    });
  }

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: '新建录制' })).toBeFocused();
});

test('a malformed member in a native device array fails the probe instead of being reported as a missing device', async ({ page }) => {
  await page.route('**/api/me/tier', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ tier: 'free' }),
  }));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'excalicastDesktop', {
      configurable: true,
      value: {
        async invoke(channel: string) {
          if (channel === 'capture.permissions.v1') {
            return { screen: 'granted', microphone: 'granted', camera: 'granted', inputMonitoring: 'granted' };
          }
          if (channel === 'capture.devices.v1') {
            return { microphones: [{ name: 'Studio Mic' }, { malformed: true }], cameras: [{ name: 'Studio Camera' }] };
          }
          if (channel === 'ink.get-settings.v1') {
            return { mode: 'ink', pointerPolicy: 'pass-through', backgroundOpacity: 0, inkOpacity: 1, visible: false };
          }
          return undefined;
        },
        subscribe: () => () => undefined,
      },
    });
  });

  await page.goto('/zh/app');
  const skipGuide = page.getByRole('button', { name: '跳过' });
  if (await skipGuide.isVisible()) await skipGuide.click();
  await page.getByRole('button', { name: '新建录制' }).click();
  await page.getByRole('button', { name: /整个桌面/ }).click();
  const panel = page.getByTestId('desktop-teaching-capture-console');
  await expect(panel).toContainText('设备探测失败');
  await expect(panel).not.toContainText('无可用设备');
  await expect(page.getByRole('button', { name: '下一步：取景' })).toBeDisabled();
});

for (const localeCase of [
  {
    locale: 'zh',
    create: '新建录制',
    skip: '跳过',
    desktop: /整个桌面/,
    camera: /打开摄像头/,
    retry: '重新检查授权与设备',
    paths: {
      screen: '系统设置 > 隐私与安全性 > 屏幕与系统音频录制',
      microphone: '系统设置 > 隐私与安全性 > 麦克风',
      camera: '系统设置 > 隐私与安全性 > 摄像头',
      inputMonitoring: '系统设置 > 隐私与安全性 > 输入监控',
    },
  },
  {
    locale: 'en',
    create: 'New recording',
    skip: 'Skip',
    desktop: /Desktop Record an entire screen/i,
    camera: /Use camera/i,
    retry: 'Check permissions and devices again',
    paths: {
      screen: 'System Settings > Privacy & Security > Screen & System Audio Recording',
      microphone: 'System Settings > Privacy & Security > Microphone',
      camera: 'System Settings > Privacy & Security > Camera',
      inputMonitoring: 'System Settings > Privacy & Security > Input Monitoring',
    },
  },
] as const) {
  test(`${localeCase.locale} denied and restricted permissions show the matching macOS System Settings pane`, async ({ page }) => {
    await page.route('**/api/me/tier', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ tier: 'free' }),
    }));
    await page.addInitScript(() => {
      (window as Window & { __blockedPermission?: string }).__blockedPermission = 'screen';
      Object.defineProperty(window, 'excalicastDesktop', {
        configurable: true,
        value: {
          async invoke(channel: string) {
            if (channel === 'capture.permissions.v1') {
              const blocked = (window as Window & { __blockedPermission?: string }).__blockedPermission;
              return {
                screen: blocked === 'screen' ? 'denied' : 'granted',
                microphone: blocked === 'microphone' ? 'restricted' : 'granted',
                camera: blocked === 'camera' ? 'denied' : 'granted',
                inputMonitoring: blocked === 'inputMonitoring' ? 'restricted' : 'granted',
              };
            }
            if (channel === 'capture.devices.v1') {
              return { microphones: [{ name: 'Studio Mic' }], cameras: [{ name: 'Studio Camera' }] };
            }
            if (channel === 'ink.get-settings.v1') {
              return { mode: 'ink', pointerPolicy: 'pass-through', backgroundOpacity: 0, inkOpacity: 1, visible: false };
            }
            return undefined;
          },
          subscribe: () => () => undefined,
        },
      });
    });

    await page.goto(`/${localeCase.locale}/app`);
    const skipGuide = page.getByRole('button', { name: localeCase.skip });
    if (await skipGuide.isVisible()) await skipGuide.click();
    await page.getByRole('button', { name: localeCase.create }).click();
    await page.getByRole('button', { name: localeCase.desktop }).click();
    await page.getByRole('radio', { name: localeCase.camera }).click();
    const panel = page.getByTestId('desktop-teaching-capture-console');

    for (const permission of ['screen', 'microphone', 'camera', 'inputMonitoring'] as const) {
      await page.evaluate((next) => {
        (window as Window & { __blockedPermission?: string }).__blockedPermission = next;
      }, permission);
      await page.getByRole('button', { name: localeCase.retry }).click();
      await expect(panel).toContainText(localeCase.paths[permission]);
      for (const other of ['screen', 'microphone', 'camera', 'inputMonitoring'] as const) {
        if (other !== permission) await expect(panel).not.toContainText(localeCase.paths[other]);
      }
    }
  });
}

test('denied Input Monitoring uses the manual System Settings recovery path without a fake permission request', async ({ page }) => {
  await page.route('**/api/me/tier', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ tier: 'free' }),
  }));
  await page.addInitScript(() => {
    (window as Window & { __inputMonitoringGranted?: boolean; __capturePermissionRequests?: number })
      .__inputMonitoringGranted = false;
    (window as Window & { __capturePermissionRequests?: number }).__capturePermissionRequests = 0;
    Object.defineProperty(window, 'excalicastDesktop', {
      configurable: true,
      value: {
        async invoke(channel: string) {
          if (channel === 'capture.permissions.v1') {
            return {
              screen: 'granted', microphone: 'granted', camera: 'granted',
              inputMonitoring: (window as Window & { __inputMonitoringGranted?: boolean })
                .__inputMonitoringGranted ? 'granted' : 'denied',
            };
          }
          if (channel === 'capture.devices.v1') {
            return { microphones: [{ name: 'Studio Mic' }], cameras: [{ name: 'Studio Camera' }] };
          }
          if (channel === 'capture.request-permissions.v1') {
            (window as Window & { __capturePermissionRequests?: number }).__capturePermissionRequests! += 1;
            throw new Error('input_monitoring_must_not_use_request_channel');
          }
          if (channel === 'ink.get-settings.v1') {
            return { mode: 'ink', pointerPolicy: 'pass-through', backgroundOpacity: 0, inkOpacity: 1, visible: false };
          }
          return undefined;
        },
        subscribe: () => () => undefined,
      },
    });
  });

  await page.goto('/zh/app');
  const skipGuide = page.getByRole('button', { name: '跳过' });
  if (await skipGuide.isVisible()) await skipGuide.click();
  await page.getByRole('button', { name: '新建录制' }).click();
  await page.getByRole('button', { name: /整个桌面/ }).click();

  const panel = page.getByTestId('desktop-teaching-capture-console');
  await expect(panel).toContainText('系统设置 > 隐私与安全性 > 输入监控');
  await page.getByRole('button', { name: '重新检查授权与设备' }).click();
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __capturePermissionRequests?: number }
  ).__capturePermissionRequests)).toBe(0);
  await expect(page.getByRole('button', { name: '下一步：取景' })).toBeDisabled();

  await page.evaluate(() => {
    (window as Window & { __inputMonitoringGranted?: boolean }).__inputMonitoringGranted = true;
  });
  await page.getByRole('button', { name: '重新检查授权与设备' }).click();
  await expect(page.getByRole('button', { name: '下一步：取景' })).toBeEnabled();
});
