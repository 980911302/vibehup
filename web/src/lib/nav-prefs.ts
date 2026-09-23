/** 导航偏好（卡片 35）：次要项折叠态与简洁模式，localStorage 持久化 + 跨组件事件同步 */

export const NAV_MORE_KEY = 'vibehub_nav_more';
export const NAV_SIMPLE_KEY = 'vibehub_nav_simple';

export const NAV_PREFS_EVENT = 'vibehub:nav-prefs';

export function readNavFlag(key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function writeNavFlag(key: string, value: boolean): void {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(key, value ? '1' : '0');
    } catch {
      // 隐私模式：仅内存态
    }
  }
  // 通知 Sidebar 等订阅方重读（设置页开关 → 侧边栏即时生效）
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(NAV_PREFS_EVENT, { detail: { key } }));
  }
}
