import { NextResponse } from 'next/server';
import { getTenantStore } from '@/lib/tenant-store';
import { notFoundUnlessDemo } from '@/lib/auth/demo-mode';
import { recordOperationException } from '@/lib/operational-error';

export function GET() {
  const unavailable = notFoundUnlessDemo();
  if (unavailable) return unavailable;
  try { return NextResponse.json({ identities: getTenantStore().listIdentities() }); } catch (error) { recordOperationException(null, '/api/auth/identities', error); return NextResponse.json({ message: 'Unable to load identities.' }, { status: 500 }); }
}
