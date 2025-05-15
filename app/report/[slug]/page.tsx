// app/report/[slug]/page.jsx
import dynamic from 'next/dynamic';

// Dynamically import the client component without server-side rendering.
const ReportClient = dynamic(() => import('./ReportClient'), { ssr: false });

export default function Page({ params }) {
  const participantId = params.slug;
  return <ReportClient participantId={participantId} />;
}

// Static params for Next.js to generate pages at build time.
export const generateStaticParams = () => {
  const participantIds = [
    'tarek5', // '210201', '040301', '040302', '050304',
    '040301',
    '040302',
    '050302',
    '050303',
    '050304',
    '060301',
    '070301',
    '100301',
    '100302',
    '110301',
    '120301',
    '120302',
    '130301',
    '130302',
    '140302',
    '190301',
    '200301',
    '200302',
    '210201',
    '210301',
    '210302',   
  ];
  return participantIds.map((id) => ({ slug: id }));
};