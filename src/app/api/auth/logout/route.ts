import { NextResponse } from 'next/server';
import { sessionCookie } from '@/lib/session';

export function POST() { const response = NextResponse.json({ ok: true }); response.cookies.set(sessionCookie, '', { maxAge: 0, path: '/' }); return response; }
