/** The FDC proof seal. Rendered only beside events that carry an on-chain proof. */
export function ProofSeal({ animated = false }: { animated?: boolean }) {
  return (
    <span className={animated ? "seal sealAnimated" : "seal"}>
      FDC attested ✓
    </span>
  );
}
