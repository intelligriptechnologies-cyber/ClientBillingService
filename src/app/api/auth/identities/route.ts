import { NextResponse } from 'next/server';
import { getTenantStore } from '@/lib/tenant-store';
import { recordOperationException } from '@/lib/operational-error';

export function GET() { try { return NextResponse.json({ identities: getTenantStore().listIdentities() }); } catch (error) { recordOperationException(null, '/api/auth/identities', error); return NextResponse.json({ message: 'Unable to load identities.' }, { status: 500 }); } }
