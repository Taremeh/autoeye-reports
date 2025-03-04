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
  const participantIds = ['tarek5', '210201', '040301'];
  return participantIds.map((id) => ({ slug: id }));
};
