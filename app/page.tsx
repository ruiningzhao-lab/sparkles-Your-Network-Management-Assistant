import { redirect } from 'next/navigation';
import Atlas from '@/components/Atlas';
import { getViewer } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const v = await getViewer();
  if (!v) redirect('/login');
  if (!v.member) redirect('/no-access');
  return <Atlas viewer={{ mode: v.mode, name: v.name, email: v.email, admin: v.admin }} />;
}
