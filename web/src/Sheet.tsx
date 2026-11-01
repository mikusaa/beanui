import { useEffect, useMemo, useState } from "react";

const POP_WIDTH = 320;

export type Option = { value: string; label: string; hint?: string; count?: number };

/** 底部弹出的单选列表；选项多时带搜索。电脑端给 anchor（点开它的按钮），改成挂在按钮下面的下拉框。
 *  给 values 时是多选：values 里的都标成选中，点一项只回调，开关由调用方管。 */
export function Sheet({
  title,
  options,
  value,
  values,
  onPick,
  onClose,
  clearable,
  anchor,
}: {
  title: string;
  options: Option[] | null;
  value: string;
  values?: string[];
  onPick: (v: string) => void;
  onClose: () => void;
  clearable: boolean;
  anchor?: DOMRect;
}) {
  const [filter, setFilter] = useState("");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (options ?? []).filter((o) => !f || o.label.toLowerCase().includes(f) || o.hint?.toLowerCase().includes(f));
  }, [options, filter]);

  return (
    <div className={"sheet-backdrop" + (anchor ? " is-pop" : "")} onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={anchor && { top: anchor.bottom + 6, left: Math.max(8, Math.min(anchor.left, window.innerWidth - POP_WIDTH - 8)) }}
      >
        <div className="sheet-head">
          <h2>{title}</h2>
          {clearable && value && (
            <button type="button" className="link-btn" onClick={() => onPick("")}>
              清除
            </button>
          )}
        </div>
        {options && options.length > 12 && (
          <input className="sheet-search" type="search" autoFocus={Boolean(anchor)} placeholder="筛选" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={`筛选${title}`} />
        )}
        <div className="sheet-list">
          {!options && <div className="sheet-empty">加载中…</div>}
          {options && !shown.length && <div className="sheet-empty">没有匹配的选项</div>}
          {shown.map((o) => (
            <button
              type="button"
              key={o.value}
              className={"sheet-item" + ((values ? values.includes(o.value) : o.value === value) ? " is-on" : "")}
              aria-pressed={values ? values.includes(o.value) : undefined}
              onClick={() => onPick(o.value)}
            >
              {values && <span className={"sheet-check" + (values.includes(o.value) ? " is-on" : "")} aria-hidden="true" />}
              <span className="sheet-label">
                <span>{o.label}</span>
                {o.hint && <span className="sheet-hint mono">{o.hint}</span>}
              </span>
              {o.count != null && <span className="num sheet-count">{o.count}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
