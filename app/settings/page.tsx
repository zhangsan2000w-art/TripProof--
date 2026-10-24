import { notFound } from 'next/navigation';
import { Header, Footer } from '@/components/brand';
import { LocalSettingsForm } from '@/components/local-settings';
import { localSettingsEnabled } from '@/lib/search/settings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export default function SettingsPage() {
  if (!localSettingsEnabled()) notFound();
  return <><Header/><main className="page local-settings-page"><LocalSettingsForm/></main><Footer/></>;
}
