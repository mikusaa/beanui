// 分类图标：按科目前缀取最长匹配。颜色只给前景色，底色由样式按明暗模式混出来。
const PATHS = {
  meal: "M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-1.7 0-3 2-3 5s1.3 4 3 4v9",
  taxi: "M5 11l2-5h10l2 5M4 11h16v6H4zM7 17v3M17 17v3",
  travel: "M4 8h16v12H4zM9 8V5h6v3M4 13h16",
  lab: "M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01",
  move: "M7 7h13l-4-4M17 17H4l4 4",
  pay: "M3 7h18v13H3zM8 7V4h8v3M3 12h18",
  phone: "M7 2h10v20H7zM11 18h2",
  game: "M6 9h12a4 4 0 0 1 0 8c-1.5 0-2.5-1-3.5-2h-5C8.5 16 7.5 17 6 17a4 4 0 0 1 0-8zM8 11v4M6 13h4M16 12h.01M18 14h.01",
  box: "M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10",
  tag: "M3 12V4h8l10 10-8 8zM7.5 7.5h.01",
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z",
  health: "M12 21s-8-4.5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6.5-8 11-8 11z",
  book: "M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zM20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z",
  gift: "M3 9h18v4H3zM5 13v8h14v-8M12 9v12M12 9c-2 0-4-1-4-3s3-2 4 3c1-5 4-5 4-3s-2 3-4 3",
  shirt: "M8 3 3 6l2 4 2-1v12h10V9l2 1 2-4-5-3a4 4 0 0 1-8 0z",
  bank: "M3 10h18L12 4zM5 10v8M9 10v8M15 10v8M19 10v8M3 20h18",
  sub: "M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3",
  gear: "M4 15v-3a8 8 0 0 1 16 0v3M4 15h3v5H4zM17 15h3v5h-3z",
  other: "M5 12h.01M12 12h.01M19 12h.01",
  // 流水里交易以外的指令
  check: "M5 12l5 5 9-10",
  cross: "M6 6l12 12M18 6 6 18",
  open: "M12 5v14M5 12h14",
  close: "M5 12h14",
  note: "M5 4h14v12l-4 4H5zM15 20v-4h4M9 9h6M9 13h4",
  chart: "M3 17l6-6 4 4 8-8M15 7h6v6",
  file: "M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5",
};

export type IconName = keyof typeof PATHS;

const RULES: [string, IconName, string][] = [
  ["Expenses:Food", "meal", "#C4320A"],
  ["Expenses:Transport", "taxi", "#175CD3"],
  ["Expenses:Travel", "travel", "#0E7090"],
  ["Expenses:Tech", "lab", "#5925DC"],
  ["Expenses:Tech:Device", "phone", "#3538CD"],
  ["Expenses:Tech:Accessory", "gear", "#C11574"],
  ["Expenses:Tech:Subscription", "sub", "#107569"],
  ["Expenses:Entertainment:Subscription", "sub", "#107569"],
  ["Expenses:Housing", "home", "#0E9384"],
  ["Expenses:Housing:Internet", "phone", "#3538CD"],
  ["Expenses:Household", "box", "#6941C6"],
  ["Expenses:Personal", "shirt", "#C11574"],
  ["Expenses:Health", "health", "#D92D20"],
  ["Expenses:Entertainment", "game", "#B54708"],
  ["Expenses:Hobbies", "game", "#B54708"],
  ["Expenses:Education", "book", "#026AA2"],
  ["Expenses:Social", "gift", "#C11574"],
  ["Expenses:Financial", "bank", "#475467"],
  ["Income", "pay", "#067647"],
  ["Income:Discount", "tag", "#067647"],
  ["Income:Cashback", "tag", "#067647"],
];

export type CategoryStyle = { icon: IconName; color: string };

export function categoryStyle(account: string | null | undefined): CategoryStyle {
  if (!account) return { icon: "move", color: "#344054" };
  let best: CategoryStyle = { icon: "other", color: "#475467" };
  let len = 0;
  for (const [prefix, icon, color] of RULES) {
    if ((account === prefix || account.startsWith(prefix + ":")) && prefix.length > len) {
      best = { icon, color };
      len = prefix.length;
    }
  }
  return best;
}

export function Icon({ name, size, stroke = 2 }: { name: IconName; size: number; stroke?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  );
}

/** 浅色底、深色图标的分类方块。 */
export function CategoryTile({ account, size, radius, iconSize, stroke, className }: { account: string | null | undefined; size: number; radius: number; iconSize: number; stroke?: number; className?: string }) {
  const c = categoryStyle(account);
  return (
    <span className={"cat-tile " + (className ?? "")} style={{ width: size, height: size, borderRadius: radius, ["--c" as string]: c.color }} aria-hidden="true">
      <Icon name={c.icon} size={iconSize} stroke={stroke} />
    </span>
  );
}
