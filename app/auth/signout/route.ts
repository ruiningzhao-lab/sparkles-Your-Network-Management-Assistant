import { NextResponse } from 'next/server';
import { siteUrl, supabaseEnabled } from '@/lib/config';
import { supabaseServer } from '@/lib/supabase/server';

export async function POST(req: Request) {
  if (supabaseEnabled()) await (await supabaseServer()).auth.signOut();
  return NextResponse.redirect(`${siteUrl(req.url)}/login`, { status: 303 });
}
