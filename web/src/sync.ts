import { useEffect, useState, useSyncExternalStore } from "react";
import { fetchStatus, requestSync, type Sync } from "./api";

// 手机首页的同步徽标和电脑侧栏底部共用这里的规则。
// NAS 上每 30 分钟兜底拉一次（另有手动同步）；超过 35 分钟没更新说明同步停了
const STALE_MINUTES = 35;

export type SyncTone = "ok" | "warn" | "bad";
export const SYNC_LABEL: Record<SyncTone, string> = { ok: "已同步", warn: "上次同步", bad: "同步失败" };

export function syncTone(sync: Sync, now: number): SyncTone {
  if (sync.state === "error") return "bad";
  return now - Date.parse(sync.time) > STALE_MINUTES * 60000 ? "warn" : "ok";
}

export function ago(iso: string, now: number): string {
  const min = Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  if (min < 60 * 24) return `${Math.floor(min / 60)} 小时前`;
  return `${Math.floor(min / 60 / 24)} 天前`;
}

/** 点开看的详情：提交号和时间，或者失败原因。 */
export function syncDetail(sync: Sync): string {
  return sync.state === "error" ? sync.message || "同步失败" : `当前提交 ${sync.commit ?? "未知"} · ${new Date(sync.time).toLocaleString("zh-CN")}`;
}

/** 「几分钟前」要跟着走，每 30 秒刷新一次。 */
export function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  return now;
}

// ── 手动同步 ──
// 后端只在共用的卷里留个请求，git-sync 每 2 秒看一次。点了以后每 2 秒查 /api/status，
// 直到请求被取走、sync-status 的时间不早于请求时间（两边都是服务器的时钟，到秒），最多等 60 秒。
const POLL_MS = 2000;
const TIMEOUT_MS = 60000;

// 侧栏和手机首页共用一份状态，窗口宽窄切换时也不会重复同步
let syncing = false;
let dataVersion = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());
const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
};

export const useSyncing = () => useSyncExternalStore(subscribe, () => syncing);

/** 每同步完一次加一。取数据的 effect 依赖它，同步完重新取当前页（没显示的屏切回来时本来就会取）。 */
export const useDataVersion = () => useSyncExternalStore(subscribe, () => dataVersion);

export async function startSync(onToast: (msg: string) => void): Promise<void> {
  if (syncing) return;
  syncing = true;
  emit();
  try {
    const requested = Date.parse(await requestSync());
    const deadline = Date.now() + TIMEOUT_MS;
    for (;;) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const sync = (await fetchStatus().catch(() => null))?.sync;
      if (sync && !sync.pending && Date.parse(sync.time) >= requested) {
        dataVersion++;
        onToast(sync.state === "error" ? `同步失败：${sync.message || "原因未知"}` : `已同步 · ${sync.commit ?? "提交未知"}`);
        return;
      }
      if (Date.now() >= deadline) {
        onToast("同步超时：一分钟内没有拉取，看看同步容器是否在跑");
        return;
      }
    }
  } catch (e) {
    onToast(e instanceof Error ? e.message : "同步失败");
  } finally {
    syncing = false;
    emit();
  }
}
