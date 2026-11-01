import { useSyncExternalStore } from "react";

// 几个页面用不着路由库：概览在 /，流水在 /journal，账户在 /accounts，收支表在 /income，交易详情在 /txn/<id>
const subscribe = (cb: () => void) => {
  window.addEventListener("popstate", cb);
  return () => window.removeEventListener("popstate", cb);
};

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => location.pathname);
}

/** 路径加查询串；页面自己用 replaceState 改的查询串不会触发更新，只有 navigate 和前进后退会。 */
export function useLocation(): string {
  return useSyncExternalStore(subscribe, () => location.pathname + location.search);
}

/** pane：电脑端从流水点开详情栏时流水的地址，关掉详情栏时如果筛选没变就退回去。 */
export function navigate(url: string, { replace = false, pane }: { replace?: boolean; pane?: string } = {}) {
  const state = pane ? { inApp: true, pane } : { inApp: true };
  if (replace) history.replaceState(state, "", url);
  else history.pushState(state, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** 从应用内点进来的就回退，直接打开链接的就回概览。 */
export function goBack() {
  if (history.state?.inApp) history.back();
  else navigate("/", { replace: true });
}
