import { Workspace } from '@/components/workspace';
export default async function TripPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <Workspace tripId={id}/>; }
