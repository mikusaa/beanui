import { useState } from "react";
import type { Brand } from "./api";
import { firstChar } from "./format";
import { Icon, type IconName } from "./icons";

/** 品牌 logo；认不出或缺图时灰底首字。给了 icon 时缺图画实心图标，不画首字（门票）。 */
export function Mark({ brand, fallback, size, radius, fontSize, icon }: { brand: Brand | null; fallback: string; size: number; radius: number; fontSize: number; icon?: IconName }) {
  const [broken, setBroken] = useState(false);
  const logo = brand?.logo && !broken ? brand.logo : null;
  const text = brand ? brand.name : fallback;
  const cls = logo ? " mark-logo" + (brand?.fit === "mark" ? " mark-pad" : "") : icon ? " mark-icon" : "";
  return (
    <span className={"mark" + cls} style={{ width: size, height: size, borderRadius: radius, fontSize }} aria-hidden="true">
      {logo ? <img src={logo} alt="" loading="lazy" onError={() => setBroken(true)} /> : icon ? <Icon name={icon} size={Math.round(size * 0.55)} stroke={size < 24 ? 2.2 : 1.9} /> : firstChar(text)}
    </span>
  );
}
