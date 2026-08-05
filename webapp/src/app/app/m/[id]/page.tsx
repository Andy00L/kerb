import { MandateDetail } from "@/components/kerb/MandateDetail";

export default async function MandateDetailPage({
  params,
}: PageProps<"/app/m/[id]">) {
  const { id } = await params;
  const mandateId = Number.parseInt(id, 10);
  return <MandateDetail mandateId={Number.isNaN(mandateId) ? 6 : mandateId} />;
}
