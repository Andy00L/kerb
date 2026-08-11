/**
 * The FDC proof seal: a double-ring chip. Solid border once the proof landed
 * on-chain, dashed while it is still awaited; `animated` replays the settle.
 */
export function ProofSeal({
  state = "ok",
  label,
  animated = false,
}: {
  readonly state?: "ok" | "pending";
  readonly label?: string;
  readonly animated?: boolean;
}) {
  const text =
    label ?? (state === "ok" ? "FDC proof verified" : "FDC proof pending");
  const classes = ["seal", state === "ok" ? "ok" : "pending"];
  if (animated) {
    classes.push("sealset");
  }
  return <span className={classes.join(" ")}>{text}</span>;
}
