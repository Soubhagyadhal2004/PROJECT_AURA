import { useEffect, useState } from "react";
import cn from "classnames";

/** Two-step destructive button: first click arms it, second click confirms. */
export default function ConfirmButton({
  onConfirm,
  label,
  confirmLabel = "Confirm",
  icon = "delete",
  small,
  iconOnly,
  disabled,
}: {
  onConfirm: () => void | Promise<void>;
  label: string;
  confirmLabel?: string;
  icon?: string;
  small?: boolean;
  iconOnly?: boolean;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <button
      type="button"
      className={cn(iconOnly && !armed ? "icon-button" : "btn btn--ghost", "btn--danger", { "btn--small": small, "is-armed": armed })}
      disabled={disabled || busy}
      title={armed ? confirmLabel : label}
      aria-label={armed ? confirmLabel : label}
      onClick={async () => {
        if (!armed) return setArmed(true);
        setBusy(true);
        try {
          await onConfirm();
        } finally {
          setBusy(false);
          setArmed(false);
        }
      }}
    >
      <span className="material-symbols-outlined">{icon}</span>
      {(!iconOnly || armed) && <span>{armed ? confirmLabel : label}</span>}
    </button>
  );
}
