import { cn } from "@/lib/utils";

/** The WoRe wordmark — a folded-paper glyph + Fraunces display type. */
export function Brand({
  className,
  size = 28,
  withText = true,
}: {
  className?: string;
  size?: number;
  withText?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <Logo size={size} />
      {withText && (
        <div className="leading-none">
          <span className="font-display text-[1.45rem] font-semibold tracking-tight">
            WoRe
          </span>
        </div>
      )}
    </div>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span
      className="relative inline-grid place-items-center rounded-[30%] bg-primary text-primary-foreground shadow-sm"
      style={{ width: size, height: size }}
    >
      {/* folded document with amber accent seam */}
      <svg
        viewBox="0 0 24 24"
        width={size * 0.62}
        height={size * 0.62}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20V4a.5.5 0 0 1 .5-.5Z" />
        <path d="M14 3.5V8h4" />
        <path
          d="M9.5 12.2 12 14.7l3.4-3.4"
          stroke="var(--color-accent)"
          strokeWidth={2}
        />
      </svg>
    </span>
  );
}
