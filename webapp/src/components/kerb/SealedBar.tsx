/** The redaction bar: how a TEE-sealed value prints. Never decorative. */
export function SealedBar({ widthPx }: { readonly widthPx: number }) {
  return <span className="sealedbar" style={{ width: `${widthPx}px` }} />;
}
