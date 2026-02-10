const PILL_CLASS = {
  S1: 'pill-s1',
  S2: 'pill-s2',
  S3: 'pill-s3',
  S4: 'pill-s4',
}

export default function SegmentPill({ segment }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${PILL_CLASS[segment] || 'bg-slate-700 text-slate-300'}`}>
      {segment}
    </span>
  )
}
