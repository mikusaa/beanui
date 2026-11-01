import { useSyncExternalStore } from "react";

// 宽屏显示侧栏加主区（电脑端），窄屏是手机布局和底部标签栏。断点只在这里定，样式里不写媒体查询，
// 宽屏时最外层多一个 .desk，样式都挂在它下面。
const WIDE = "(min-width: 1024px)";

const media = window.matchMedia(WIDE);
const subscribe = (cb: () => void) => {
  media.addEventListener("change", cb);
  return () => media.removeEventListener("change", cb);
};

export function useWide(): boolean {
  return useSyncExternalStore(subscribe, () => media.matches);
}
