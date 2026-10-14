import cn from "classnames";

/**
 * AURA's mark: a glowing ring whose halo follows the audio level.
 * Used small in the sidebar and large as the voice button.
 */
export default function Orb({
  size = 120,
  level = 0,
  active = false,
  tone = "idle",
  logo = false,
}: {
  size?: number;
  level?: number;
  active?: boolean;
  tone?: "idle" | "listening" | "speaking" | "recording";
  /** Draw the AURA brand mark (public/logo-mark.png) instead of the plain core. */
  logo?: boolean;
}) {
  const l = Math.min(1, Math.max(0, level));
  return (
    <span
      className={cn("orb", `orb--${tone}`, { "orb--active": active, "orb--logo": logo })}
      style={{ width: size, height: size, ["--level" as any]: l.toFixed(3) }}
      aria-hidden="true"
    >
      <span className="orb__halo" />
      <span className="orb__core" />
      {logo && <img className="orb__logo" src={`${process.env.PUBLIC_URL || ""}/logo-mark.png`} alt="" draggable={false} />}
    </span>
  );
}
