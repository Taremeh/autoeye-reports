'use client';

import React from 'react';
import Link from 'next/link';

export default function ReportClient({ participantId }) {
  // List of all participant IDs (should match generateStaticParams)
  const participants = [
    'tarek5',
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

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Report for {participantId}</h1>
      <nav>
        <h2 className="text-xl font-semibold mb-2">All Participants</h2>
        <ul className="space-y-1">
          {participants.map((id) => (
            <li key={id}>
              <Link
                href={`/report/${id}`}
                target="_blank" rel="noopener noreferrer"
                className={
                  id === participantId
                    ? 'text-blue-600 underline'
                    : 'text-blue-500 hover:underline'
                }
              >
                {id}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {/* Additional report content goes here */}
    </div>
  );
}
