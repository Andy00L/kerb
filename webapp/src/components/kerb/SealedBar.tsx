/** The redaction bar: how a TEE-sealed value prints. Never decorative. */
export function SealedBar({ widthPx }: { widthPx: number }) {
  return <span className="sealed" style={{ width: `${widthPx}px` }} />;
}
