import cn from "classnames";

/**
 * AURA's logo: a warm core inside a slowly turning, many-coloured halo.
 * The halo glows brighter with `level` (voice activity) while a session is live.
 */
export default function Logo({ size = 30, level = 0, live = false, wordmark = true }: { size?: number; level?: number; live?: boolean; wordmark?: boolean }) {
  const l = Math.min(1, Math.max(0, level));
  return (
    <span className={cn("logo", { "logo--live": live })} style={{ ["--logo-size" as any]: `${size}px`, ["--level" as any]: l.toFixed(3) }}>
      <span className="logo__mark" aria-hidden="true">
        <span className="logo__glow" />
        <span className="logo__ring" />
        <span className="logo__core" />
      </span>
      {wordmark && <span className="logo__word">AURA</span>}
    </span>
  );
}
