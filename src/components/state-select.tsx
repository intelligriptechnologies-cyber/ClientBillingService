'use client';

import { listStates } from '@/lib/gst';

const states = listStates();

export function StateSelect({ label, value, blankLabel, onChange }: { label: string; value: string; blankLabel: string; onChange(value: string): void }) {
  return <label className="field"><span>{label}</span><select className="select" value={value} onChange={(event) => onChange(event.target.value)}><option value="">{blankLabel}</option>{states.map((state) => <option key={state.code} value={state.code}>{state.name} ({state.code})</option>)}</select></label>;
}
