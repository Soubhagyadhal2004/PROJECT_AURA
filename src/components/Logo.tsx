import cn from "classnames";

/**
 * AURA's logo (public/logo-mark.png) with a soft turning halo behind it.
 * The halo glows brighter with `level` (voice activity) while a session is live.
 */
export default function Logo({ size = 34, level = 0, live = false, wordmark = true }: { size?: number; level?: number; live?: boolean; wordmark?: boolean }) {
  const l = Math.min(1, Math.max(0, level));
  return (
    <span className={cn("logo", { "logo--live": live })} style={{ ["--logo-size" as any]: `${size}px`, ["--level" as any]: l.toFixed(3) }}>
      <span className="logo__mark" aria-hidden="true">
        <span className="logo__glow" />
        <img className="logo__img" src={`${process.env.PUBLIC_URL || ""}/logo-mark.png`} alt="" draggable={false} />
      </span>
      {wordmark && <span className="logo__word">AURA</span>}
    </span>
  );
}
