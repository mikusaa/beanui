import { useState } from "react";
import type { Brand } from "./api";
import { firstChar } from "./format";

/** 品牌 logo；认不出或缺图时灰底首字。 */
export function Mark({ brand, fallback, size, radius, fontSize }: { brand: Brand | null; fallback: string; size: number; radius: number; fontSize: number }) {
  const [broken, setBroken] = useState(false);
  const logo = brand?.logo && !broken ? brand.logo : null;
  const text = brand ? brand.name : fallback;
  return (
    <span className={"mark" + (logo ? " mark-logo" : "") + (logo && brand?.fit === "mark" ? " mark-pad" : "")} style={{ width: size, height: size, borderRadius: radius, fontSize }} aria-hidden="true">
      {logo ? <img src={logo} alt="" loading="lazy" onError={() => setBroken(true)} /> : firstChar(text)}
    </span>
  );
}
