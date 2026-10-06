import { NextResponse } from 'next/server';
import { getTenantStore } from '@/lib/tenant-store';

export function GET() { return NextResponse.json({ identities: getTenantStore().listIdentities() }); }
