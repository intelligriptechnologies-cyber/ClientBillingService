import { NextResponse } from 'next/server';
import { sessionCookie } from '@/lib/session';
import { recordOperationException } from '@/lib/operational-error';

export function POST() { try { const response = NextResponse.json({ ok: true }); response.cookies.set(sessionCookie, '', { maxAge: 0, path: '/' }); return response; } catch (error) { recordOperationException(null, '/api/auth/logout', error); return NextResponse.json({ message: 'Unable to sign out.' }, { status: 500 }); } }
